import { and, desc, eq, gt, lte, notExists, sql } from "drizzle-orm";
import {
  agreementAcceptances,
  agreementVersions,
  bookings,
  custodyEvents,
  type AgreementAcceptance,
  type AgreementVersion,
  type BookingStatus,
  type Database,
} from "@koolee/db";

import type { CoreConfig } from "../config";
import { InvalidInputError, NotAuthorizedError, NotFoundError } from "../errors";
import { assertActionable } from "./actionability";

/**
 * Versioned booking agreements.
 *
 * THE CORE IDEA: "current" is derived, never stored.
 *
 * The current version is `max(version)` among rows whose `effective_from` has
 * passed. There is no `is_active` column and there will not be one — a flag
 * beside a derivable fact is a second source of truth for the same question,
 * and the two drift the first time anything writes one without the other.
 * That is the pricing-rule leakage (#41/#51) restated, and the lesson there
 * was to make the invariant impossible to violate rather than to remember to
 * maintain it.
 *
 * VERSION PINNING — the rule that governs everything below.
 *
 *   Every booking needs one acceptance, before the visit. That acceptance
 *   PINS the version, and that version governs the booking for its whole
 *   life. A new version never disturbs a booking already in flight. A new
 *   booking accepts whatever is current at that moment.
 *
 * Per BOOKING, not per customer: a repeat customer accepts again on their next
 * booking. Pinning a customer to their first version would leave people
 * shipping under years-old terms while the operation runs on the newest.
 *
 * WHY, beyond convenience. A booking is a contract for one shipment, formed at
 * acceptance; carriage, shipping and insurance all bind the terms in force at
 * purchase, and a carrier generally cannot rewrite terms mid-shipment anyway.
 * The decisive point is that re-acceptance does not achieve what it appears
 * to: consent tapped at a doorstep with an agent waiting and bags packed is
 * consent under duress, which is the weakest kind there is.
 *
 * This REPLACED a re-acceptance model where the gate asked for an acceptance
 * of the version current right now, so publishing v2 un-gated every booking
 * that had only accepted v1. That model was also internally inconsistent: it
 * blocked a pickup tomorrow morning over a terms change, but left a booking
 * already in transit alone — which is not a principle, it is an artifact of
 * where the gate sat.
 *
 * `publishAgreementVersion` still refuses a retroactive `effective_from`. It
 * no longer protects in-flight acceptances (nothing can disturb those now) but
 * it still decides which version NEW bookings pin to, and backdating that
 * silently rewrites which terms a booking made an hour ago was sold under.
 */

/** Custody event names this module appends. Free-form text by design. */
export const AGREEMENT_EVENT_TYPES = {
  accepted: "agreement.accepted",
} as const;

/**
 * Booking statuses at which accepting is meaningful: paid (the earliest point
 * a real booking exists) through the visit. Past `verified_sealed` the agent
 * has already taken custody, so an acceptance then would be evidence of
 * nothing; `draft`, `cancelled` and `exception` are not bookings anyone should
 * be signing terms for.
 */
export const AGREEMENT_ACCEPTABLE_STATUSES: readonly BookingStatus[] = [
  "paid",
  "agent_assigned",
];

/**
 * The version in force at `now`.
 *
 * One query. `effective_from <= now` filters out anything scheduled but not
 * yet live; ordering by `version` (not by `effective_from`) picks the winner,
 * because `version` is the monotonic UNIQUE column and is therefore the only
 * tiebreak that cannot be ambiguous — two versions may legitimately share an
 * `effective_from`, and "whichever the planner returned first" is not an
 * answer we can defend to a customer.
 *
 * Null means no agreement has ever been published (a fresh database with no
 * seed). Callers must treat that as "cannot gate" rather than "gate passes" —
 * see `bookingHasAcceptedAgreement`.
 */
export async function getCurrentAgreementVersion(
  db: Database,
  now: Date,
): Promise<AgreementVersion | null> {
  const [row] = await db
    .select()
    .from(agreementVersions)
    .where(lte(agreementVersions.effectiveFrom, now))
    .orderBy(desc(agreementVersions.version))
    .limit(1);
  return row ?? null;
}

