import { and, desc, eq } from "drizzle-orm";
import { bookings, payments, type Booking } from "@koolee/db";

import type { CoreConfig } from "../config";
import { NotFoundError, PaymentFailedError } from "../errors";
import type { PaymentAuth } from "../payments/types";
import { applyTransition } from "./bookings";
import { createBooking, type CreateBookingInput } from "./create-booking";
import { cancelBookingWithRefund } from "./payment-lifecycle";
import { quoteBookingPrice } from "./quote";

/**
 * The pay step's server side: one PaymentIntent per funnel draft.
 *
 * Entering the pay step calls `ensureBookingPaymentIntent`; returning from the
 * provider's confirmation flow calls `reconcileBookingPayment`. Both read the
 * provider ONLY through the `PaymentProvider` seam, and the booking moves ONLY
 * through the state machine — a client-side success signal is never trusted.
 *
 * Idempotency contract: re-visiting the pay step must not mint a second
 * intent. The caller passes the booking id its funnel draft remembered
 * (`existingBookingId`); when the cookie lost it, the newest `draft`-status
 * booking whose fields fingerprint-match the funnel draft is reused instead.
 *
 * Amount-changed contract, documented per the seam:
 *  - PURE amount drift (same window/bags/flight/address/passenger — e.g. a
 *    promo code applied after the intent was created, or a pricing-rule
 *    change) is handled by `PaymentProvider.updateAuthAmount` — Stripe
 *    supports updating a not-yet-confirmed intent's amount natively — and
 *    the payments row + booking price follow in one transaction.
 *  - A STRUCTURAL draft change (different window, bag count, flight, address,
 *    or passenger) makes the booking row itself stale, not just its amount:
 *    the stale draft booking is cancelled through `cancelBookingWithRefund`
 *    (matrix cancel + intent void through the seam) and a fresh booking +
 *    intent are created.
 */

export interface EnsurePaymentIntentInput extends CreateBookingInput {
  /** Booking id the funnel draft remembered from a previous pay-step visit. */
  existingBookingId?: string | null;
}

export type EnsurePaymentIntentResult =
  /** Mount the Payment Element against `clientSecret`. */
  | {
      kind: "ready";
      bookingId: string;
      providerRef: string;
      clientSecret: string;
      amountCents: number;
      /** An existing intent was reused rather than a second one created. */
      reused: boolean;
      /** The reused intent's amount was updated through the seam. */
      amountUpdated: boolean;
    }
  /** Funds already held (instant-auth provider, or a webhook race) — go to the return path. */
  | { kind: "already_authorized"; bookingId: string }
  /** Confirmation happened, outcome pending — go to the return path, do not re-confirm. */
  | { kind: "processing"; bookingId: string };

export async function ensureBookingPaymentIntent(
  config: CoreConfig,
  input: EnsurePaymentIntentInput,
): Promise<EnsurePaymentIntentResult> {
  const { db, payments: provider } = config;

  const candidate = await findReusableBooking(config, input);

  if (candidate) {
    if (candidate.status !== "draft") {
      // Anything on the paid path means the money side already succeeded —
      // the return path reconciles and routes to the confirmed page.
      return { kind: "already_authorized", bookingId: candidate.id };
    }

    const payment = fingerprintMatches(candidate, input)
      ? await db.query.payments.findFirst({
          where: and(
            eq(payments.bookingId, candidate.id),
            eq(payments.provider, provider.name),
          ),
          orderBy: [desc(payments.createdAt)],
        })
      : // Structural mismatch: the booking row is stale regardless of what
        // the intent says — skip straight to cancel + recreate.
        undefined;

    // A draft booking without a payments row is a crash remnant (authorize
    // never completed); treat it like any other stale draft.
    if (payment) {
      const auth = await provider.getAuth(payment.providerRef);

      if (auth.status === "authorized") {
        return { kind: "already_authorized", bookingId: candidate.id };
      }
      if (auth.status === "processing") {
        return { kind: "processing", bookingId: candidate.id };
      }

      if (auth.status === "requires_action" && auth.clientSecret) {
        // Same booking inputs — but the PRICE may have drifted (promo code,
        // pricing-rule change). The engine is re-consulted every visit so a
        // stale amount can never be confirmed.
        const { breakdown } = await quoteBookingPrice(config, {
          pickupWindowEnd: input.pickupWindowEnd,
          departureAt: input.departureAt,
          bagCount: input.bagCount,
          distanceKm: input.distanceKm,
          promoCode: input.promoCode ?? null,
          isSenior: input.isSenior ?? false,
        });

        if (breakdown.totalCents === auth.amountCents) {
          return {
            kind: "ready",
            bookingId: candidate.id,
            providerRef: payment.providerRef,
            clientSecret: auth.clientSecret,
            amountCents: auth.amountCents,
            reused: true,
            amountUpdated: false,
          };
        }

        const updated = await provider.updateAuthAmount(
          payment.providerRef,
          breakdown.totalCents,
        );
        if (!updated.clientSecret) {
          throw new PaymentFailedError(
            `Provider returned no client secret after amount update on ${payment.providerRef}`,
          );
        }
        await db.transaction(async (tx) => {
          await tx
            .update(payments)
            .set({ amountCents: updated.amountCents })
            .where(eq(payments.id, payment.id));
          await tx
            .update(bookings)
            .set({ priceCents: updated.amountCents })
            .where(and(eq(bookings.id, candidate.id), eq(bookings.status, "draft")));
        });
        return {
          kind: "ready",
          bookingId: candidate.id,
          providerRef: payment.providerRef,
          clientSecret: updated.clientSecret,
          amountCents: updated.amountCents,
          reused: true,
          amountUpdated: true,
        };
      }
      // auth.status === "failed" (cancelled/expired provider-side), or a
      // requires_action intent the provider returned no secret for: dead.
    }

    await cancelStaleDraft(config, candidate.id, input.userId);
  }

  return createFreshIntent(config, input);
}

