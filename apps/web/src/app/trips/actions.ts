"use server";

import { redirect } from "next/navigation";
import { discardBookingDraft } from "@koolee/core";

import { getAuthUser } from "@/lib/auth";
import { clearDraft, readDraft } from "@/lib/booking-draft";
import { tryGetCore } from "@/lib/core";

/**
 * Discards the in-progress booking draft from My Trips. Same unwind as the
 * funnel's "Start over" (soft-delete the row, void any draft booking's
 * payment authorization, release the slot) but lands back on /trips.
 */
export async function discardDraft(): Promise<void> {
  const authUser = await getAuthUser();
  if (!authUser || authUser.isAnonymous) redirect("/login?returnTo=%2Ftrips");

  const core = tryGetCore();
  if (core) {
    try {
      const draft = await readDraft();
      await discardBookingDraft(core, {
        userId: authUser.id,
        bookingId: draft.bookingId ?? null,
        reason: "booking_draft_discarded",
      });
    } catch (error) {
      console.error("[trips] draft discard failed", error);
    }
  }

  await clearDraft();
  redirect("/trips");
}
