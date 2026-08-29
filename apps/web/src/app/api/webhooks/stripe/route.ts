import { NextResponse } from "next/server";
import { getBooking, handlePaymentEvent, WebhookVerificationError } from "@koolee/core";

import { emitBookingConfirmed } from "@/lib/booking-events";

import { getCore } from "@/lib/core";

/**
 * Stripe webhook endpoint.
 *
 * A thin adapter, as required: read the raw body, verify the signature through
 * `PaymentProvider.verifyWebhook`, hand the normalised event to core. No Stripe
 * SDK import here — the ESLint rule would reject it.
 */

export const runtime = "nodejs";
// Signature verification is over the exact bytes Stripe sent; a cached or
// transformed body would fail it.
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing stripe-signature" }, { status: 400 });
  }

  // `request.text()` preserves the raw bytes. Never `request.json()` here.
  const payload = await request.text();

  let core;
  try {
    core = getCore();
  } catch (error: unknown) {
    // 503 rather than 500: Stripe retries a 503, and a missing DATABASE_URL is
    // a deployment problem we want the redelivery to paper over once fixed.
    console.error("[stripe-webhook] runtime unavailable", error);
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }

  let event;
  try {
    event = core.payments.verifyWebhook(payload, signature);
  } catch (error: unknown) {
    if (error instanceof WebhookVerificationError) {
      console.warn("[stripe-webhook] signature rejected", error.message);
      return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
    }
    throw error;
  }

  try {
    const outcome = await handlePaymentEvent(core, event);

    // Side effect keyed on "THIS delivery performed the move" (movedTo), so
    // Stripe redeliveries — which handlePaymentEvent reports as no-ops —
    // never re-fire it. The emitter is no-throw.
    //
    // `movedTo === "exception"` is deliberately NOT handled here any more:
    // core emits `booking/exception_raised` from the transition itself, which
    // is what gives the other six states that can raise one the same alert.
    // Adding it back would double-send.
    if (outcome.bookingId && outcome.movedTo === "paid") {
      const booking = await getBooking(core.db, outcome.bookingId);
      if (booking) await emitBookingConfirmed(core, booking);
    }

    // Always 200 once the signature is valid: a non-2xx makes Stripe retry, and
    // "we chose not to act on this event" is not a failure worth retrying.
    return NextResponse.json({ received: true, ...outcome });
  } catch (error: unknown) {
    // A genuine processing failure — let Stripe redeliver.
    console.error("[stripe-webhook] handler failed", error);
    return NextResponse.json({ error: "Handler failed" }, { status: 500 });
  }
}
