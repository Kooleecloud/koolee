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
