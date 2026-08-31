import { and, asc, eq } from "drizzle-orm";
import {
  bags,
  bookings,
  custodyEvents,
  driverShifts,
  pickupTasks,
  trucks,
  users,
  type Bag,
  type Booking,
  type CustodyEvent,
  type Database,
  type PickupTask,
} from "@koolee/db";

import type { AgentSession } from "../auth/types";
import type { CoreConfig } from "../config";
import { emitDeliveredToBagdrop } from "../events/booking-events";
import { ConflictError, NotFoundError } from "../errors";
import { assertActionable } from "./actionability";
import { applyTransition } from "./bookings";
import { resolveDisplayTz } from "./display-tz";
import { PICKUP_EVENT_TYPES } from "./pickup-events";
import { bookingPickupAddress, type PickupAddress } from "./pickup-address";

/**
 * The pickup run — the driver's half of the job, and the first code to move a
 * booking past `verified_sealed`.
 *
 * Until this file existed, four state-machine transitions had no production
 * caller at all (`mark_awaiting_pickup`, `start_transit`, `deliver_to_bagdrop`,
 * `complete`), nothing ever advanced a `pickup_tasks` row, and the agent app's
 * pickup screen was a card headed "Not in the app yet".
 *
 * Hard rails, the same ones the verification visit runs on:
 *  - authorization is ASSIGNMENT. Every function resolves the task by
 *    (id, assignee = session.userId) in the WHERE clause; somebody else's task
 *    does not resolve, it 404s. Never checked after the fact.
 *  - this file only ever touches `pickup_tasks`, never `verification_tasks`.
 *  - every step appends custody. The booking's own lifecycle events come from
 *    `applyTransition`; the driver-specific ones are named in
 *    `pickup-events.ts`.
 *  - it does NOT touch money. Capture is swept from the web app
 *    (`captureDueBookings`) for the reasons written in `agent-visit.ts`.
 *
 * EVERY STEP IS IDEMPOTENT. The agent app is an offline-prone PWA on a phone
 * in a van: a tap that times out gets tapped again, and the second tap must
 * not fail, double-append, or advance anything twice. Each function therefore
 * checks "has this already happened?" first and returns the current state
 * rather than erroring — which is also what makes an optimistic UI safe.
 */

export interface PickupContext {
  task: PickupTask;
  booking: Booking;
  bags: Bag[];
  /** Bag ids whose seal has been matched at the door on THIS pickup. */
  scannedBagIds: string[];
  timeline: CustodyEvent[];
  /** The booking's display zone (its departure airport's). See display-tz.ts. */
  tz: string;
  /**
   * The doorstep, off the booking's own snapshot — never a join. Always
   * present: a booking cannot exist without one (see 0033), which is why this
   * is no longer nullable and the "no address on file" branch is gone.
   */
  address: PickupAddress;
  customer: {
    fullName: string | null;
    avatarStoragePath: string | null;
    /** The account's verified number, for the door. See `doorContact`. */
    phone: string | null;
  } | null;
  /** The shift this pickup belongs to, once a customer has chosen a driver. */
  shift: { id: string; truckName: string } | null;
}

const actorOf = (session: AgentSession) => ({
  userId: session.userId,
  role: session.role,
});

/**
 * The pickup task, its booking, its bags and what has been scanned so far —
 * assignment-scoped.
 *
 * "What has been scanned" is derived from `custody_events`, not from a column.
 * The scan IS the evidence — an append-only row with the bag, the seal, the
 * driver and (best effort) the coordinates — so a second place to record it
 * would be a second thing to keep in step, and the one that could disagree
 * with the chain of custody.
 */
export async function getPickupContext(
  db: Database,
  session: AgentSession,
  taskId: string,
): Promise<PickupContext> {
  const task = await db.query.pickupTasks.findFirst({
    where: and(
      eq(pickupTasks.id, taskId),
      eq(pickupTasks.assigneeUserId, session.userId),
    ),
  });
  if (!task) throw new NotFoundError("Pickup task", taskId);

  const booking = await db.query.bookings.findFirst({
    where: eq(bookings.id, task.bookingId),
  });
  if (!booking) throw new NotFoundError("Booking", task.bookingId);

  const [bagRows, timeline, tz, customerRows, shiftRows] = await Promise.all([
    // By ordinal, never createdAt — this is the list the driver counts down.
    db.select().from(bags).where(eq(bags.bookingId, booking.id)).orderBy(asc(bags.ordinal)),
    db
      .select()
      .from(custodyEvents)
      .where(eq(custodyEvents.bookingId, booking.id))
      .orderBy(asc(custodyEvents.createdAt)),
    resolveDisplayTz(db, booking.departureAirport),
    // Name, face and the door number. A driver outside a building with no
    // buzzer answer has exactly one useful action; withholding the number
    // stranded both of them. Email and the verification timestamps stay
    // unselected — see `doorContact`.
    db
      .select({
        fullName: users.fullName,
        avatarStoragePath: users.avatarStoragePath,
        phone: users.phone,
      })
      .from(users)
      .where(eq(users.id, booking.userId))
      .limit(1),
    task.driverShiftId
      ? db
          .select({ id: driverShifts.id, truckName: trucks.name })
          .from(driverShifts)
          .innerJoin(trucks, eq(trucks.id, driverShifts.truckId))
          .where(eq(driverShifts.id, task.driverShiftId))
          .limit(1)
      : Promise.resolve([]),
  ]);

  return {
    task,
    booking,
    bags: bagRows,
    scannedBagIds: scannedBagIdsFrom(timeline),
    timeline,
    tz,
    address: bookingPickupAddress(booking),
    customer: customerRows[0] ?? null,
    shift: shiftRows[0] ?? null,
  };
}

