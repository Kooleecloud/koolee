import { eq } from "drizzle-orm";
import { bookings, custodyEvents, payments, type Database } from "@koolee/db";

import type { CoreConfig } from "../config";
import { transition } from "../booking/state-machine";
import type { PaymentEvent } from "../payments/types";

/**
 * Payment webhook handling.
 *
 * Route handlers verify the signature with `PaymentProvider.verifyWebhook` and
 * hand the normalised event here. Nothing provider-specific reaches this file.
 *
 * Idempotency comes from the unique index on `(provider, provider_ref)` plus
 * status-guarded updates: a redelivered event finds the booking already in the
 * target state and does nothing.
 */

export interface WebhookOutcome {
  handled: boolean;
  note: string;
  bookingId?: string;
}

export async function handlePaymentEvent(
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

    case "payment.cancelled":
      await recordPaymentStatus(db, provider.name, event.providerRef, "cancelled");
      return moveBooking(config, bookingId, "cancel", event, "cancelled");

    case "payment.failed":
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

  return { handled: true, note: `Booking moved ${from} → ${to}`, bookingId };
}
