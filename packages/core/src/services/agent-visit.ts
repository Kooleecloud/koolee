import { and, asc, desc, eq, sql } from "drizzle-orm";
import {
  bags,
  bookings,
  custodyEvents,
  payments,
  users,
  verificationTasks,
  type Bag,
  type Booking,
  type CustodyEvent,
  type Database,
  type PassportVerification,
  type Payment,
  type VerificationTask,
} from "@koolee/db";

import type { AgentSession } from "../auth/types";
import type { CoreConfig } from "../config";
import { ConflictError, NotFoundError } from "../errors";
import { getBookingAgreementState, type BookingAgreementState } from "./agreements";
import { assertActionable } from "./actionability";
import { applyTransition } from "./bookings";
import { resolveDisplayTz } from "./display-tz";
import { confirmPassport, getPassportVerification } from "./passport";
import { bookingPickupAddress, type PickupAddress } from "./pickup-address";

/**
 * The verification visit — the agent app's core flow.
 *
 * Hard rails (not up for style debates):
 *  - every step appends a `custody_events` row with the REAL agent user id
 *    and timestamps; GPS and photo land in the columns the schema has;
 *  - the verification/pickup task split stays: this file only ever touches
 *    `verification_tasks`;
 *  - completing the visit advances the booking through the state machine
 *    (`complete_verification`). It does NOT touch money: this app holds no
 *    payment credentials, and capture is swept from the web app instead
 *    (`captureDueBookings`);
 *  - authorization is assignment: every function resolves the task by
 *    (id, assignee = session.userId) — someone else's task 404s.
 *
 * Step-level custody event types (free-form text by design — the writer is
 * this module):
 */
export const VISIT_EVENT_TYPES = {
  arrived: "visit.arrived",
  /**
   * SUPERSEDED as a gate, kept as a name. Identity used to be a self-attested
   * checkbox ("ID matches the ticket") and the event it wrote is the only
   * record of every visit performed before this slice — so the constant stays
   * and the timeline keeps rendering it. What CHANGED is that nothing reads it
   * to decide whether the visit may continue; `passport_verifications` does.
   * See `identityGate` below.
   */
  identityVerified: "visit.identity_verified",
  bagSealed: "bag.sealed",
} as const;

/** Exception reasons the agent can pick. `other` requires a note. */
export const VISIT_EXCEPTION_REASONS = [
  "customer_not_home",
  "customer_id_mismatch",
  "bags_refused",
  "unsafe_conditions",
  "other",
] as const;
export type VisitExceptionReason = (typeof VISIT_EXCEPTION_REASONS)[number];

export interface VisitContext {
  task: VerificationTask;
  booking: Booking;
  bags: Bag[];
  /** Events for this booking, oldest first — the UI derives progress. */
  timeline: CustodyEvent[];
  /**
   * Latest payment status, for display ONLY — the agent needs to know the
   * booking is paid for before handling someone's luggage, and nothing more.
   * Reading a column requires no payment credentials, which is precisely why
   * the agent app can show this while being unable to move money.
   */
  paymentStatus: Payment["status"] | null;
  /**
   * The pickup address, off the booking's own snapshot.
   *
   * The agent app's visit screen used to render neither this nor the contact
   * number, which meant the one screen a driver looks at while standing on
   * somebody's doorstep could not tell them which doorstep. It was a join on
   * `addresses` until 0033; now the booking carries the doorstep it was made
   * for, so a customer editing their saved address mid-week cannot move an
   * agent who is already on their way.
   */
  address: PickupAddress;
  /**
   * The booking's display zone. The agent app renders every time through this
   * and never through the device or server zone: the agent has to show up for
   * the window the CUSTOMER bought, and the only way to guarantee both screens
   * agree is for both to read the booking's own zone. (Production servers run
   * in UTC, so a bare local format here put the agent 4–5 hours out.)
   */
  tz: string;
  /**
   * Who the agent is meeting.
   *
   * `booking.paxName` is the name on the TICKET, which is the name the seal
   * and the airline care about. This is the account holder's own display name
   * and face — what actually helps at a door, where the person answering has
   * to be recognised before a passport comes out. Null if the row went
   * missing; the screen degrades to the pax name and initials.
   */
  customer: {
    fullName: string | null;
    /** Key in the PRIVATE `avatars` bucket. Signed by whoever renders it. */
    avatarStoragePath: string | null;
    /**
     * The account's verified number, for the door. See `doorContact` — this
     * is ONE field, granted by the same relationship that already gives this
     * agent the address and the traveller's face, and nothing else about the
     * customer's row travels with it.
     */
    phone: string | null;
  } | null;
  /** The two things that must both be true before any bag may be sealed. */
  identityGate: VisitIdentityGate;
}

