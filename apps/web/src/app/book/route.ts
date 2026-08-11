import { NextResponse } from "next/server";
import { getBookingDraft } from "@koolee/core";

import { getAuthUser } from "@/lib/auth";
import {
  DRAFT_COOKIE_NAME,
  draftCookieOptions,
  readDraft,
} from "@/lib/booking-draft";
import { bookingDraftSchema } from "@/lib/booking-draft-schema";
import { draftHasProgress, nextIncompleteStep } from "@/lib/booking-steps";
import { tryGetCore } from "@/lib/core";

/**
 * The funnel's front door: /book resumes wherever the draft left off.
 *
 * Priority: the cookie draft (the in-flight truth) wins; when it is empty —
 * expired, cleared, or a different device — an account holder's server-side
 * `booking_drafts` mirror rehydrates it, so a signed-in customer can resume a
 * week-old draft anywhere. A route handler rather than a page because the
 * rehydration must SET the draft cookie, which only actions and route
 * handlers may do.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const redirect = (path: string) =>
    NextResponse.redirect(new URL(path, url), { status: 303 });

  const cookieDraft = await readDraft();
  if (draftHasProgress(cookieDraft)) {
    return redirect(nextIncompleteStep(cookieDraft));
  }

  const authUser = await getAuthUser();
  const core = tryGetCore();
  if (authUser && core) {
    try {
      const row = await getBookingDraft(core.db, authUser.id);
      const parsed = row ? bookingDraftSchema.safeParse(row.payload) : null;
      if (parsed?.success && draftHasProgress(parsed.data)) {
        const response = redirect(nextIncompleteStep(parsed.data));
        response.cookies.set(
          DRAFT_COOKIE_NAME,
          JSON.stringify(parsed.data),
          draftCookieOptions(),
        );
        return response;
      }
    } catch (error) {
      console.error("[book] draft rehydration failed", error);
    }
  }

  return redirect("/book/flight");
}