export interface AcceptAgreementInput {
  bookingId: string;
  /** The signed-in customer. Must own the booking. */
  userId: string;
  /**
   * Whatever the accepting request actually carried — `{ userAgent, ip }` in
   * practice. Keys the request did not have are OMITTED, never filled with a
   * placeholder: an invented IP in an evidence record is worse than no IP.
   */
  evidence?: Record<string, unknown>;
}

export type AcceptAgreementResult = {
  acceptance: AgreementAcceptance;
  version: AgreementVersion;
  /** False when the customer had already accepted this exact version. */
  created: boolean;
};

/**
 * Records that this customer accepted the CURRENT version for this booking.
 *
 * Idempotent on `booking_id`: a double-submit, a refresh, or a retry after a
 * dropped response returns the acceptance that already exists. Critically,
 * that is also what makes pinning hold — a booking that accepted v1 and calls
 * this again while v2 is current does NOT get re-pinned to v2. It keeps v1,
 * because v1 is what it is bound by.
 *
 * The uniqueness is the database's (`onConflictDoNothing` plus a re-read, not
 * a check-then-insert), because check-then-insert races with itself: two
 * concurrent submits could otherwise pin one booking to two versions.
 *
 * A first acceptance always binds to the version current at call time. The
 * client never names one — a page that rendered v1 and submits after v2 goes
 * live must not be able to pin the stale document by asking for it.
 */
export async function acceptAgreement(
  config: CoreConfig,
  input: AcceptAgreementInput,
): Promise<AcceptAgreementResult> {
  const { db } = config;
  const now = config.clock.now();

  const booking = await db.query.bookings.findFirst({
    where: eq(bookings.id, input.bookingId),
  });
  // 404 rather than 403 on someone else's booking: a 403 confirms the id
  // exists, which is the one bit a prober wants.
  if (!booking || booking.userId !== input.userId) {
    throw new NotFoundError("Booking", input.bookingId);
  }
  /*
   * Actionability FIRST, then the status list.
   *
   * Status is not the whole answer — a `paid` booking whose flight left an
   * hour ago is still `paid` — and the order matters for what the customer
   * reads. A booking ops already owns gets "our team is sorting this out",
   * not "this booking is exception". Late-but-savable is deliberately
   * ALLOWED here: accepting the agreement is one of the two things that
   * unblocks a late visit, so refusing it is refusing the rescue.
   */
  await assertActionable(config, booking, "acceptAgreement", {
    userId: input.userId,
    role: "customer",
  });
  if (!AGREEMENT_ACCEPTABLE_STATUSES.includes(booking.status)) {
    throw new NotAuthorizedError(
      `This booking is ${booking.status}; the agreement can only be accepted before the pickup visit.`,
    );
  }

  // Already pinned? Return it untouched. Resolving the current version first
  // and inserting against it is exactly what would silently re-pin an accepted
  // booking to newer terms.
  const [alreadyPinned] = await db
    .select()
    .from(agreementAcceptances)
    .where(eq(agreementAcceptances.bookingId, booking.id))
    .limit(1);
  if (alreadyPinned) {
    const pinned = await getAgreementVersionById(db, alreadyPinned.agreementVersionId);
    if (!pinned) {
      throw new NotFoundError("Agreement version", alreadyPinned.agreementVersionId);
    }
    return { acceptance: alreadyPinned, version: pinned, created: false };
  }

  const version = await getCurrentAgreementVersion(db, now);
  if (!version) {
    throw new NotFoundError("Current agreement version", "none published");
  }

  const inserted = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(agreementAcceptances)
      .values({
        bookingId: booking.id,
        agreementVersionId: version.id,
        acceptedAt: now,
        acceptedByUserId: input.userId,
        ...(input.evidence === undefined ? {} : { evidence: input.evidence }),
      })
      .onConflictDoNothing({ target: agreementAcceptances.bookingId })
      .returning();

    // Only the acceptance that actually happened gets a custody event. A
    // re-accept of the same version appends nothing — the trail records what
    // occurred, and nothing occurred.
    if (row) {
      await tx.insert(custodyEvents).values({
        bookingId: booking.id,
        actorUserId: input.userId,
        actorRole: "customer",
        eventType: AGREEMENT_EVENT_TYPES.accepted,
        metadata: {
          agreementVersion: version.version,
          agreementVersionId: version.id,
        },
      });
    }
    return row ?? null;
  });

  if (inserted) return { acceptance: inserted, version, created: true };

  // Lost the race: a concurrent request pinned this booking first. Return
  // THEIR row and the version it actually pinned — which may not be the one we
  // resolved a moment ago, and reporting ours would misstate what the booking
  // is bound by.
  const [existing] = await db
    .select()
    .from(agreementAcceptances)
    .where(eq(agreementAcceptances.bookingId, booking.id))
    .limit(1);
  if (!existing) {
    // Unreachable short of the row being deleted between the two statements,
    // which the append-only trigger forbids.
    throw new NotFoundError("Agreement acceptance", booking.id);
  }
  const raced =
    existing.agreementVersionId === version.id
      ? version
      : await getAgreementVersionById(db, existing.agreementVersionId);
  return { acceptance: existing, version: raced ?? version, created: false };
}

