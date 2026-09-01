import { NextResponse } from "next/server";
import { getBookingDraft } from "@koolee/core";

import { getAuthUser } from "@/lib/auth";
import {
  DRAFT_COOKIE_NAME,
  readDraft,
  STASH_COOKIE_NAME,
  stashCookieOptions,
} from "@/lib/booking-draft";
import { bookingDraftSchema } from "@/lib/booking-draft-schema";
import { BOOKING_STEPS, draftHasProgress } from "@/lib/booking-steps";
import { tryGetCore } from "@/lib/core";

/**
 * The funnel's front door: /book starts a NEW booking, and offers the old one.
 *
 * IT USED TO RESUME, UNCONDITIONALLY. Pressing "Book a pickup" dropped you
 * back into a half-finished booking from three days ago, at whatever step it
 * had reached, with its flight and address already filled in. For somebody
 * genuinely coming back that is exactly right. For somebody booking a second
 * trip it is baffling: they asked for a new booking and got an old one, and
 * the only way out was to notice and edit every field.
 *
 * The rule now (D2): a FRESH ENTRY through this door starts clean. Movement
 * INSIDE the funnel — back and forward between steps, a rejected ZIP, a
 * reload — never comes through here and is untouched, which is what keeps
 * F4's "a refused ZIP must not cost the customer their whole form" true.
 *
 * Nothing is thrown away to achieve it. An existing draft is SET ASIDE
 * (`stashDraft`), so the funnel genuinely starts at the first step with an
 * empty form and the first step can offer to put it back in one tap. Clearing
 * the draft outright would have made the offer impossible; keeping it live
 * would have meant the entry was not clean after all.
 *
 * The account-holder rehydration still happens — an empty cookie and a
 * `booking_drafts` mirror row means a draft from another device, and that is
 * worth OFFERING too. It just no longer redirects into it unasked.
 *
 * A route handler rather than a page because all of this must SET cookies,
 * which only actions and route handlers may do.
 */

/** Where a clean entry lands. The funnel's own first step, not a guess. */
const FIRST_STEP = BOOKING_STEPS[0]!.href;

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const redirect = (path: string) =>
    NextResponse.redirect(new URL(path, url), { status: 303 });

  /*
   * The draft worth offering, if there is one: the cookie first (the in-flight
   * truth), then an account holder's server-side mirror, which is how a draft
   * started on a phone is offered on a laptop.
   *
   * Only a draft with PROGRESS counts. A cookie holding nothing but a
   * `draftId` — minted by a ticket upload that went nowhere — is not something
   * anybody remembers starting, and offering to resume it would be offering to
   * resume a blank form.
   */
  const cookieDraft = await readDraft();
  let previous = draftHasProgress(cookieDraft) ? cookieDraft : null;

  if (!previous) {
    const authUser = await getAuthUser();
    const core = tryGetCore();
    if (authUser && core) {
      try {
        const row = await getBookingDraft(core.db, authUser.id);
        const parsed = row ? bookingDraftSchema.safeParse(row.payload) : null;
        if (parsed?.success && draftHasProgress(parsed.data)) previous = parsed.data;
      } catch (error) {
        // A rehydration that fails costs the customer an offer, never the
        // booking they came here to make.
        console.error("[book] draft rehydration failed", error);
      }
    }
  }

  const response = redirect(FIRST_STEP);

  if (previous) {
    // Set aside, not thrown away — the first step offers it back.
    response.cookies.set(
      STASH_COOKIE_NAME,
      JSON.stringify(previous),
      stashCookieOptions(),
    );
  } else {
    // Nothing to offer, and nothing to keep: a stash left over from an earlier
    // visit must not outlive the draft it was set aside from.
    response.cookies.delete(STASH_COOKIE_NAME);
  }

  /*
   * THE LIVE DRAFT GOES, and this is what makes the entry clean.
   *
   * Deleted on the RESPONSE rather than through `clearDraft()`: this is a
   * route handler issuing a redirect, and the request-scoped cookie store it
   * would write to is not the one the browser is about to be handed. That is
   * the same reason `/book/return` deletes it this way.
   */
  response.cookies.delete(DRAFT_COOKIE_NAME);
  return response;
}