export type VisitGateBlocker = "agreement_not_accepted" | "passport_not_confirmed";

/**
 * The identity gate: the customer has accepted the CURRENT agreement, and the
 * assigned agent has confirmed the traveler's passport.
 *
 * This replaced a self-attested checkbox. The old step wrote
 * `visit.identity_verified` when the agent tapped "ID matches the ticket" —
 * evidence of a tap, and of nothing else. Now both halves are rows another
 * party wrote: the acceptance is the customer's (append-only, versioned), and
 * the passport confirmation names the agent who vouched.
 *
 * THERE IS NO OVERRIDE, deliberately. An agent who cannot clear the gate files
 * an exception (`reportVisitException`), which raises the booking, alerts ops
 * by email, and leaves a trail. An override would be a button whose only use
 * is to bypass the control the slice exists to add, and it would be pressed at
 * 6am on a doorstep by someone who just wants to finish the job.
 */
export interface VisitIdentityGate {
  agreement: BookingAgreementState;
  passport: PassportVerification | null;
  /** True only at `agent_confirmed` — an unreviewed upload is not a check. */
  passportConfirmed: boolean;
  /** In the order the agent should act on them. Empty when `passed`. */
  blockers: VisitGateBlocker[];
  passed: boolean;
}

function actorOf(session: AgentSession) {
  return { userId: session.userId, role: session.role };
}

/** The task, its booking, bags and timeline — assignment-scoped. */
export async function getVisitContext(
  db: Database,
  session: AgentSession,
  taskId: string,
  /**
   * The instant the agreement's "which version is current" derivation is read
   * at. Defaults to real now for the render path (which holds `db`, not a
   * `CoreConfig`); every function here that HAS a config passes
   * `config.clock.now()` so a fixed clock in tests governs the gate too.
   */
  now: Date = new Date(),
): Promise<VisitContext> {
  const task = await db.query.verificationTasks.findFirst({
    where: and(
      eq(verificationTasks.id, taskId),
      eq(verificationTasks.assigneeUserId, session.userId),
    ),
  });
  if (!task) throw new NotFoundError("Verification task", taskId);

  const booking = await db.query.bookings.findFirst({
    where: eq(bookings.id, task.bookingId),
  });
  if (!booking) throw new NotFoundError("Booking", task.bookingId);

  const [
    bagRows,
    timeline,
    paymentRows,
    tz,
    agreement,
    passport,
    customerRows,
  ] = await Promise.all([
    // By ordinal, never createdAt — see the note on `bags.ordinal`. This is the
    // list the agent seals down, so a shuffling order was visible in the UI.
    db
      .select()
      .from(bags)
      .where(eq(bags.bookingId, booking.id))
      .orderBy(asc(bags.ordinal)),
    db
      .select()
      .from(custodyEvents)
      .where(eq(custodyEvents.bookingId, booking.id))
      .orderBy(asc(custodyEvents.createdAt)),
    // Status column only — no provider call, no credentials.
    db
      .select({ status: payments.status })
      .from(payments)
      .where(eq(payments.bookingId, booking.id))
      .orderBy(desc(payments.createdAt))
      .limit(1),
    resolveDisplayTz(db, booking.departureAirport),
    // Both halves of the gate, fetched with everything else rather than on
    // demand: the agent screen renders them on every load, and a gate the UI
    // has to ask for separately is a gate that can be rendered as passed
    // before the answer arrives.
    getBookingAgreementState(db, booking.id, now),
    getPassportVerification(db, booking.id),
    // Name, face and the door number. Email and the verification timestamps
    // stay unselected — see `doorContact` for why the phone stopped being on
    // that list, and what is still withheld.
    db
      .select({
        fullName: users.fullName,
        avatarStoragePath: users.avatarStoragePath,
        phone: users.phone,
      })
      .from(users)
      .where(eq(users.id, booking.userId))
      .limit(1),
  ]);

  return {
    task,
    booking,
    bags: bagRows,
    timeline,
    paymentStatus: paymentRows[0]?.status ?? null,
    address: bookingPickupAddress(booking),
    tz,
    customer: customerRows[0] ?? null,
    identityGate: buildIdentityGate(agreement, passport),
  };
}