/**
 * The gate predicate: has this booking accepted an agreement at all?
 *
 * Deliberately NOT "…the version current right now". Under pinning, whichever
 * version this booking accepted is the one that governs it, so publishing a
 * newer one cannot un-gate a booking that is already agreed. There is exactly
 * one acceptance per booking (UNIQUE `booking_id`, migration 0025), so this is
 * a single existence check.
 *
 * It still fails CLOSED on a booking that has never accepted — including when
 * nothing has ever been published, because then no booking can have an
 * acceptance row. A misconfiguration must block visits loudly rather than
 * quietly stop requiring agreements.
 */
export async function bookingHasAcceptedAgreement(
  db: Database,
  bookingId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: agreementAcceptances.id })
    .from(agreementAcceptances)
    .where(eq(agreementAcceptances.bookingId, bookingId))
    .limit(1);
  return row !== undefined;
}

/** What a booking's agreement state looks like to a UI. */
export interface BookingAgreementState {
  /**
   * The version this booking is BOUND to — the one it accepted. Null until it
   * accepts. Once set it never changes, whatever gets published afterwards,
   * and it is the document every surface should show for this booking.
   */
  acceptedVersion: AgreementVersion | null;
  /** The acceptance itself: who, when, and the evidence captured. */
  acceptance: AgreementAcceptance | null;
  /**
   * What a NEW acceptance would pin to. Only meaningful while `accepted` is
   * false — after that it is what future bookings get, not this one. Null when
   * nothing has ever been published.
   */
  currentVersion: AgreementVersion | null;
  /** `acceptance !== null`. */
  accepted: boolean;
}

/**
 * Everything a trip page, an agent screen or the ops console needs about one
 * booking's agreement.
 *
 * Returns the PINNED version when there is one, and only then falls back to
 * asking what is current. A booking that accepted v1 keeps showing v1 after v2
 * publishes — to the customer, to the agent at the door, and to ops — because
 * v1 is what it is actually bound by.
 */
export async function getBookingAgreementState(
  db: Database,
  bookingId: string,
  now: Date,
): Promise<BookingAgreementState> {
  const [acceptance] = await db
    .select()
    .from(agreementAcceptances)
    .where(eq(agreementAcceptances.bookingId, bookingId))
    .limit(1);

  if (acceptance) {
    const acceptedVersion = await getAgreementVersionById(
      db,
      acceptance.agreementVersionId,
    );
    return {
      acceptedVersion,
      acceptance,
      // Not fetched: nothing on an accepted booking depends on it, and the
      // query would only invite a surface to render the wrong document.
      currentVersion: acceptedVersion,
      accepted: true,
    };
  }

  const currentVersion = await getCurrentAgreementVersion(db, now);
  return { acceptedVersion: null, acceptance: null, currentVersion, accepted: false };
}

export interface PublishAgreementVersionInput {
  title: string;
  bodyMd: string;
  /** Must be now or later. Omitted → now. */
  effectiveFrom?: Date;
  /** The admin publishing it. Admin-ness is enforced at the action layer. */
  publishedBy: string;
}

