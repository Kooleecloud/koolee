import "server-only";

import {
  BOOKING_DRAFT_TTL_ANONYMOUS_MS,
  BOOKING_DRAFT_TTL_VERIFIED_MS,
  upsertBookingDraft,
} from "@koolee/core";

import { getAuthUser } from "@/lib/auth";
import { readDraft } from "@/lib/booking-draft";
import { tryGetCore } from "@/lib/core";

/**
 * Mirrors the funnel cookie draft into the server-side `booking_drafts` row
 * for the current auth user (anonymous or signed-in).
 *
 * Best-effort by design: the cookie remains the in-flight source of truth, so
 * a failed mirror write must never block a funnel step. Called after every
 * step once a session exists.
 *
 * Every write refreshes the row's inactivity expiry: 7 days for a verified
 * account (the draft shows on My Trips and survives across devices), 24 hours
 * for an anonymous session (a cache, like the cookie).
 */
export async function syncDraftRow(userId?: string): Promise<void> {
  const core = tryGetCore();
  if (!core) return;

  try {
    const authUser = await getAuthUser();
    const uid = userId ?? authUser?.id;
    if (!uid) return;

    // The quarantined extraction prefill never leaves the cookie: only
    // review-form-confirmed values are mirrored server-side (the hard rule
    // in booking-draft-schema.ts).
    const { ticketPrefill: _ticketPrefill, ...draft } = await readDraft();
    if (Object.keys(draft).length === 0) return;

    const verified = Boolean(authUser && !authUser.isAnonymous);
    await upsertBookingDraft(core.db, {
      userId: uid,
      payload: draft as Record<string, unknown>,
      ttlMs: verified ? BOOKING_DRAFT_TTL_VERIFIED_MS : BOOKING_DRAFT_TTL_ANONYMOUS_MS,
    });
  } catch (error) {
    console.error("[draft-sync] mirror write failed", error);
  }
}