function buildIdentityGate(
  agreement: BookingAgreementState,
  passport: PassportVerification | null,
): VisitIdentityGate {
  const passportConfirmed = passport?.status === "agent_confirmed";
  const blockers: VisitGateBlocker[] = [];
  // Agreement first: it is the customer's action, and the agent can do
  // nothing about it except ask them to open their trip page. Telling them
  // that before the passport step saves a wasted photo.
  if (!agreement.accepted) blockers.push("agreement_not_accepted");
  if (!passportConfirmed) blockers.push("passport_not_confirmed");

  return {
    agreement,
    passport,
    passportConfirmed,
    blockers,
    passed: blockers.length === 0,
  };
}

/** The sentence the agent reads when a step is refused. */
export function identityGateMessage(gate: VisitIdentityGate): string | null {
  if (gate.passed) return null;
  const parts = gate.blockers.map((blocker) =>
    blocker === "agreement_not_accepted"
      ? "the customer has not accepted our booking agreement yet (they accept it on their trip page)"
      : "the traveler's passport has not been confirmed",
  );
  return `You can't seal bags yet — ${parts.join(", and ")}. If it can't be resolved at the door, flag a problem.`;
}

/**
 * Throws unless both halves are satisfied. Every step past identity calls this
 * FIRST, in core — the agent app's step ordering is a convenience, not the
 * guarantee, because a server action stays reachable as a POST regardless of
 * what the UI renders.
 */
function assertIdentityGate(context: VisitContext): void {
  const message = identityGateMessage(context.identityGate);
  if (message) throw new ConflictError("passport", message);
}

export interface ArriveInput {
  taskId: string;
  lat?: number | null;
  lng?: number | null;
}

/**
 * Step 1 — the agent is at the door. Marks the task in progress and opens
 * the visit's custody trail. Idempotent: arriving twice is one event.
 */
export async function arriveAtVisit(
  config: CoreConfig,
  session: AgentSession,
  input: ArriveInput,
): Promise<VisitContext> {
  const { db } = config;
  const context = await getVisitContext(db, session, input.taskId, config.clock.now());
  // Arriving is the visit's first forward step. Late-but-savable still runs
  // (the agent sees a "running late" notice instead); past the bag drop it
  // does not, and the attempt raises the exception ops resolves.
  await assertActionable(config, context.booking, "startVisit", actorOf(session));

  const alreadyArrived = context.timeline.some(
    (e) => e.eventType === VISIT_EVENT_TYPES.arrived,
  );
  if (!alreadyArrived) {
    await db.transaction(async (tx) => {
      await tx
        .update(verificationTasks)
        .set({ status: "in_progress", startedAt: new Date() })
        .where(eq(verificationTasks.id, context.task.id));
      await tx.insert(custodyEvents).values({
        bookingId: context.booking.id,
        actorUserId: session.userId,
        actorRole: session.role,
        eventType: VISIT_EVENT_TYPES.arrived,
        lat: input.lat ?? null,
        lng: input.lng ?? null,
        metadata: { taskId: context.task.id },
      });
    });
  }

  return getVisitContext(db, session, input.taskId, config.clock.now());
}

/**
 * Step 2 — the identity gate: confirm the traveler's passport.
 *
 * This REPLACES `recordIdentityVerified`, which wrote
 * `visit.identity_verified` when the agent tapped a checkbox. That step is
 * gone rather than kept alongside: two ways to satisfy identity means the
 * weaker one is the one that gets used at 6am, and a self-attested tap is
 * evidence of a tap. Confirmation now names the agent, timestamps itself, and
 * lands in `passport_verifications` — see `services/passport.ts`.
 *
 * The customer's agreement acceptance is the other half and is NOT something
 * the agent can do for them; it has to happen on the customer's own trip page,
 * which is the entire point of it being an acceptance.
 */
