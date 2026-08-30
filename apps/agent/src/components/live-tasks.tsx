"use client";

import { useRouter } from "next/navigation";
import { useBookingSignal } from "@koolee/ui";

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
 * wait. Now the gate opens in front of them.
 */
export function LiveTasks({ enabled = true }: { enabled?: boolean }) {
  const router = useRouter();
  const client = getSupabaseBrowserClient();

  useBookingSignal({
    client,
    onSignal: () => router.refresh(),
    enabled,
  });

  return null;
}
