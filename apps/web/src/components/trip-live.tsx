"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useBookingSignal } from "@koolee/ui";

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
export function TripLive({
  bookingId,
  /** False once the booking is terminal — nothing left to watch. */
  active,
}: {
  bookingId: string;
  active: boolean;
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

  return null;
}
