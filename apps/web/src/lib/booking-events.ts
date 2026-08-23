import "server-only";

import { getCustomerById, type Booking, type CoreConfig } from "@koolee/core";

import { inngest } from "@/lib/inngest";

/**
 * Booking lifecycle event emission — the bridge from the payment paths to the
 * Inngest side effects (confirmation email, pickup reminder, exception ops
 * alert).
 *
 * Contracts:
 *  - NEVER throws: an event that fails to enqueue must not fail a payment
 *    path whose money is already held. Logged and dropped — Inngest Cloud
 *    outages are visible in its dashboard, and the trip page remains the
 *    source of truth for the customer.
 *  - Idempotent by event id: every emitter passes a deterministic id, so the
 *    webhook/return-page race (and page refreshes inside the dedup window)
 *    collapse to one delivered event. Callers ALSO gate on "this call
 *    performed the move" (`movedTo` / `movedToPaid`), which is what holds
 *    beyond the dedup window.
 */

export async function emitBookingConfirmed(
  core: CoreConfig,
  booking: Booking,
): Promise<void> {
  try {
    const customer = await getCustomerById(core.db, booking.userId);
    await inngest.send({
      id: `booking-confirmed:${booking.id}`,
      name: "booking/confirmed",
      data: {
        bookingId: booking.id,
        pickupStartAt: (booking.pickupWindowStart ?? booking.departureAt).toISOString(),
        departureAt: booking.departureAt.toISOString(),
        customerPhone: booking.contactPhone ?? customer?.phone ?? "",
        customerName: booking.paxName,
      },
    });
  } catch (error) {
    console.error(`[events] booking/confirmed emit failed for ${booking.id}`, error);
  }
}

export async function emitExceptionRaised(input: {
  bookingId: string;
  reason: string;
  /** Distinguishes independent raises of the same booking (e.g. webhook event id). */
  dedupeKey: string;
  raisedByUserId?: string;
}): Promise<void> {
  try {
    await inngest.send({
      id: `booking-exception:${input.bookingId}:${input.dedupeKey}`,
      name: "booking/exception_raised",
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
      `[events] booking/exception_raised emit failed for ${input.bookingId}`,
      error,
    );
  }
}