export async function confirmVisitIdentity(
  config: CoreConfig,
  session: AgentSession,
  input: { taskId: string; lat?: number | null; lng?: number | null },
): Promise<VisitContext> {
  const { db } = config;
  // Resolves the task assignment-scoped, so an unassigned task 404s here
  // before anything is written.
  const context = await getVisitContext(db, session, input.taskId, config.clock.now());

  /*
   * THE GATE THIS WAS MISSING (found 2026-08-29, F2 Phase 5).
   *
   * `arriveAtVisit` has carried `assertActionable` since F1; this step, one
   * tap later in the same flow, had none — so an agent whose task was still
   * assigned could append a `passport.agent_confirmed` custody event to a
   * booking that had already been delivered, completed or cancelled. The
   * append-only log of a closed booking would grow an entry days after the
   * bags reached the airline, and it would show on the customer's timeline.
   *
   * `startVisit` is the right action, not a sixth gate: this IS the visit, one
   * step after arriving, and it belongs to the phase before custody transfers
   * — which is exactly the set the carve-out covers. Late-but-savable still
   * runs (`startVisit` is permitted in `running_late`); past the bag drop it
   * refuses and raises the exception ops resolves, the same as arriving does.
   */
  await assertActionable(config, context.booking, "startVisit", actorOf(session));

  await confirmPassport(config, session, input);

  return getVisitContext(db, session, input.taskId, config.clock.now());
}

export interface SealBagInput {
  taskId: string;
  bagId: string;
  /** Serialized seal id — opaque string by design (RFID vs QR undecided). */
  sealId: string;
  /**
   * All three of seal id, weight and photo are REQUIRED to seal a bag. They
   * are the custody record: what was sealed, how heavy it was, and what it
   * looked like at the door. A bag sealed without them is undefendable in a
   * dispute, so there is no "skip" — an agent who cannot weigh or photograph
   * flags an exception (`reportVisitException`) instead of sealing.
   */
  weightKg: number;
  /** Storage path in the private bag-photos bucket (NOT a public URL). */
  photoPath: string;
  lat?: number | null;
  lng?: number | null;
}

/**
 * Step 3, per bag — weigh, seal, photograph. Updates the bag row and
 * appends the `bag.sealed` custody event carrying the evidence.
 */
export async function recordBagSealed(
  config: CoreConfig,
  session: AgentSession,
  input: SealBagInput,
): Promise<VisitContext> {
  const { db } = config;
  const context = await getVisitContext(db, session, input.taskId, config.clock.now());

  // The gate, enforced in CORE. The agent app hides the bag steps until it
  // passes, but a server action stays reachable as a POST whatever the UI
  // renders, so the UI is a convenience and this line is the guarantee.
  assertIdentityGate(context);

  const bag = context.bags.find((b) => b.id === input.bagId);
  if (!bag) throw new NotFoundError("Bag", input.bagId);
  if (bag.sealId) {
    throw new ConflictError(
      "seal",
      `Bag is already sealed (${bag.sealId}). Corrections are compensating events — flag an exception if the seal is wrong.`,
    );
  }
  const sealId = input.sealId.trim();
  if (!sealId) throw new ConflictError("seal", "Enter the seal id.");
  if (!(input.weightKg > 0)) {
    throw new ConflictError("seal", "Weigh the bag before sealing it.");
  }
  if (!input.photoPath) {
    throw new ConflictError("seal", "Photograph the bag before sealing it.");
  }

  // A tamper-evident seal is single-use, so a seal id is unique across the
  // whole operation — not merely within this booking. A repeat means either a
  // typo or a reused seal, and both are custody incidents. The real guarantee
  // is the partial unique index on `bags.seal_id` (migration 0017); this read
  // exists so the agent gets a sentence they can act on instead of a driver
  // error. It races (two agents, same id, same instant) and that is fine —
  // the index is what actually holds, and the insert below surfaces it.
  const clash = await db
    .select({ id: bags.id, bookingId: bags.bookingId })
    .from(bags)
    .where(eq(bags.sealId, sealId))
    .limit(1);
  if (clash.length > 0) {
    throw new ConflictError(
      "seal",
      clash[0]!.bookingId === context.booking.id
        ? `Seal ${sealId} is already on another bag in this booking — each bag needs its own seal.`
        : `Seal ${sealId} is already recorded against another booking. Check the number on the seal.`,
    );
  }

  await db.transaction(async (tx) => {
    await tx
      .update(bags)
      .set({
        sealId,
        weightKg: String(input.weightKg),
        photoUrls: sql`array_append(${bags.photoUrls}, ${input.photoPath})`,
      })
      .where(eq(bags.id, bag.id));

    await tx.insert(custodyEvents).values({
      bookingId: context.booking.id,
      bagId: bag.id,
      actorUserId: session.userId,
      actorRole: session.role,
      eventType: VISIT_EVENT_TYPES.bagSealed,
      lat: input.lat ?? null,
      lng: input.lng ?? null,
      photoUrl: input.photoPath,
      metadata: {
        taskId: context.task.id,
        sealId,
        weightKg: input.weightKg,
      },
    });
  });

  return getVisitContext(db, session, input.taskId, config.clock.now());
}

