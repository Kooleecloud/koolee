import { and, desc, eq, sql } from "drizzle-orm";
import { custodyEvents, payments, slots, type Payment } from "@koolee/db";

import type { TransitionActor } from "../booking/state-machine";
import type { CoreConfig } from "../config";
import { NotFoundError } from "../errors";
import { applyTransition } from "./bookings";

/**
 * The deferred Stripe loop, closed: capture at pickup and refund on
 * cancellation — everything through the `PaymentProvider` seam, booking
 * movement only through the state machine, corrections only as appended
 * custody events.
 */

export interface CaptureBookingPaymentInput {
  bookingId: string;
  /** The staff member completing verification — the real actor id. */
  actor: TransitionActor;
}

export type CaptureBookingPaymentResult =
  | { ok: true; payment: Payment; captureRef: string }
  | {
      /**
       * Ops-visible exception: capture failed, the booking was moved to
       * `exception` through the state machine (with a custody event carrying
       * the reason) and ops was alerted. NOT a silent log line.
       */
      ok: false;
      reason: string;
    };

/**
 * Captures the authorized amount when the agent completes verification and
 * sealing (Phase 6 calls this from that completion action).
 *
 * Failure handling is the point: a failed capture moves the booking to the
 * state machine's exception state and pages ops — bags must not travel on an
 * unpaid booking without a human deciding so.
 */
export async function captureBookingPayment(
  config: CoreConfig,
  input: CaptureBookingPaymentInput,
): Promise<CaptureBookingPaymentResult> {
  const { db, payments: provider } = config;

  const payment = await db.query.payments.findFirst({
    where: and(
      eq(payments.bookingId, input.bookingId),
      eq(payments.provider, provider.name),
      eq(payments.status, "authorized"),
    ),
    orderBy: [desc(payments.createdAt)],
  });
  if (!payment) {
    throw new NotFoundError("Authorized payment for booking", input.bookingId);
  }

  try {
    const capture = await provider.capture(payment.providerRef);

    await db.transaction(async (tx) => {
      await tx
        .update(payments)
        .set({ status: "captured", captureRef: capture.captureId })
        .where(eq(payments.id, payment.id));

      // The capture is a custody-relevant fact: money moved because the
      // bags did. Appended alongside the verification event the completion
      // flow writes.
      await tx.insert(custodyEvents).values({
        bookingId: input.bookingId,
        actorUserId: input.actor.userId,
        actorRole: input.actor.role,
        eventType: "booking.payment_captured",
        metadata: {
          provider: provider.name,
          providerRef: payment.providerRef,
          captureRef: capture.captureId,
          amountCents: capture.amountCents,
        },
      });
    });

    const [updated] = await db.select().from(payments).where(eq(payments.id, payment.id));
    return { ok: true, payment: updated!, captureRef: capture.captureId };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);

    // Ops-visible, never silent: exception state + alert.
    await applyTransition(config, {
      bookingId: input.bookingId,
      event: "raise_exception",
      actor: input.actor,
      metadata: { reason: "payment_capture_failed", detail: reason },
    });
    try {
      await config.opsAlerter.alert({
        severity: "critical",
        title: `Payment capture failed for booking ${input.bookingId}`,
        detail: { reason },
      });
    } catch (alertError) {
      console.error("[payment-lifecycle] ops alert failed", alertError);
    }

    return { ok: false, reason };
  }
}

export interface CancelBookingInput {
  bookingId: string;
  actor: TransitionActor;
  /** Recorded in the custody trail. */
  reason?: string;
}

export type CancelBookingResult =
  | {
      ok: true;
      /** "refunded" | "auth_cancelled" | "none" — what happened to the money. */
      money: "refunded" | "auth_cancelled" | "none";
    }
  | { ok: false; error: string };

/**
 * Cancels a booking through the state machine and unwinds the money through
 * the provider seam: a captured payment is refunded IN FULL, an un-captured
 * authorization is voided.
 *
 * TODO(fee-policy): no cancellation-fee rule exists in `pricing_rules` or
 * core, so the refund is always full. When a commercial policy lands, the
 * fee calculation belongs here — never invented ad hoc.
 *
 * The state machine is the authority on WHEN cancellation is possible
 * (nothing from `in_transit` onward). Slot capacity is released with the
 * cancellation, mirroring the compensation semantics `createBooking` uses.
 */
export async function cancelBookingWithRefund(
  config: CoreConfig,
  input: CancelBookingInput,
): Promise<CancelBookingResult> {
  const { db, payments: provider } = config;

  const moved = await applyTransition(config, {
    bookingId: input.bookingId,
    event: "cancel",
    actor: input.actor,
    metadata: { ...(input.reason ? { reason: input.reason } : {}) },
  });
  if (!moved.ok) {
    return { ok: false, error: moved.error.message };
  }

  // Release the seat the booking held, exactly like the payment-failure
  // compensation path does.
  if (moved.value.slotId) {
    await db
      .update(slots)
      .set({ bookedCount: sql`greatest(${slots.bookedCount} - 1, 0)` })
      .where(eq(slots.id, moved.value.slotId));
  }

  const payment = await db.query.payments.findFirst({
    where: and(
      eq(payments.bookingId, input.bookingId),
      eq(payments.provider, provider.name),
    ),
    orderBy: [desc(payments.createdAt)],
  });
  if (!payment || payment.status === "failed" || payment.status === "refunded") {
    return { ok: true, money: "none" };
  }

  try {
    if (payment.status === "captured") {
      const refund = await provider.refund(payment.captureRef ?? payment.providerRef);
      await db.transaction(async (tx) => {
        await tx
          .update(payments)
          .set({ status: "refunded" })
          .where(eq(payments.id, payment.id));
        await tx.insert(custodyEvents).values({
          bookingId: input.bookingId,
          actorUserId: input.actor.userId,
          actorRole: input.actor.role,
          eventType: "booking.payment_refunded",
          metadata: {
            provider: provider.name,
            refundId: refund.refundId,
            amountCents: refund.amountCents,
          },
        });
      });
      return { ok: true, money: "refunded" };
    }

    // `pending` (intent awaiting client confirmation) is voided exactly like
    // an authorization: the cancelled booking must not leave a confirmable
    // intent behind that could still place a hold.
    if (payment.status === "authorized" || payment.status === "pending") {
      await provider.cancelAuth(payment.providerRef);
      await db.transaction(async (tx) => {
        await tx
          .update(payments)
          .set({ status: "cancelled" })
          .where(eq(payments.id, payment.id));
        await tx.insert(custodyEvents).values({
          bookingId: input.bookingId,
          actorUserId: input.actor.userId,
          actorRole: input.actor.role,
          eventType: "booking.payment_auth_cancelled",
          metadata: { provider: provider.name, providerRef: payment.providerRef },
        });
      });
      return { ok: true, money: "auth_cancelled" };
    }

    return { ok: true, money: "none" };
  } catch (error) {
    // The booking is cancelled but the money is stuck — ops must see it.
    const detail = error instanceof Error ? error.message : String(error);
    await db.insert(custodyEvents).values({
      bookingId: input.bookingId,
      actorUserId: input.actor.userId,
      actorRole: input.actor.role,
      eventType: "booking.payment_unwind_failed",
      metadata: { provider: provider.name, detail },
    });
    try {
      await config.opsAlerter.alert({
        severity: "critical",
        title: `Refund/void failed for cancelled booking ${input.bookingId}`,
        detail: { detail },
      });
    } catch (alertError) {
      console.error("[payment-lifecycle] ops alert failed", alertError);
    }
    return { ok: true, money: "none" };
  }
}
