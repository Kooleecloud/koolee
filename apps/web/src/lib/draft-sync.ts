import "server-only";

import { upsertBookingDraft } from "@koolee/core";

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
 */
export async function syncDraftRow(userId?: string): Promise<void> {
  const core = tryGetCore();
  if (!core) return;

  try {
    const uid = userId ?? (await getAuthUser())?.id;
    if (!uid) return;

    const draft = await readDraft();
    if (Object.keys(draft).length === 0) return;

    await upsertBookingDraft(core.db, {
      userId: uid,
      payload: draft as Record<string, unknown>,
    });
  } catch (error) {
    console.error("[draft-sync] mirror write failed", error);
  }
}