export type CompleteVisitResult = { ok: true } | { ok: false; error: string };

/**
 * Step 4 — completion: every bag sealed → the booking advances through the
 * state machine (`complete_verification`, real actor) and the task closes.
 *
 * Deliberately does NOT take the money. Capture is the web app's job, swept
 * by `captureDueBookings`, for two reasons:
 *
 *  - the agent app is not allowed to hold payment credentials (see its
 *    `lib/core.ts`), so capturing from here needed a provider it cannot have —
 *    it silently wired the FAKE one instead, and `captureBookingPayment`'s
 *    provider check then failed EVERY pickup with "authorized payment not
 *    found", dumping each booking into `exception` after the bags were already
 *    sealed and collected;
 *  - an agent standing at a door is the worst place to discover a billing
 *    problem. Custody and money move on separate tracks; ops owns the money.
 *
 * The agent still SEES whether the booking is paid (read-only, straight off
 * the payments row) — they just cannot move money.
 */
export async function completeVerificationVisit(
  config: CoreConfig,
  session: AgentSession,
  input: { taskId: string; lat?: number | null; lng?: number | null },
): Promise<CompleteVisitResult> {
  const { db } = config;
  const context = await getVisitContext(db, session, input.taskId, config.clock.now());

  // Belt and braces. Every bag being sealed already implies the gate passed
  // (nothing can be sealed without it), but a booking with ZERO bags would
  // slip through that implication, and "complete" is the step that moves
  // custody to Koolee.
  const gateMessage = identityGateMessage(context.identityGate);
  if (gateMessage) return { ok: false, error: gateMessage };

  const unsealed = context.bags.filter((b) => !b.sealId);
  if (unsealed.length > 0) {
    return {
      ok: false,
      error: `${unsealed.length} bag(s) not sealed yet — seal every bag before completing.`,
    };
  }

  const moved = await applyTransition(config, {
    bookingId: context.booking.id,
    event: "complete_verification",
    actor: actorOf(session),
    lat: input.lat ?? null,
    lng: input.lng ?? null,
    metadata: { taskId: context.task.id, bagCount: context.bags.length },
  });
  if (!moved.ok) {
    return { ok: false, error: moved.error.message };
  }

  await db
    .update(verificationTasks)
    .set({ status: "done", completedAt: new Date() })
    .where(eq(verificationTasks.id, context.task.id));

  return { ok: true };
}

export interface VisitExceptionInput {
  taskId: string;
  reason: VisitExceptionReason;
  note?: string;
  lat?: number | null;
  lng?: number | null;
}

/**
 * Exception path — customer not home, ID mismatch, bags refused… The
 * booking moves to the state machine's exception state with a custody event
 * carrying the reason; the task is marked failed. Resolution is admin
 * territory (Phase 7 manual overrides) — deliberately NOT built here.
 */
export async function reportVisitException(
  config: CoreConfig,
  session: AgentSession,
  input: VisitExceptionInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { db } = config;
  const context = await getVisitContext(db, session, input.taskId, config.clock.now());

  if (!VISIT_EXCEPTION_REASONS.includes(input.reason)) {
    return { ok: false, error: "Pick a reason." };
  }
  if (input.reason === "other" && !input.note?.trim()) {
    return { ok: false, error: "Describe what happened." };
  }

  const moved = await applyTransition(config, {
    bookingId: context.booking.id,
    event: "raise_exception",
    actor: actorOf(session),
    lat: input.lat ?? null,
    lng: input.lng ?? null,
    metadata: {
      taskId: context.task.id,
      reason: input.reason,
      ...(input.note?.trim() ? { note: input.note.trim() } : {}),
    },
  });
  if (!moved.ok) {
    return { ok: false, error: moved.error.message };
  }

  await db
    .update(verificationTasks)
    .set({ status: "failed" })
    .where(eq(verificationTasks.id, context.task.id));

  try {
    await config.opsAlerter.alert({
      severity: "warning",
      title: `Visit exception on booking ${context.booking.id}: ${input.reason}`,
      detail: { taskId: context.task.id, ...(input.note ? { note: input.note } : {}) },
    });
  } catch (alertError) {
    console.error("[agent-visit] ops alert failed", alertError);
  }

  return { ok: true };
}
