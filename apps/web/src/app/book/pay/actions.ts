"use server";

import {
  ensureBookingPaymentIntent,
  NotFoundError,
  OutOfCoverageError,
  PaymentFailedError,
  setBookingContactPhone,
  SlotNotSellableError,
} from "@koolee/core";

import { getVerifiedAuthUser } from "@/lib/auth";
import { readDraft, writeDraft } from "@/lib/booking-draft";
import { nextIncompleteStep } from "@/lib/booking-steps";
import { buildCheckoutSetup, isDraftReadyForPayment } from "@/lib/checkout";
import { getCore, stripeCheckoutState } from "@/lib/core";
import { syncDraftRow } from "@/lib/draft-sync";
import { toE164UsCa } from "@/lib/phone";

/**
 * Server side of the Stripe checkout card.
 *
 * `preparePayment` is invoked by the client component AFTER mount — never
 * during a GET render, so a link prefetch of /book/pay can never create a
 * booking. It creates-or-reuses the draft's PaymentIntent through core's
 * `ensureBookingPaymentIntent` (one intent per funnel draft) and returns ONLY
 * the client secret + display amount to the browser. Amounts come from the
 * pricing engine server-side; nothing is computed client-side.
 */

export type PreparePaymentResult =
  /** Mount the Payment Element against this client secret. */
  | { ok: true; kind: "ready"; bookingId: string; clientSecret: string; amountCents: number }
  /** Payment already confirmed (or settling) — navigate to the return path. */
  | { ok: true; kind: "redirect"; redirectTo: string }
  | { ok: false; error: string; redirectTo?: string };

export async function preparePayment(): Promise<PreparePaymentResult> {
  // This action exists for the real-Stripe path only; the fake provider's
  // pay step submits the plain confirmBooking form instead.
  if (stripeCheckoutState() !== "ready") {
    return { ok: false, error: "Card checkout is not configured." };
  }

  const draft = await readDraft();
  if (!isDraftReadyForPayment(draft)) {
    return {
      ok: false,
      error: "Your booking is incomplete.",
      redirectTo: nextIncompleteStep(draft),
    };
  }

  const authUser = await getVerifiedAuthUser();
  if (!authUser) {
    return { ok: false, error: "Verify a contact first.", redirectTo: "/book/verify" };
  }

  let core;
  try {
    core = getCore();
  } catch {
    return {
      ok: false,
      error:
        "The database is not configured. Set DATABASE_URL in .env.local (see the README quickstart).",
    };
  }

  try {
    const { input } = await buildCheckoutSetup(core, authUser, draft);

    const result = await ensureBookingPaymentIntent(core, {
      ...input,
      contactPhone: null,
      existingBookingId: draft.bookingId ?? null,
    });

    // Remember the booking so a revisit reuses its intent (the idempotency
    // contract) and so the return path can find it.
    await writeDraft({ bookingId: result.bookingId });
    await syncDraftRow();

    if (result.kind === "ready") {
      return {
        ok: true,
        kind: "ready",
        bookingId: result.bookingId,
        clientSecret: result.clientSecret,
        amountCents: result.amountCents,
      };
    }
    // already_authorized / processing: the return route reconciles
    // server-side and routes to confirmed / pending / retry.
    return {
      ok: true,
      kind: "redirect",
      redirectTo: `/book/return?booking=${result.bookingId}`,
    };
  } catch (error: unknown) {
    if (error instanceof SlotNotSellableError) {
      return {
        ok: false,
        error: "That window can no longer be booked for your flight. Pick another.",
        redirectTo: "/book/slot",
      };
    }
    if (error instanceof OutOfCoverageError) {
      return { ok: false, error: "That address is outside our service area." };
    }
    if (error instanceof PaymentFailedError) {
      console.error("[pay] preparePayment provider failure", error);
      return {
        ok: false,
        error:
          "We couldn't set up the payment. You have not been charged — please try again.",
      };
    }

    console.error("[pay] preparePayment failed", error);
    return {
      ok: false,
      error: "Something went wrong. You have not been charged.",
    };
  }
}

export type SaveContactPhoneResult = { ok: true } | { ok: false; error: string };

/**
 * Email-only customers: the pickup-day contact number, saved onto the draft
 * booking BEFORE the browser confirms the payment. Ownership and
 * draft-status are enforced in core (`setBookingContactPhone`).
 */
export async function saveCheckoutContactPhone(
  bookingId: string,
  rawPhone: string,
): Promise<SaveContactPhoneResult> {
  const authUser = await getVerifiedAuthUser();
  if (!authUser) return { ok: false, error: "Your session expired. Sign in again." };

  const contactPhone = toE164UsCa(rawPhone);
  if (!contactPhone) {
    return { ok: false, error: "Enter a contact number for the driver on pickup day." };
  }

  let core;
  try {
    core = getCore();
  } catch {
    return { ok: false, error: "The database is not configured." };
  }

  try {
    await setBookingContactPhone(core, {
      bookingId,
      userId: authUser.id,
      contactPhone,
    });
    return { ok: true };
  } catch (error: unknown) {
    if (error instanceof NotFoundError) {
      return { ok: false, error: "This booking can no longer be updated. Refresh the page." };
    }
    console.error("[pay] saveCheckoutContactPhone failed", error);
    return { ok: false, error: "We couldn't save that number. Try again." };
  }
}