/**
 * Publishes the next version.
 *
 * `version` is `max + 1`, read and written inside one transaction so two
 * concurrent publishes cannot mint the same number — and if they somehow do,
 * the UNIQUE index on `version` turns it into a clean 23505 rather than two
 * rows both claiming to be current.
 *
 * REFUSES A RETROACTIVE `effective_from`. A version dated in the past becomes
 * current the instant it is written, which retroactively un-accepts every
 * in-flight booking — including one whose agent is at the customer's door
 * mid-visit. There is no legitimate use for it and one catastrophic
 * accidental use, so it is a hard refusal rather than a warning.
 *
 * A small backdating tolerance exists only to absorb clock skew between the
 * form's rendered "now" and the server's, not to permit backdating.
 */
const PUBLISH_CLOCK_SKEW_MS = 60_000;

export async function publishAgreementVersion(
  config: CoreConfig,
  input: PublishAgreementVersionInput,
): Promise<AgreementVersion> {
  const now = config.clock.now();
  const title = input.title.trim();
  const bodyMd = input.bodyMd.trim();
  if (!title) throw new InvalidInputError("title", "Give the agreement a title.");
  if (!bodyMd) throw new InvalidInputError("bodyMd", "The agreement body is empty.");

  const effectiveFrom = input.effectiveFrom ?? now;
  if (effectiveFrom.getTime() < now.getTime() - PUBLISH_CLOCK_SKEW_MS) {
    throw new InvalidInputError(
      "effectiveFrom",
      "An agreement version cannot take effect in the past — it would retroactively " +
        "invalidate acceptances on bookings that are already in flight.",
    );
  }

  return config.db.transaction(async (tx) => {
    const [max] = await tx
      .select({ version: sql<number | null>`max(${agreementVersions.version})` })
      .from(agreementVersions);
    const nextVersion = (max?.version ?? 0) + 1;

    const [row] = await tx
      .insert(agreementVersions)
      .values({
        version: nextVersion,
        title,
        bodyMd,
        effectiveFrom,
        publishedBy: input.publishedBy,
      })
      .returning();
    if (!row) throw new Error("Failed to publish agreement version");
    return row;
  });
}

/**
 * SQLSTATE 23001 (`restrict_violation`) anywhere on the cause chain — the code
 * the append-only and freeze triggers raise with. drizzle wraps driver errors,
 * so the top-level message is only ever `Failed query: …`.
 */
function isRestrictViolation(error: unknown): boolean {
  let cursor: unknown = error;
  while (cursor) {
    if ((cursor as { code?: unknown }).code === "23001") return true;
    cursor = (cursor as { cause?: unknown }).cause;
  }
  return false;
}

export interface UpdateScheduledAgreementVersionInput {
  id: string;
  title: string;
  bodyMd: string;
  /** Must stay now-or-later. Omitted → left as it is. */
  effectiveFrom?: Date;
}

export type UpdateScheduledAgreementVersionResult =
  { ok: true; version: AgreementVersion } | { ok: false; error: string };

/**
 * Edits a version that has not taken effect yet.
 *
 * A scheduled version is safe to edit precisely because it is not current:
 * `acceptAgreement` only ever resolves the CURRENT version, so a row with a
 * future `effective_from` provably has no acceptances, and changing it cannot
 * rewrite what anybody agreed to. That is also why this product needs no
 * separate draft state — schedule it, keep working on it, and it freezes when
 * it goes live.
 *
 * THE RACE THIS CLOSES. An operator opens a version scheduled for tomorrow,
 * leaves the tab open overnight, it goes live, a customer accepts it, and then
 * the operator saves. A read-then-write would silently rewrite accepted terms.
 * So the guard is in the WHERE clause — `effective_from > now()` AND no
 * acceptance row exists — and zero rows updated means the world moved, which
 * is reported rather than swallowed. Migration 0024 enforces the same rule
 * with a trigger, so it also holds for anything that never comes through here.
 *
 * Returns a Result rather than throwing on the lost race: "someone accepted it
 * while you were typing" is an expected outcome the UI must explain, not an
 * exception.
 */
