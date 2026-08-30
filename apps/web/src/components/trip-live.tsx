"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast, useAnnounceChange, useBookingSignal } from "@koolee/ui";

import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

/**
 * Keeps the trip page current without the customer touching anything.
 *
 * The page is `force-dynamic`, so `router.refresh()` re-runs the whole server
 * component and everything on it comes back fresh — the status timeline, the
 * agreement and passport cards, the driver shortlist, the ETA. That is the
 * entire mechanism: the socket says "something moved", this refetches through
 * the same path a reload would.
 *
 * NOTHING FROM THE PAYLOAD IS READ. `useBookingSignal` hands us no data and
 * this component renders none — see the hook's header for why that matters.
 *
 * WHY IT IS A BARE COMPONENT WITH NO OUTPUT. It used to be an interval inside
 * `DriverTracking`, which meant the page only went live once a driver had been
 * chosen: an agent sealing bags on the doorstep changed nothing on the screen
 * the customer was watching. Live-ness belongs to the page, not to one card.
 */

/**
 * The stages worth interrupting somebody for, and their words.
 *
 * Deliberately SHORT. A page that refreshes silently is fine for most changes
 * — the customer will see the new state when they look. A toast is for the two
 * cases where the page has grown something that needs them, or where staying
 * quiet would be alarming.
 */
const ANNOUNCEMENTS: Record<string, string> = {
  choose_driver: "Your bags are sealed — choose your driver.",
  in_transit: "Your driver has your bags and is on the way to the bag drop.",
  delivered: "Your bags reached your airline's bag drop.",
  exception: "We've hit a snag — our team is on it and will be in touch.",
};

export function TripLive({
  bookingId,
  /** False once the booking is terminal — nothing left to watch. */
  active,
  /**
   * Opaque milestone key, computed on the server. Null announces nothing.
   * A stage NOT in `ANNOUNCEMENTS` still refreshes the page — it simply does
   * so quietly, which is the default and the right one.
   */
  stage,
}: {
  bookingId: string;
  active: boolean;
  stage: string | null;
}) {
  const router = useRouter();
  const client = getSupabaseBrowserClient();
  const bookingIds = React.useMemo(() => [bookingId], [bookingId]);

  useBookingSignal({
    client,
    bookingIds,
    onSignal: () => router.refresh(),
    enabled: active,
  });

  useAnnounceChange(stage, (next) => {
    const message = ANNOUNCEMENTS[next];
    if (!message) return;
    // Errors get the error style; everything else is progress.
    if (next === "exception") toast.error(message);
    else toast.success(message);
  });

  return null;
}
