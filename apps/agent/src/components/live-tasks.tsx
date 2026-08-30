"use client";

import { useRouter } from "next/navigation";
import { toast, useAnnounceChange, useBookingSignal } from "@koolee/ui";

import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

/**
 * Live task views for the field app.
 *
 * THE BOOKING IDS ARE PASSED, and that was not the first design.
 *
 * This started as an UNFILTERED subscription — watch the whole table and let
 * 0030's RLS policy decide what reaches you — on the reasoning that
 * enumerating ids client-side goes stale the moment ops assigns one more.
 * Measured in a browser, that subscription does not work: an unfiltered
 * `postgres_changes` on an RLS-protected table reports CHANNEL_ERROR, while
 * the identical filtered subscription on the customer's page connects and
 * delivers in under three seconds. Supabase evaluates the policy per
 * subscriber per row, and the unfiltered case is the one that falls over.
 *
 * So the server passes the ids it already has (`listAssignedTasks` returned
 * them to render the page), and the staleness that argued against this is
 * exactly what the polling fallback is for: a booking assigned in the last
 * thirty seconds that is not yet in the filter list arrives on the next poll,
 * and the re-render that follows puts it in the list.
 *
 * The socket still carries no data we render, so this is scoping, not a
 * security boundary; the boundary is still `getAssignedTask` refusing to
 * resolve a task that is not theirs.
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
  /** The bookings this view is showing. See the note above on why not "all". */
  bookingIds,
  enabled = true,
  /**
   * Opaque milestone key computed on the SERVER, or null on views with no
   * milestone (the list pages, which refresh quietly). `jobs:<n>` on a list
   * is handled below rather than in the map, because the message needs the
   * count.
   */
  stage = null,
}: {
  bookingIds: readonly string[];
  enabled?: boolean;
  stage?: string | null;
}) {
  const router = useRouter();
  const client = getSupabaseBrowserClient();

  const status = useBookingSignal({
    client,
    bookingIds,
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

  /*
   * RENDERS AN EMPTY SPAN, NOT `null`, AND THAT IS LOAD-BEARING.
   *
   * A client component that returns `null` is never committed in this app's
   * production build (Next 16 / Turbopack): its module loads, its function
   * body runs, and its effects NEVER FIRE. The whole realtime layer was
   * therefore inert in every built app and silently degraded to the polling
   * fallback — which is precisely the failure the fallback is designed to
   * hide, so nothing looked broken. Measured both ways: with `null`, no
   * WebSocket is ever constructed; with this span, the channel reports
   * SUBSCRIBED in under a second.
   *
   * `data-live-signal` carries the transport the hook actually settled on, so
   * "is this page live or is it polling?" is answerable by looking at the DOM
   * rather than by reading console output that only exists in a debug build.
   * That is how this bug was finally pinned down, and how a regression will be.
   *
   * Found by driving two real browsers, not by any test in this repo — a
   * typecheck, a lint and 250 integration tests all passed over the broken
   * version. See RUN-REPORT-9 §V.
   */
  return <span hidden aria-hidden="true" data-live-signal={status} />;
}
