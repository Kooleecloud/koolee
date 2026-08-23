import { eq } from "drizzle-orm";
import {
  bookings,
  custodyEvents,
  payments,
  paymentWebhookEvents,
  type Database,
} from "@koolee/db";

import type { CoreConfig } from "../config";
import { canTransition, transition } from "../booking/state-machine";
import type { PaymentEvent } from "../payments/types";
import { autoAssignOnPaid } from "./auto-assign";

/**
 * Payment webhook handling.
 *
 * Route handlers verify the signature with `PaymentProvider.verifyWebhook` and
 * hand the normalised event here. Nothing provider-specific reaches this file.
 *
 * Idempotency, two layers:
 *  1. processed event ids are recorded in `payment_webhook_events` — a
 *     redelivered event id is a no-op before any work happens;
 *  2. status-guarded updates underneath, so even a concurrent duplicate
 *     (delivered before the first one finished) cannot double-apply.
 */

export interface WebhookOutcome {
  handled: boolean;
  note: string;
  bookingId?: string;
  /**
   * Set only when THIS call performed a status transition (e.g. "paid",
   * "exception") — a redelivered/no-op event leaves it unset. The route
   * handler keys side effects (confirmation email event, exception alert)
   * off this so they fire exactly once.
   */
  movedTo?: string;
}

export async function handlePaymentEvent(
  config: CoreConfig,
  event: PaymentEvent,
): Promise<WebhookOutcome> {
  const { db, payments: provider } = config;

  // Replay guard: seen this event id before → nothing to do.
  const seen = await db.query.paymentWebhookEvents.findFirst({
    where: (t, { and: andOp, eq: eqOp }) =>
      andOp(eqOp(t.provider, provider.name), eqOp(t.eventId, event.id)),
    columns: { id: true },
  });
  if (seen) {
    return { handled: true, note: `Replay of ${event.id} ignored` };
  }

  const outcome = await applyPaymentEvent(config, event);

  // Record AFTER successful handling, so a crash mid-way lets the provider's
  // redelivery finish the job (the status guards make that safe).
  await db
    .insert(paymentWebhookEvents)
    .values({ provider: provider.name, eventId: event.id, eventType: event.type })
    .onConflictDoNothing();

  return outcome;
}

async function applyPaymentEvent(
  config: CoreConfig,
  event: PaymentEvent,
): Promise<WebhookOutcome> {
  const { db, payments: provider } = config;

  const bookingId =
    event.bookingId ?? (await bookingIdForRef(db, provider.name, event.providerRef));
  if (!bookingId) {
    // Unknown reference: acknowledge so the provider stops retrying, but say so.
    return {
      handled: false,
      note: `No booking matches ${provider.name} ref ${event.providerRef}`,
    };
  }

  switch (event.type) {
    case "payment.authorized":
      return moveBooking(config, bookingId, "authorize_payment", event, "authorized");

    case "payment.captured":
      await recordPaymentStatus(db, provider.name, event.providerRef, "captured");
      return { handled: true, note: "Payment captured", bookingId };

    case "payment.refunded":
      await recordPaymentStatus(db, provider.name, event.providerRef, "refunded");
      return { handled: true, note: "Payment refunded", bookingId };

    case "payment.cancelled": {
      // Auth expired or was cancelled provider-side. Pre-transit, the state
      // machine allows a plain cancel. Once the bags are moving, "the money
      // vanished" is an ops exception, not a cancellation — fall through to
      // raise_exception where the matrix allows it.
      await recordPaymentStatus(db, provider.name, event.providerRef, "cancelled");
      const booking = await db.query.bookings.findFirst({
        where: eq(bookings.id, bookingId),
        columns: { status: true },
      });
      if (
        booking &&
        !canTransition(booking.status, "cancel") &&
        canTransition(booking.status, "raise_exception")
      ) {
        return moveBooking(config, bookingId, "raise_exception", event, "cancelled");
      }
      return moveBooking(config, bookingId, "cancel", event, "cancelled");
    }

    case "payment.failed":
      // A failed authorization never reaches `paid`: only payment.authorized
      // drives that transition, so recording the failure is all there is.
      await recordPaymentStatus(db, provider.name, event.providerRef, "failed");
      return { handled: true, note: "Payment failed", bookingId };

    case "payment.unknown":
    default:
      return { handled: false, note: `Ignoring event type ${event.type}`, bookingId };
  }
}

async function bookingIdForRef(
  db: Database,
  provider: string,
  providerRef: string,
): Promise<string | null> {
  const row = await db.query.payments.findFirst({
    where: eq(payments.providerRef, providerRef),
  });
  return row && row.provider === provider ? row.bookingId : null;
}

async function recordPaymentStatus(
  db: Database,
  provider: string,
  providerRef: string,
  status: "authorized" | "captured" | "refunded" | "cancelled" | "failed",
): Promise<void> {
  await db.update(payments).set({ status }).where(eq(payments.providerRef, providerRef));
  void provider;
}

/**
 * Applies a transition driven by a payment event.
 *
 * A booking already in the target state is treated as success — that is what
 * makes a redelivered webhook a no-op rather than an error the provider keeps
 * retrying.
 */
async function moveBooking(
  config: CoreConfig,
  bookingId: string,
  event: Parameters<typeof transition>[1]["event"],
  paymentEvent: PaymentEvent,
  paymentStatus: "authorized" | "cancelled",
): Promise<WebhookOutcome> {
  const { db, payments: provider } = config;

  const booking = await db.query.bookings.findFirst({
    where: eq(bookings.id, bookingId),
  });
  if (!booking) {
    return { handled: false, note: `Booking ${bookingId} not found`, bookingId };
  }

  const attempted = transition(booking, {
    event,
    metadata: {
      source: "webhook",
      provider: provider.name,
      providerRef: paymentEvent.providerRef,
      eventId: paymentEvent.id,
    },
  });

  if (!attempted.ok) {
    return {
      handled: true,
      note: `Booking already ${booking.status}; nothing to do (${attempted.error.message})`,
      bookingId,
    };
  }

  const { from, to, custodyEvent } = attempted.value;

  await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(bookings)
      .set({ status: to })
      .where(eq(bookings.id, bookingId))
      .returning();

    if (updated && updated.status === to) {
      await tx.insert(custodyEvents).values(custodyEvent);
    }

    await tx
      .update(payments)
      .set({ status: paymentStatus })
      .where(eq(payments.providerRef, paymentEvent.providerRef));
  });

  // On-paid dispatch: fires only when THIS call performed the move, so a
  // redelivered webhook (already-in-target no-op above) never re-fires it.
  // Never throws; failure leaves the booking paid-unassigned for the board.
  if (to === "paid") {
    await autoAssignOnPaid(config, bookingId);
  }

  return { handled: true, note: `Booking moved ${from} → ${to}`, bookingId, movedTo: to };
}