export async function updateScheduledAgreementVersion(
  config: CoreConfig,
  input: UpdateScheduledAgreementVersionInput,
): Promise<UpdateScheduledAgreementVersionResult> {
  const now = config.clock.now();
  const title = input.title.trim();
  const bodyMd = input.bodyMd.trim();
  if (!title) throw new InvalidInputError("title", "Give the agreement a title.");
  if (!bodyMd) throw new InvalidInputError("bodyMd", "The agreement body is empty.");

  if (
    input.effectiveFrom !== undefined &&
    input.effectiveFrom.getTime() < now.getTime() - PUBLISH_CLOCK_SKEW_MS
  ) {
    throw new InvalidInputError(
      "effectiveFrom",
      "An agreement version cannot take effect in the past — it would retroactively " +
        "invalidate acceptances on bookings that are already in flight.",
    );
  }

  let row: AgreementVersion | undefined;
  try {
    [row] = await config.db
      .update(agreementVersions)
      .set({
        title,
        bodyMd,
        ...(input.effectiveFrom === undefined
          ? {}
          : { effectiveFrom: input.effectiveFrom }),
      })
      .where(
        and(
          eq(agreementVersions.id, input.id),
          // Not yet in effect…
          gt(agreementVersions.effectiveFrom, now),
          // …and nobody has accepted it. Belt and braces: the first condition
          // implies the second today, and would stop implying it the moment
          // anyone adds a way to accept a non-current version.
          notExists(
            config.db
              .select({ one: sql`1` })
              .from(agreementAcceptances)
              .where(eq(agreementAcceptances.agreementVersionId, input.id)),
          ),
        ),
      )
      .returning();
  } catch (error) {
    // The WHERE clause above is evaluated against `config.clock`, the trigger
    // (0024) against the DATABASE's clock. They are the same in production
    // give or take skew — but when they disagree, the app can believe a
    // version is still schedulable while the database has already frozen it,
    // and the trigger raises. That is the guard working, so it must surface as
    // the same expected outcome as losing the WHERE-clause race, not as an
    // unhandled driver error at the operator.
    if (!isRestrictViolation(error)) throw error;
    row = undefined;
  }

  if (!row) {
    const existing = await getAgreementVersionById(config.db, input.id);
    if (!existing) return { ok: false, error: "That version no longer exists." };
    return {
      ok: false,
      error:
        `Version ${existing.version} took effect at ${existing.effectiveFrom.toISOString()} ` +
        `and can no longer be edited. Publish a new version instead — your text is still ` +
        `in the editor.`,
    };
  }
  return { ok: true, version: row };
}

/** True when this version can still be edited: scheduled, and unaccepted. */
export function isAgreementVersionEditable(
  version: AgreementVersion,
  now: Date,
): boolean {
  return version.effectiveFrom.getTime() > now.getTime();
}

/** Every version, newest first — the admin list. */
export async function listAgreementVersions(db: Database): Promise<AgreementVersion[]> {
  return db.select().from(agreementVersions).orderBy(desc(agreementVersions.version));
}

/**
 * How many versions exist at all — published, scheduled, or superseded.
 *
 * ZERO IS AN OUTAGE, and this is the cheapest way to ask. Without a version
 * no booking can hold an acceptance, so `bookingHasAcceptedAgreement` fails
 * closed for every booking and every agent visit stops at the identity step.
 * The console's Overview page asks this on every load to raise that alarm, so
 * it is a `count(*)` rather than `listAgreementVersions().length` — the bodies
 * are markdown documents and none of them is needed to answer "any?".
 *
 * Deliberately NOT "is one in effect right now". A version scheduled for next
 * week is not current, but somebody has done the work and the alarm would be
 * noise. `getCurrentAgreementVersion` answers the other question.
 */
export async function countAgreementVersions(db: Database): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(agreementVersions);
  return row?.count ?? 0;
}

export async function getAgreementVersionById(
  db: Database,
  id: string,
): Promise<AgreementVersion | null> {
  const [row] = await db
    .select()
    .from(agreementVersions)
    .where(eq(agreementVersions.id, id))
    .limit(1);
  return row ?? null;
}
