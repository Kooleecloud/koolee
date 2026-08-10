import { NextResponse } from "next/server";
import { NotFoundError, reconcileBookingPayment, softDeleteBookingDraft } from "@koolee/core";

import { getVerifiedAuthUser } from "@/lib/auth";
import { DRAFT_COOKIE_NAME } from "@/lib/booking-draft";
import { tryGetCore } from "@/lib/core";

/**
 * Stripe's `return_url` lands here after every confirmation attempt — card
 * success, 3DS challenge outcome, or failure.
 *
 * The ONLY authority consulted is core's `reconcileBookingPayment`, which
 * re-reads the intent through the `PaymentProvider` seam and advances the
 * booking through the same matrix move the webhook uses. Stripe appends
 * `redirect_status` / `payment_intent_client_secret` query params; they are
 * deliberately ignored — a client-visible success signal is never trusted.
 *
 * A route handler rather than a page because the authorized outcome must
 * clear the draft cookie, which only actions and route handlers may do.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const bookingId = url.searchParams.get("booking");

  const redirect = (path: string) =>
    NextResponse.redirect(new URL(path, url), { status: 303 });

  if (!bookingId) return redirect("/book/pay");

  const authUser = await getVerifiedAuthUser();
  if (!authUser) return redirect("/book/verify");

  const core = tryGetCore();
  if (!core) return redirect("/book/pay");

  let outcome;
  try {
    outcome = await reconcileBookingPayment(core, {
      bookingId,
      userId: authUser.id,
    });
  } catch (error: unknown) {
    if (error instanceof NotFoundError) {
      // Unknown or foreign booking — same 404-shaped opacity as the read paths.
      return redirect("/book/pay");
    }
    // Provider or database hiccup: the money state is UNKNOWN, so land on the
    // pending page, whose re-check affordance points back here.
    console.error("[book/return] status re-check failed", error);
    return redirect(`/book/processing?booking=${bookingId}`);
  }

  switch (outcome.outcome) {
    case "authorized": {
      // Funds held, booking advanced — the funnel draft is finished. Clear
      // both the server-side mirror and the cookie on this response.
      try {
        await softDeleteBookingDraft(core.db, authUser.id);
      } catch (cleanupError) {
        console.error("[book/return] draft row cleanup failed", cleanupError);
      }
      const response = redirect(`/book/confirmed?booking=${bookingId}`);
      response.cookies.delete({ name: DRAFT_COOKIE_NAME, path: "/" });
      return response;
    }
    case "processing":
      return redirect(`/book/processing?booking=${bookingId}`);
    case "not_completed":
      // Confirmation never finished (abandoned / bounced back) — the same
      // intent is still confirmable, so the pay step reuses it.
      return redirect("/book/pay?payment=incomplete");
    case "failed":
    default:
      // Dead authorization — the pay step will mint a fresh intent.
      return redirect("/book/pay?payment=failed");
  }
}
