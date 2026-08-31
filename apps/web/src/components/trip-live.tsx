"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  SIGNAL_POLL_FAST_MS,
  toast,
  useAnnounceChange,
  useBookingSignal,
} from "@koolee/ui";

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
  /**
   * The booking to watch. OMITTED on the trips list, which has no single
   * booking and therefore runs on the polling fallback — see the hook's note
   * on why "watch everything" is not an option.
   */
  bookingId,
  /** False once the booking is terminal — nothing left to watch. */
  active = true,
  /**
   * Opaque milestone key, computed on the server. Null announces nothing.
   * A stage NOT in `ANNOUNCEMENTS` still refreshes the page — it simply does
   * so quietly, which is the default and the right one.
   */
  stage = null,
}: {
  bookingId?: string;
  active?: boolean;
  stage?: string | null;
}) {
  /*
   * THE ONE SCREEN THE POLL ACTUALLY DRIVES, so it gets the faster one.
   *
   * Everywhere else the socket is the path: a custody event fires the trigger
   * and the page refetches in about three seconds, with the 30-second poll as
   * the net. On the driver shortlist there is no socket traffic at all — a
   * candidate's position ping signals only bookings already bound to that
   * driver's shift, and a booking still choosing has none. See
   * `SIGNAL_POLL_FAST_MS` for why widening that is the expensive answer.
   *
   * Derived from the STAGE the server computed, so it turns itself off the
   * moment a driver is chosen and the socket takes over.
   */
  const choosing = stage === "choose_driver";
  const router = useRouter();
  const client = getSupabaseBrowserClient();
  const bookingIds = React.useMemo(() => (bookingId ? [bookingId] : []), [bookingId]);

  const status = useBookingSignal({
    client,
    bookingIds,
    onSignal: () => router.refresh(),
    enabled: active,
    pollMs: choosing ? SIGNAL_POLL_FAST_MS : undefined,
  });

  useAnnounceChange(stage, (next) => {
    const message = ANNOUNCEMENTS[next];
    if (!message) return;
    // Errors get the error style; everything else is progress.
    if (next === "exception") toast.error(message);
    else toast.success(message);
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
