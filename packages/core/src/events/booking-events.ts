import type { EventEmitter } from "./emitter";

/**
 * Booking lifecycle events, shaped in ONE place.
 *
 * Before this module the exception alert was emitted from a single Next.js
 * route handler, which meant six of the seven states that can raise an
 * exception produced no ops alert at all — an agent flagging a problem at the
 * customer's door was silent. Emission now lives beside the transition that
 * causes it (`applyTransition`, and the webhook's own `moveBooking`), so a
 * new path into `exception` is covered by construction rather than by
 * remembering to add a call.
 *
 * Contract, identical to the notifier's: emission NEVER throws. The booking
 * has already moved and its custody event is already written; failing the
 * caller now would report a transition that demonstrably happened as an
 * error. Failures are logged and dropped — the exceptions board remains the
 * source of truth either way.
 */

/** Wire name. Unchanged from the original webhook emit — consumers depend on it. */
export const BOOKING_EXCEPTION_RAISED = "booking/exception_raised";

export interface ExceptionRaisedInput {
  bookingId: string;
  /** Human-readable; lands in the ops email body verbatim. */
  reason: string;
  /**
   * Distinguishes independent raises of the SAME booking. The custody event
   * id is the natural value: one row per raise, written in the same
   * transaction as the status change, so a retried caller that performed no
   * transition emits nothing at all rather than a duplicate.
   */
  dedupeKey: string;
  raisedByUserId?: string | undefined;
}

export async function emitExceptionRaised(
  emitter: EventEmitter,
  input: ExceptionRaisedInput,
): Promise<void> {
  try {
    await emitter.emit({
      name: BOOKING_EXCEPTION_RAISED,
      id: `booking-exception:${input.bookingId}:${input.dedupeKey}`,
      data: {
        bookingId: input.bookingId,
        reason: input.reason,
        ...(input.raisedByUserId === undefined
          ? {}
          : { raisedByUserId: input.raisedByUserId }),
      },
    });
  } catch (error) {
    console.error(
      `[events] ${BOOKING_EXCEPTION_RAISED} emit failed for ${input.bookingId}`,
      error,
    );
  }
}


/** Same contract as the exception emit: NEVER throws. */
async function emitQuietly(
  emitter: EventEmitter,
  event: { name: string; id: string; data: Record<string, unknown> },
  context: string,
): Promise<void> {
  try {
    await emitter.emit(event);
  } catch (error) {
    console.error(`[events] ${event.name} emit failed for ${context}`, error);
  }
}

/* ------------------------------------------------------------------ */
/* Assignment and sealing — the F2 additions                           */
/* ------------------------------------------------------------------ */

export const BOOKING_AGENT_ASSIGNED = "booking/agent_assigned";
export const BOOKING_BAGS_SEALED = "booking/bags_sealed";

export interface AgentAssignedInput {
  bookingId: string;
  agentUserId: string;
}

/**
 * A verification visit got an owner.
 *
 * DEDUPED ON (booking, agent), not on a custody event id. The customer needs
 * one "your agent is Nina" per agent, and reassignment to a different person
 * is a different fact they must be told about — but a retried write, or ops
 * re-picking the SAME agent, is not news. This is the one place in the
 * codebase where the dedupe key is intentionally coarser than the write.
 */
export async function emitAgentAssigned(
  emitter: EventEmitter,
  input: AgentAssignedInput,
): Promise<void> {
  await emitQuietly(
    emitter,
    {
      name: BOOKING_AGENT_ASSIGNED,
      id: `booking-agent-assigned:${input.bookingId}:${input.agentUserId}`,
      data: { bookingId: input.bookingId, agentUserId: input.agentUserId },
    },
    input.bookingId,
  );
}

export interface BagsSealedInput {
  bookingId: string;
  /** The custody event id of the transition — one per sealing, ever. */
  dedupeKey: string;
}

/** Every bag sealed; the driver shortlist just opened. */
export async function emitBagsSealed(
  emitter: EventEmitter,
  input: BagsSealedInput,
): Promise<void> {
  await emitQuietly(
    emitter,
    {
      name: BOOKING_BAGS_SEALED,
      id: `booking-bags-sealed:${input.bookingId}:${input.dedupeKey}`,
      data: { bookingId: input.bookingId },
    },
    input.bookingId,
  );
}

/* ------------------------------------------------------------------ */
/* Driver / pickup events                                              */
/* ------------------------------------------------------------------ */

export const BOOKING_DRIVER_SELECTED = "booking/driver_selected";
export const BOOKING_DELIVERED_TO_BAGDROP = "booking/delivered_to_bagdrop";
export const BOOKING_DRIVER_POOL_EMPTY = "booking/driver_pool_empty";

export interface DriverSelectedInput {
  bookingId: string;
  shiftId: string;
  driverUserId: string;
  /**
   * Distinguishes independent selections of the same booking — selection is
   * re-runnable, and a customer who changes their mind must get the second
   * email too. The custody event id is the natural value.
   */
  dedupeKey: string;
}

export async function emitDriverSelected(
  emitter: EventEmitter,
  input: DriverSelectedInput,
): Promise<void> {
  await emitQuietly(
    emitter,
    {
      name: BOOKING_DRIVER_SELECTED,
      id: `booking-driver-selected:${input.bookingId}:${input.dedupeKey}`,
      data: {
        bookingId: input.bookingId,
        shiftId: input.shiftId,
        driverUserId: input.driverUserId,
      },
    },
    input.bookingId,
  );
}

export interface DeliveredToBagdropInput {
  bookingId: string;
  deliveredAt: Date;
  /** The custody event id of the transition — one per delivery, ever. */
  dedupeKey: string;
}

export async function emitDeliveredToBagdrop(
  emitter: EventEmitter,
  input: DeliveredToBagdropInput,
): Promise<void> {
  await emitQuietly(
    emitter,
    {
      name: BOOKING_DELIVERED_TO_BAGDROP,
      id: `booking-delivered:${input.bookingId}:${input.dedupeKey}`,
      data: {
        bookingId: input.bookingId,
        deliveredAt: input.deliveredAt.toISOString(),
      },
    },
    input.bookingId,
  );
}

export interface DriverPoolEmptyInput {
  bookingId: string;
  zip: string;
  bagCount: number;
  /** Injectable so the hour bucket below is deterministic under test. */
  now: Date;
}

/**
 * ONE ALERT PER BOOKING PER HOUR.
 *
 * This fires from a render: the trip page raises it whenever it has nothing to
 * offer, and a customer refreshing a page they are anxious about would page
 * ops on every reload. The dedupe is the event id — Inngest drops a repeated
 * id, so bucketing the id by the hour is the whole throttle, with no state to
 * store and nothing to clean up.
 *
 * The bucket is UTC on purpose: it is a rate limit, not a time a human reads.
 */
export async function emitDriverPoolEmpty(
  emitter: EventEmitter,
  input: DriverPoolEmptyInput,
): Promise<void> {
  const hourBucket = input.now.toISOString().slice(0, 13);
  await emitQuietly(
    emitter,
    {
      name: BOOKING_DRIVER_POOL_EMPTY,
      id: `booking-driver-pool-empty:${input.bookingId}:${hourBucket}`,
      data: {
        bookingId: input.bookingId,
        zip: input.zip,
        bagCount: input.bagCount,
      },
    },
    input.bookingId,
  );
}
