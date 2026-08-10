import { and, asc, eq, sql } from "drizzle-orm";
import {
  bags,
  bookings,
  custodyEvents,
  verificationTasks,
  type Bag,
  type Booking,
  type CustodyEvent,
  type Database,
  type VerificationTask,
} from "@koolee/db";

import type { AgentSession } from "../auth/types";
import type { CoreConfig } from "../config";
import { ConflictError, NotFoundError } from "../errors";
import { applyTransition } from "./bookings";
import { captureBookingPayment } from "./payment-lifecycle";

/**
 * The verification visit — the agent app's core flow.
 *
 * Hard rails (not up for style debates):
 *  - every step appends a `custody_events` row with the REAL agent user id
 *    and timestamps; GPS and photo land in the columns the schema has;
 *  - the verification/pickup task split stays: this file only ever touches
 *    `verification_tasks`;
 *  - completing the visit advances the booking through the state machine
 *    (`complete_verification`) and triggers the Phase 5 payment capture;
 *  - authorization is assignment: every function resolves the task by
 *    (id, assignee = session.userId) — someone else's task 404s.
 *
 * Step-level custody event types (free-form text by design — the writer is
 * this module):
 */
export const VISIT_EVENT_TYPES = {
  arrived: "visit.arrived",
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
}

function actorOf(session: AgentSession) {
  return { userId: session.userId, role: session.role };
}

/** The task, its booking, bags and timeline — assignment-scoped. */
export async function getVisitContext(
  db: Database,
  session: AgentSession,
  taskId: string,
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

  const [bagRows, timeline] = await Promise.all([
    db.select().from(bags).where(eq(bags.bookingId, booking.id)).orderBy(asc(bags.createdAt)),
    db
      .select()
      .from(custodyEvents)
      .where(eq(custodyEvents.bookingId, booking.id))
      .orderBy(asc(custodyEvents.createdAt)),
  ]);

  return { task, booking, bags: bagRows, timeline };
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
  const context = await getVisitContext(db, session, input.taskId);

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

  return getVisitContext(db, session, input.taskId);
}

/**
 * Step 2 — photo-ID check against the passenger name on the booking. A
 * mismatch is not recorded as "verified": the agent raises an exception
 * instead (that path is `reportVisitException`).
 */
export async function recordIdentityVerified(
  config: CoreConfig,
  session: AgentSession,
  input: { taskId: string },
): Promise<VisitContext> {
  const { db } = config;
  const context = await getVisitContext(db, session, input.taskId);

  const already = context.timeline.some(
    (e) => e.eventType === VISIT_EVENT_TYPES.identityVerified,
  );
  if (!already) {
    await db.insert(custodyEvents).values({
      bookingId: context.booking.id,
      actorUserId: session.userId,
      actorRole: session.role,
      eventType: VISIT_EVENT_TYPES.identityVerified,
      metadata: { taskId: context.task.id, paxName: context.booking.paxName },
    });
  }
  return getVisitContext(db, session, input.taskId);
}

export interface SealBagInput {
  taskId: string;
  bagId: string;
  /** Serialized seal id — opaque string by design (RFID vs QR undecided). */
  sealId: string;
  weightKg?: number | null;
  /** Storage path in the private bag-photos bucket (NOT a public URL). */
  photoPath?: string | null;
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
  const context = await getVisitContext(db, session, input.taskId);

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

  await db.transaction(async (tx) => {
    await tx
      .update(bags)
      .set({
        sealId,
        ...(input.weightKg != null ? { weightKg: String(input.weightKg) } : {}),
        ...(input.photoPath
          ? { photoUrls: sql`array_append(${bags.photoUrls}, ${input.photoPath})` }
          : {}),
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
      photoUrl: input.photoPath ?? null,
      metadata: {
        taskId: context.task.id,
        sealId,
        ...(input.weightKg != null ? { weightKg: input.weightKg } : {}),
      },
    });
  });

  return getVisitContext(db, session, input.taskId);
}

export type CompleteVisitResult =
  | { ok: true; capture: "captured" | "capture_failed" }
  | { ok: false; error: string };

/**
 * Step 4 — completion: every bag sealed → booking advances through the
 * state machine (`complete_verification`, real actor) → the authorized
 * payment is CAPTURED (Phase 5). A capture failure is already ops-visible
 * inside `captureBookingPayment` (exception state + critical alert); it is
 * surfaced here so the agent sees "ops will follow up", not a fake success.
 */
export async function completeVerificationVisit(
  config: CoreConfig,
  session: AgentSession,
  input: { taskId: string; lat?: number | null; lng?: number | null },
): Promise<CompleteVisitResult> {
  const { db } = config;
  const context = await getVisitContext(db, session, input.taskId);

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

  // Money follows the bags: capture the authorization now that the bags
  // are sealed and in our custody. `captureBookingPayment` makes provider
  // failures ops-visible itself; a THROWN error (e.g. no authorized payment
  // row at all) must land in the same exception path, never escape
  // half-completed.
  let captured = false;
  try {
    const capture = await captureBookingPayment(config, {
      bookingId: context.booking.id,
      actor: actorOf(session),
    });
    captured = capture.ok;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    await applyTransition(config, {
      bookingId: context.booking.id,
      event: "raise_exception",
      actor: actorOf(session),
      metadata: { reason: "payment_capture_failed", detail },
    });
    try {
      await config.opsAlerter.alert({
        severity: "critical",
        title: `Payment capture failed for booking ${context.booking.id}`,
        detail: { detail },
      });
    } catch (alertError) {
      console.error("[agent-visit] ops alert failed", alertError);
    }
  }

  return { ok: true, capture: captured ? "captured" : "capture_failed" };
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
  const context = await getVisitContext(db, session, input.taskId);

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
