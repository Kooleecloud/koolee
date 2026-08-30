"use client";

import { useRouter } from "next/navigation";
import { toast, useAnnounceChange, useBookingSignal } from "@koolee/ui";

import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

/**
 * Live task views for the field app.
 *
 * NO BOOKING IDS ARE PASSED. The agent watches every booking they are assigned
 * to, and 0030's RLS policy is what decides which those are — enumerating them
 * client-side would be a long filter list that goes stale the moment ops
 * assigns one more. The socket carries no data we render, so the policy is a
 * scoping convenience rather than a security boundary; the boundary is still
 * `getAssignedTask` refusing to resolve a task that is not theirs.
 *
 * WHAT THIS FIXES AT THE DOOR. The identity gate unlocks when the customer
 * accepts the agreement — which they often do while the agent is standing
 * there. Before this the agent had to pull-to-refresh and guess how long to
 * wait. Now the gate opens in front of them, and says so.
 */

/**
 * A phone in a pocket is not being watched, so the agent app announces MORE
 * than the customer page does: every one of these is something that changes
 * what the person holding the phone should do next.
 */
const ANNOUNCEMENTS: Record<string, string> = {
  "gate:open": "Identity confirmed — you can seal the bags now.",
  "pickup:mine": "This pickup is yours — the customer picked you.",
};

export function LiveTasks({
  enabled = true,
  /**
   * Opaque milestone key computed on the SERVER, or null on views with no
   * milestone (the list pages, which refresh quietly). `jobs:<n>` on a list
   * is handled below rather than in the map, because the message needs the
   * count.
   */
  stage = null,
}: {
  enabled?: boolean;
  stage?: string | null;
}) {
  const router = useRouter();
  const client = getSupabaseBrowserClient();

  useBookingSignal({
    client,
    onSignal: () => router.refresh(),
    enabled,
  });

  useAnnounceChange(stage, (next, previous) => {
    // A new job landing in the queue mid-shift is the one announcement whose
    // wording depends on the numbers, so it is computed rather than looked up.
    if (next.startsWith("jobs:") && previous.startsWith("jobs:")) {
      const added = Number(next.slice(5)) - Number(previous.slice(5));
      if (added > 0) {
        toast.success(added === 1 ? "New job assigned to you." : `${added} new jobs assigned to you.`);
      }
      return;
    }
    const message = ANNOUNCEMENTS[next];
    if (message) toast.success(message);
  });

  return null;
}