/**
 * The booking the pay step may reuse: the draft-cookie's remembered id when
 * it still belongs to this user, otherwise the newest `draft` booking whose
 * fields fingerprint-match the funnel draft (covers a lost cookie key and the
 * strict-mode double-invoke, both of which would otherwise mint a second
 * intent).
 *
 * A remembered booking that no longer matches the funnel draft is STILL
 * returned when it sits in `draft` — the caller decides between amount-update
 * and cancel + recreate. Non-draft statuses are returned only so the caller
 * can route already-paid bookings to the return path; `cancelled`/`exception`
 * remnants are ignored.
 */
async function findReusableBooking(
  config: CoreConfig,
  input: EnsurePaymentIntentInput,
): Promise<Booking | null> {
  const { db } = config;

  if (input.existingBookingId) {
    const remembered = await db.query.bookings.findFirst({
      where: eq(bookings.id, input.existingBookingId),
    });
    if (
      remembered &&
      remembered.userId === input.userId &&
      remembered.status !== "cancelled" &&
      remembered.status !== "exception"
    ) {
      if (remembered.status !== "draft" || fingerprintMatches(remembered, input)) {
        return remembered;
      }
      // Draft that no longer matches the funnel: stale — cancel + recreate.
      return remembered;
    }
  }

  const recentDrafts = await db
    .select()
    .from(bookings)
    .where(and(eq(bookings.userId, input.userId), eq(bookings.status, "draft")))
    .orderBy(desc(bookings.createdAt))
    .limit(3);

  return recentDrafts.find((b) => fingerprintMatches(b, input)) ?? null;
}

/**
 * Whether the booking row still describes the funnel draft. Contact phone is
 * deliberately excluded — it is attached after the intent exists (see
 * `setBookingContactPhone`) and never affects the price or the window.
 * Legacy slot-era drafts have NULL window columns, so they never match and
 * fall through to cancel + recreate — the safe outcome.
 */
function fingerprintMatches(booking: Booking, input: CreateBookingInput): boolean {
  return (
    booking.pickupWindowStart?.getTime() === input.pickupWindowStart.getTime() &&
    booking.pickupWindowEnd?.getTime() === input.pickupWindowEnd.getTime() &&
    booking.pickupAddressId === input.pickupAddressId &&
    booking.bagCount === input.bagCount &&
    booking.flightNumber === input.flightNumber.toUpperCase() &&
    booking.airlineIata === input.airlineIata.toUpperCase() &&
    booking.departureAirport === input.departureAirport &&
    booking.departureAt.getTime() === input.departureAt.getTime() &&
    booking.paxName === input.paxName
  );
}

/**
 * A superseded draft must not keep holding a confirmable intent.
 * `cancelBookingWithRefund` is the existing, matrix-gated path for
 * exactly that (it voids `pending` intents too). A refusal means someone
 * moved the booking concurrently — the fresh create proceeds regardless and
 * the survivor is visible to ops, never silently overwritten.
 */
async function cancelStaleDraft(
  config: CoreConfig,
  bookingId: string,
  userId: string,
): Promise<void> {
  const result = await cancelBookingWithRefund(config, {
    bookingId,
    actor: { userId, role: "customer" },
    reason: "checkout_draft_superseded",
  });
  if (!result.ok) {
    console.warn(
      `[payment-intent] stale draft ${bookingId} could not be cancelled: ${result.error}`,
    );
  }
}

async function createFreshIntent(
  config: CoreConfig,
  input: EnsurePaymentIntentInput,
): Promise<EnsurePaymentIntentResult> {
  const { existingBookingId: _ignored, ...createInput } = input;
  const result = await createBooking(config, createInput);
  const auth: PaymentAuth = result.payment;

  if (auth.status === "authorized") {
    // Instant-auth provider (the fake, in dev): booking is already paid.
    return { kind: "already_authorized", bookingId: result.booking.id };
  }
  if (auth.status === "processing") {
    return { kind: "processing", bookingId: result.booking.id };
  }
  if (!auth.clientSecret) {
    throw new PaymentFailedError(
      `Provider returned neither an authorization nor a client secret for booking ${result.booking.id}`,
    );
  }
  return {
    kind: "ready",
    bookingId: result.booking.id,
    providerRef: auth.authId,
    clientSecret: auth.clientSecret,
    amountCents: auth.amountCents,
    reused: false,
    amountUpdated: false,
  };
}

