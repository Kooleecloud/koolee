import { and, desc, eq, inArray, lte, sql } from "drizzle-orm";
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
 * THE RE-ACCEPT MODEL, stated plainly because it looks like a bug otherwise:
 * the gate asks whether a booking has an acceptance of the version that is
 * current RIGHT NOW. So publishing v2 un-gates every booking that only ever
 * accepted v1, and those customers are asked to accept again. That is
 * intended — an agreement the customer never saw is not one they agreed to.
 * It is also why `publishAgreementVersion` refuses a retroactive
 * `effective_from`: backdating would flip in-flight bookings to "not
 * accepted" retroactively, potentially while an agent is standing at the door.
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
 * see `bookingHasCurrentAcceptance`.
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
 * Idempotent on `(booking_id, agreement_version_id)`: a double-submit, a
 * refresh, or a retry after a dropped response is a no-op success rather than
 * a second row or an error the customer cannot act on. The uniqueness is the
 * database's — `onConflictDoNothing` plus a re-read, not a check-then-insert,
 * because the latter races with itself.
 *
 * Deliberately accepts only the version current at call time. A client that
 * rendered v1 and submits after v2 goes live must not be able to name the
 * stale version and satisfy the gate; the version is resolved server-side and
 * the client does not get to choose it.
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
  if (!AGREEMENT_ACCEPTABLE_STATUSES.includes(booking.status)) {
    throw new NotAuthorizedError(
      `This booking is ${booking.status}; the agreement can only be accepted before the pickup visit.`,
    );
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
      .onConflictDoNothing({
        target: [agreementAcceptances.bookingId, agreementAcceptances.agreementVersionId],
      })
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

  // Lost the conflict: the row already existed (or a concurrent request won).
  const [existing] = await db
    .select()
    .from(agreementAcceptances)
    .where(
      and(
        eq(agreementAcceptances.bookingId, booking.id),
        eq(agreementAcceptances.agreementVersionId, version.id),
      ),
    )
    .limit(1);
  if (!existing) {
    // Unreachable short of the row being deleted between the two statements,
    // which the append-only trigger forbids.
    throw new NotFoundError("Agreement acceptance", booking.id);
  }
  return { acceptance: existing, version, created: false };
}

/**
 * The gate predicate: has this booking accepted the version in force now?
 *
 * False when nothing has ever been published, on purpose. "No agreement
 * exists" is a misconfiguration, and a misconfiguration must fail CLOSED — an
 * empty table quietly satisfying the gate would mean a database that lost its
 * agreement rows silently stops requiring agreements, which is the worst
 * possible way for that to be discovered.
 */
export async function bookingHasCurrentAcceptance(
  db: Database,
  bookingId: string,
  now: Date,
): Promise<boolean> {
  const version = await getCurrentAgreementVersion(db, now);
  if (!version) return false;

  const [row] = await db
    .select({ id: agreementAcceptances.id })
    .from(agreementAcceptances)
    .where(
      and(
        eq(agreementAcceptances.bookingId, bookingId),
        eq(agreementAcceptances.agreementVersionId, version.id),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/** What a booking's agreement state looks like to a UI. */
export interface BookingAgreementState {
  /** Null only when nothing has ever been published. */
  currentVersion: AgreementVersion | null;
  /** The acceptance of the CURRENT version, if there is one. */
  acceptance: AgreementAcceptance | null;
  /**
   * True when this booking accepted an EARLIER version and the terms have
   * since changed. The UI says "our agreement was updated" rather than
   * "you have not accepted", which is a materially different sentence for
   * someone who remembers accepting.
   */
  supersededAcceptance: boolean;
  /** `acceptance !== null` — the same answer `bookingHasCurrentAcceptance` gives. */
  accepted: boolean;
}

/**
 * Everything a trip page or an agent screen needs about one booking's
 * agreement, in two queries rather than three round trips per surface.
 */
export async function getBookingAgreementState(
  db: Database,
  bookingId: string,
  now: Date,
): Promise<BookingAgreementState> {
  const currentVersion = await getCurrentAgreementVersion(db, now);
  const rows = await db
    .select()
    .from(agreementAcceptances)
    .where(eq(agreementAcceptances.bookingId, bookingId));

  const acceptance =
    currentVersion === null
      ? null
      : (rows.find((r) => r.agreementVersionId === currentVersion.id) ?? null);

  return {
    currentVersion,
    acceptance,
    supersededAcceptance: acceptance === null && rows.length > 0,
    accepted: acceptance !== null,
  };
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

/** Every version, newest first — the admin list. */
export async function listAgreementVersions(db: Database): Promise<AgreementVersion[]> {
  return db.select().from(agreementVersions).orderBy(desc(agreementVersions.version));
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

/**
 * How many in-flight bookings would have to re-accept if a new version were
 * published now — the number the publish confirmation puts in front of the
 * operator before they commit.
 *
 * It is every booking in a pre-visit status, with no join to acceptances,
 * and that is exact rather than approximate: a version that does not exist
 * yet has no acceptances at all, so ALL of them are affected. There is no
 * subset to subtract. The count exists so publishing a new version is a
 * decision with a visible cost ("847 customers will be asked again") rather
 * than a form submit.
 */
export async function countBookingsNeedingReacceptance(db: Database): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(bookings)
    .where(inArray(bookings.status, [...AGREEMENT_ACCEPTABLE_STATUSES]));
  return row?.n ?? 0;
}