function scannedBagIdsFrom(timeline: CustodyEvent[]): string[] {
  return [
    ...new Set(
      timeline
        .filter((e) => e.eventType === PICKUP_EVENT_TYPES.seal_scanned && e.bagId)
        .map((e) => e.bagId as string),
    ),
  ];
}

export type PickupStepResult = { ok: true } | { ok: false; error: string };

export interface PickupStepInput {
  taskId: string;
  lat?: number | null;
  lng?: number | null;
}

/* ------------------------------------------------------------------ */
/* 1. Setting off                                                      */
/* ------------------------------------------------------------------ */

/**
 * The driver has left for the door.
 *
 * Moves the booking `verified_sealed → awaiting_pickup` if it is not there
 * already, stamps the task started, and appends `pickup.travel_started`. From
 * this moment the customer's trip page expects GPS pings, and the driver
 * choice is CLOSED — `selectDriver` refuses once `started_at` is set.
 *
 * Idempotent: a second tap returns ok and changes nothing.
 */
export async function startPickupTravel(
  config: CoreConfig,
  session: AgentSession,
  input: PickupStepInput,
): Promise<PickupStepResult> {
  const { db } = config;
  const context = await getPickupContext(db, session, input.taskId);

  // Idempotency first, deliberately BEFORE the gate: a driver who has already
  // set off is in the carve-out — the van keeps moving, and re-tapping the
  // button must not now refuse them or raise an exception on a booking whose
  // bags are already in transit.
  if (context.task.startedAt !== null) return { ok: true };

  await assertActionable(config, context.booking, "startPickup", actorOf(session));

  if (context.booking.status === "verified_sealed") {
    const moved = await applyTransition(config, {
      bookingId: context.booking.id,
      event: "mark_awaiting_pickup",
      actor: actorOf(session),
      lat: input.lat ?? null,
      lng: input.lng ?? null,
      metadata: { taskId: context.task.id, shiftId: context.task.driverShiftId },
    });
    if (!moved.ok) return { ok: false, error: moved.error.message };
  } else if (context.booking.status !== "awaiting_pickup") {
    return {
      ok: false,
      error: `Booking is ${context.booking.status} — a pickup starts once the bags are sealed.`,
    };
  }

  await db.transaction(async (tx) => {
    await tx
      .update(pickupTasks)
      .set({ status: "in_progress", startedAt: config.clock.now(), updatedAt: new Date() })
      .where(eq(pickupTasks.id, context.task.id));

    await tx.insert(custodyEvents).values({
      bookingId: context.booking.id,
      actorUserId: session.userId,
      actorRole: session.role,
      eventType: PICKUP_EVENT_TYPES.travel_started,
      lat: input.lat ?? null,
      lng: input.lng ?? null,
      metadata: { taskId: context.task.id, shiftId: context.task.driverShiftId },
    });
  });

  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* 2. Seals at the door                                                */
/* ------------------------------------------------------------------ */

export interface ScanSealInput extends PickupStepInput {
  /** Whatever the scanner or the keyboard produced. Compared, never parsed. */
  sealValue: string;
}

export interface ScanSealResult {
  ok: true;
  bagId: string;
  scannedCount: number;
  totalBags: number;
  /** True on the scan that completed the set and moved the booking. */
  custodyTransferred: boolean;
}

/**
 * Matches one seal against the bags of THIS booking, and transfers custody
 * once every bag has been matched.
 *
 * The match is scoped to the booking on purpose. `bags.seal_id` is unique
 * operation-wide (partial index, `WHERE seal_id IS NOT NULL`), so a seal from
 * another booking WOULD resolve to a real bag — and loading somebody else's
 * bag into this van is exactly the mistake worth refusing loudly. A
 * non-matching value appends `pickup.seal_mismatch`, alerts ops, and throws;
 * the driver's next move is the exception path, not a retry.
 *
 * No format rule beyond a trim. The seal id is deliberately opaque (see
 * `schema/bookings.ts`) — the technology behind it is undecided and no code
 * may infer structure from the value.
 *
 * ALL BAGS BEFORE CUSTODY MOVES. `start_transit` fires on the scan that
 * completes the set, never earlier: a partially loaded van with the booking
 * marked in-transit is a booking whose timeline says Koolee has bags it does
 * not have.
 *
 * Idempotent: re-scanning a bag already scanned returns the same counts and
 * appends nothing.
 */
export async function scanSealAtPickup(
  config: CoreConfig,
  session: AgentSession,
  input: ScanSealInput,
): Promise<ScanSealResult> {
  const { db } = config;
  const context = await getPickupContext(db, session, input.taskId);

  const sealValue = input.sealValue.trim();
  if (!sealValue) {
    throw new ConflictError("seal", "Scan or type the seal id.");
  }

  if (context.task.startedAt === null) {
    throw new ConflictError("seal", "Start the pickup before scanning seals.");
  }

  const bag = context.bags.find((b) => b.sealId === sealValue);
  if (!bag) {
    await recordSealMismatch(config, session, context, sealValue, input);
    throw new ConflictError(
      "seal",
      `Seal ${sealValue} is not on booking ${context.booking.ref}. Do not load that bag — file an exception and call ops.`,
    );
  }

  const totalBags = context.bags.length;
  if (context.scannedBagIds.includes(bag.id)) {
    return {
      ok: true,
      bagId: bag.id,
      scannedCount: context.scannedBagIds.length,
      totalBags,
      custodyTransferred: false,
    };
  }

  await db.insert(custodyEvents).values({
    bookingId: context.booking.id,
    bagId: bag.id,
    actorUserId: session.userId,
    actorRole: session.role,
    eventType: PICKUP_EVENT_TYPES.seal_scanned,
    lat: input.lat ?? null,
    lng: input.lng ?? null,
    metadata: { taskId: context.task.id, sealId: sealValue, ordinal: bag.ordinal },
  });

  const scannedCount = context.scannedBagIds.length + 1;
  let custodyTransferred = false;

  if (scannedCount === totalBags && totalBags > 0) {
    const moved = await applyTransition(config, {
      bookingId: context.booking.id,
      event: "start_transit",
      actor: actorOf(session),
      lat: input.lat ?? null,
      lng: input.lng ?? null,
      metadata: {
        taskId: context.task.id,
        shiftId: context.task.driverShiftId,
        bagCount: totalBags,
      },
    });
    // A booking already `in_transit` (a retry that got further than the caller
    // thinks) is not a failure — the bags are where the driver says they are.
    custodyTransferred = moved.ok;
  }

  return { ok: true, bagId: bag.id, scannedCount, totalBags, custodyTransferred };
}

async function recordSealMismatch(
  config: CoreConfig,
  session: AgentSession,
  context: PickupContext,
  sealValue: string,
  input: PickupStepInput,
): Promise<void> {
  await config.db.insert(custodyEvents).values({
    bookingId: context.booking.id,
    actorUserId: session.userId,
    actorRole: session.role,
    eventType: PICKUP_EVENT_TYPES.seal_mismatch,
    lat: input.lat ?? null,
    lng: input.lng ?? null,
    metadata: { taskId: context.task.id, presented: sealValue },
  });

  // Never throws — an alerter that is down must not turn a refused seal into
  // a 500 in front of a customer's front door.
  try {
    await config.opsAlerter.alert({
      severity: "warning",
      title: `Seal ${sealValue} presented on booking ${context.booking.ref} does not belong to it`,
      detail: { bookingId: context.booking.id, taskId: context.task.id, sealValue },
    });
  } catch (alertError) {
    console.error("[pickup] ops alert failed", alertError);
  }
}

/* ------------------------------------------------------------------ */
/* 3. The bag drop                                                     */
/* ------------------------------------------------------------------ */

/**
 * The bags reached the airline's bag drop.
 *
 * DELIBERATELY NOT THE SAME STEP AS COMPLETION. The gap between arriving at
 * the counter and the airline actually taking the bags is a real interval —
 * queues, a closed counter, an agent asking for a document — and it is the
 * interval a customer most wants to see. Collapsing the two would mean the
 * timeline says "delivered" while a driver is still holding four suitcases.
 *
 * Idempotent: already-delivered returns ok.
 */
export async function deliverToBagdrop(
  config: CoreConfig,
  session: AgentSession,
  input: PickupStepInput,
): Promise<PickupStepResult> {
  const { db } = config;
  const context = await getPickupContext(db, session, input.taskId);

  if (
    context.booking.status === "delivered_to_bagdrop" ||
    context.booking.status === "completed"
  ) {
    return { ok: true };
  }

  const unscanned = context.bags.length - context.scannedBagIds.length;
  if (unscanned > 0) {
    return {
      ok: false,
      error: `${unscanned} bag(s) never scanned — scan every seal before delivering.`,
    };
  }

  const deliveredAt = config.clock.now();
  const moved = await applyTransition(config, {
    bookingId: context.booking.id,
    event: "deliver_to_bagdrop",
    actor: actorOf(session),
    lat: input.lat ?? null,
    lng: input.lng ?? null,
    metadata: {
      taskId: context.task.id,
      shiftId: context.task.driverShiftId,
      airport: context.booking.departureAirport,
    },
  });
  if (!moved.ok) return { ok: false, error: moved.error.message };

  // After the transition committed, and only because THIS call performed it —
  // `applyTransition`'s compare-and-swap means a loser never reaches here.
  // The agent app is send-only (its event emitter registers no functions); the
  // handler for this lives in apps/web's registry, which is the only place a
  // function is actually served from.
  await emitDeliveredToBagdrop(config.emitter, {
    bookingId: context.booking.id,
    deliveredAt,
    dedupeKey: context.task.id,
  });

  return { ok: true };
}

/**
 * The airline took the bags. Closes the booking and the task.
 *
 * This is the handover confirmation, one step after `deliverToBagdrop` — see
 * the note there for why the two are separate.
 *
 * Idempotent: a completed booking returns ok, and the task is closed either
 * way so a retry cannot leave it open.
 */
export async function confirmAirlineHandover(
  config: CoreConfig,
  session: AgentSession,
  input: PickupStepInput,
): Promise<PickupStepResult> {
  const { db } = config;
  const context = await getPickupContext(db, session, input.taskId);

  if (context.booking.status !== "completed") {
    const moved = await applyTransition(config, {
      bookingId: context.booking.id,
      event: "complete",
      actor: actorOf(session),
      lat: input.lat ?? null,
      lng: input.lng ?? null,
      metadata: { taskId: context.task.id, shiftId: context.task.driverShiftId },
    });
    if (!moved.ok) return { ok: false, error: moved.error.message };

    await db.insert(custodyEvents).values({
      bookingId: context.booking.id,
      actorUserId: session.userId,
      actorRole: session.role,
      eventType: PICKUP_EVENT_TYPES.handover_confirmed,
      lat: input.lat ?? null,
      lng: input.lng ?? null,
      metadata: { taskId: context.task.id, airport: context.booking.departureAirport },
    });
  }

  await db
    .update(pickupTasks)
    .set({ status: "done", completedAt: config.clock.now(), updatedAt: new Date() })
    .where(eq(pickupTasks.id, context.task.id));

  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* 4. When it goes wrong                                               */
/* ------------------------------------------------------------------ */

/** Exception reasons a driver can pick. `other` requires a note. */
export const PICKUP_EXCEPTION_REASONS = [
  "seal_mismatch",
  "bag_count_mismatch",
  "customer_not_home",
  "vehicle_problem",
  "bagdrop_refused",
  "other",
] as const;
export type PickupExceptionReason = (typeof PICKUP_EXCEPTION_REASONS)[number];

export interface PickupExceptionInput extends PickupStepInput {
  reason: PickupExceptionReason;
  note?: string;
}

/**
 * The driver's exception path. Same shape as `reportVisitException`: the
 * booking moves to `exception` (which is where `booking/exception_raised` is
 * emitted from — never re-emit it here), and the task is marked failed.
 * Resolution is admin territory.
 */
export async function reportPickupException(
  config: CoreConfig,
  session: AgentSession,
  input: PickupExceptionInput,
): Promise<PickupStepResult> {
  const { db } = config;
  const context = await getPickupContext(db, session, input.taskId);

  if (!PICKUP_EXCEPTION_REASONS.includes(input.reason)) {
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
      shiftId: context.task.driverShiftId,
      reason: input.reason,
      ...(input.note?.trim() ? { note: input.note.trim() } : {}),
    },
  });
  if (!moved.ok) return { ok: false, error: moved.error.message };

  await db
    .update(pickupTasks)
    .set({ status: "failed", updatedAt: new Date() })
    .where(eq(pickupTasks.id, context.task.id));

  try {
    await config.opsAlerter.alert({
      severity: "warning",
      title: `Pickup exception on booking ${context.booking.ref}: ${input.reason}`,
      detail: {
        bookingId: context.booking.id,
        taskId: context.task.id,
        ...(input.note ? { note: input.note } : {}),
      },
    });
  } catch (alertError) {
    console.error("[pickup] ops alert failed", alertError);
  }

  return { ok: true };
}