/* ------------------------------------------------------------------ */
/* Return-path reconciliation                                          */
/* ------------------------------------------------------------------ */

export interface ReconcileBookingPaymentInput {
  bookingId: string;
  /** The session user — ownership is enforced, 404-shaped on mismatch. */
  userId: string;
}

export type ReconcileBookingPaymentResult =
  /** Funds held; the booking is (now) `paid` or beyond. */
  | { outcome: "authorized"; bookingId: string }
  /** Confirmation submitted, outcome still settling — show pending copy. */
  | { outcome: "processing"; bookingId: string }
  /** Never confirmed (abandoned, or 3DS/decline bounced it back) — retry on the pay step. */
  | { outcome: "not_completed"; bookingId: string }
  /** Authorization is dead (cancelled/expired) — retry mints a fresh intent. */
  | { outcome: "failed"; bookingId: string };

/**
 * The server-side status re-check the return page runs: reads the intent
 * through the seam and advances the booking through the SAME matrix move the
 * webhook uses. Webhook-race-safe: whichever side moves the booking first
 * wins, the other treats "already paid" as success — mirroring the webhook
 * handler's own replay semantics.
 */
export async function reconcileBookingPayment(
  config: CoreConfig,
  input: ReconcileBookingPaymentInput,
): Promise<ReconcileBookingPaymentResult> {
  const { db, payments: provider } = config;
  const { bookingId } = input;

  const booking = await db.query.bookings.findFirst({
    where: eq(bookings.id, bookingId),
  });
  if (!booking || booking.userId !== input.userId) {
    // 404-shaped on foreign bookings: existence is itself a disclosure.
    throw new NotFoundError("Booking", bookingId);
  }

  if (booking.status === "cancelled") return { outcome: "failed", bookingId };
  if (booking.status !== "draft") {
    // paid or beyond — the webhook (or a previous re-check) already advanced it.
    return { outcome: "authorized", bookingId };
  }

  const payment = await db.query.payments.findFirst({
    where: and(eq(payments.bookingId, bookingId), eq(payments.provider, provider.name)),
    orderBy: [desc(payments.createdAt)],
  });
  if (!payment) return { outcome: "failed", bookingId };

  const auth = await provider.getAuth(payment.providerRef);

  switch (auth.status) {
    case "authorized": {
      const moved = await applyTransition(config, {
        bookingId,
        event: "authorize_payment",
        metadata: {
          source: "return_page_recheck",
          provider: provider.name,
          providerRef: payment.providerRef,
        },
      });
      if (!moved.ok) {
        // Concurrent webhook: success if it moved the booking onto the paid
        // path; anything else is a genuine failure.
        const current = await db.query.bookings.findFirst({
          where: eq(bookings.id, bookingId),
          columns: { status: true },
        });
        if (!current || current.status === "draft" || current.status === "cancelled") {
          return { outcome: "failed", bookingId };
        }
      }
      // Guarded: never downgrade a row the webhook already advanced past.
      await db
        .update(payments)
        .set({ status: "authorized" })
        .where(and(eq(payments.id, payment.id), eq(payments.status, "pending")));
      return { outcome: "authorized", bookingId };
    }
    case "processing":
      return { outcome: "processing", bookingId };
    case "requires_action":
      return { outcome: "not_completed", bookingId };
    case "failed":
    default: {
      await db
        .update(payments)
        .set({ status: "cancelled" })
        .where(and(eq(payments.id, payment.id), eq(payments.status, "pending")));
      return { outcome: "failed", bookingId };
    }
  }
}

/* ------------------------------------------------------------------ */
/* Contact phone attach                                                */
/* ------------------------------------------------------------------ */

export interface SetBookingContactPhoneInput {
  bookingId: string;
  userId: string;
  /** E.164 — the caller validates format; core enforces ownership + state. */
  contactPhone: string;
}

/**
 * Email-only customers enter a pickup-day contact number in the checkout
 * card, AFTER the intent (and therefore the booking) exists. Guarded update:
 * only the owner, only while the booking is still `draft` — one WHERE clause,
 * 404-shaped on any miss, matching the read paths' disclosure rule.
 */
export async function setBookingContactPhone(
  config: CoreConfig,
  input: SetBookingContactPhoneInput,
): Promise<Booking> {
  const [updated] = await config.db
    .update(bookings)
    .set({ contactPhone: input.contactPhone })
    .where(
      and(
        eq(bookings.id, input.bookingId),
        eq(bookings.userId, input.userId),
        eq(bookings.status, "draft"),
      ),
    )
    .returning();

  if (!updated) throw new NotFoundError("Draft booking", input.bookingId);
  return updated;
}
