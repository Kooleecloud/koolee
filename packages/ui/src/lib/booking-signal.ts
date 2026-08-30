"use client";

import * as React from "react";

/**
 * `useBookingSignal` — live updates that DEGRADE, never gate.
 *
 * THE ARCHITECTURE RULE, in one sentence: realtime is a signal, never a source
 * of truth. Supabase tells this hook that a booking changed; the hook calls
 * `onSignal`, and the caller refetches through the ordinary server path
 * (`router.refresh()` on a `force-dynamic` page, a server action, a route
 * handler). Nothing in a realtime payload is ever rendered, which is what
 * keeps Drizzle the only read path and makes an RLS mistake cost a wasted
 * refetch rather than a disclosure.
 *
 * THREE THINGS THIS OWNS, and they are the reason it is shared rather than
 * written twice:
 *
 *  1. DEBOUNCE. A single visit fires several custody events in a second
 *     (arrive, seal, seal, seal, complete). Un-coalesced that is five full
 *     server re-renders on a phone.
 *  2. POLLING FALLBACK. If the socket never connects — corporate proxy, a
 *     browser with WebSockets blocked, Supabase not configured at all — the
 *     interval that was there before this hook existed keeps running. Live
 *     updates are an upgrade over polling, not a replacement for it, because a
 *     customer whose socket failed must not be the last to know their driver
 *     arrived.
 *  3. RECONNECT. A phone that sleeps drops the socket. On reconnect we signal
 *     ONCE unconditionally, because whatever happened while the tab was asleep
 *     produced no event we will ever receive.
 *
 * WHY IT TAKES A CLIENT INSTEAD OF IMPORTING ONE. `@koolee/ui` must not depend
 * on `@supabase/supabase-js`: each app builds its own browser client with its
 * own cookie name (all three share one Supabase project — see
 * apps/web/src/lib/supabase/cookie-name.ts). The client is typed structurally
 * against the two methods used here, so passing a real `SupabaseClient`
 * type-checks and the package takes no dependency.
 */

/** The table the doorbell lives in. Migration 0030. */
export const BOOKING_SIGNAL_TABLE = "booking_signals";

/** Coalescing window. Long enough to absorb a burst, short enough to feel live. */
export const SIGNAL_DEBOUNCE_MS = 400;

/** Fallback cadence when the socket is not delivering. */
export const SIGNAL_POLL_MS = 30_000;

interface SignalChannel {
  on(
    type: "postgres_changes",
    filter: { event: "*"; schema: string; table: string; filter?: string },
    callback: (payload: unknown) => void,
  ): SignalChannel;
  subscribe(callback?: (status: string, error?: unknown) => void): unknown;
}

/** The two methods this hook uses. A real `SupabaseClient` satisfies it. */
export interface BookingSignalClient {
  channel(name: string): SignalChannel;
  removeChannel(channel: unknown): unknown;
}

export interface UseBookingSignalOptions {
  /**
   * The browser Supabase client, or null when Supabase is not configured.
   * Null is a supported state, not an error: the poll below covers it.
   */
  client: BookingSignalClient | null;
  /**
   * Bookings to watch. One `postgres_changes` filter per id.
   *
   * REQUIRED, AND EMPTY MEANS POLL-ONLY — not "watch everything". An
   * unfiltered subscription on an RLS-protected table was the first design
   * here and it does not work: measured in a browser, it reports
   * CHANNEL_ERROR while the identical filtered subscription connects and
   * delivers in under three seconds. Supabase evaluates the policy per
   * subscriber per row, and the unfiltered case is the one that falls over.
   * A surface that does not know which bookings it is showing therefore gets
   * the polling fallback, honestly, rather than a socket that silently never
   * fires.
   *
   * Pass a stable array; the hook keys its subscription on the sorted join,
   * so a new array literal with the same ids does not resubscribe.
   */
  bookingIds: readonly string[];
  /** Refetch. Called debounced, and once on every (re)connect. */
  onSignal: () => void;
  /** Poll cadence. Set 0 to disable — only for a page that is already static. */
  pollMs?: number;
  /** False parks everything (a terminal booking has nothing left to watch). */
  enabled?: boolean;
}

export type BookingSignalStatus = "connecting" | "live" | "polling";

/**
 * Subscribes to booking signals and calls `onSignal` when something moves.
 *
 * Returns the transport actually in use, so a surface can say "updating live"
 * versus "checking every 30 seconds" honestly rather than claiming live and
 * quietly polling.
 */
export function useBookingSignal({
  client,
  bookingIds,
  onSignal,
  pollMs = SIGNAL_POLL_MS,
  enabled = true,
}: UseBookingSignalOptions): BookingSignalStatus {
  // The callback identity changes every render in most callers (an inline
  // arrow closing over `router`). Held in a ref so it never re-subscribes.
  const onSignalRef = React.useRef(onSignal);
  React.useEffect(() => {
    onSignalRef.current = onSignal;
  }, [onSignal]);

  // Sorted + joined, so `["a","b"]` and a fresh `["b","a"]` are one key.
  const key = React.useMemo(
    () => [...(bookingIds ?? [])].filter(Boolean).sort().join(","),
    [bookingIds],
  );

  /*
   * SOCKET STATE IS STAMPED WITH THE SUBSCRIPTION IT DESCRIBES, and is only
   * ever written from supabase-js's own callback — never synchronously in an
   * effect body, which is a cascading render (and a lint error).
   *
   * Stamping is what replaces "reset the state when the key changes": a
   * report belonging to a previous subscription simply does not match the
   * current key, so the derived status below reads `connecting` again with no
   * second render.
   */
  const [socket, setSocket] = React.useState<{ key: string; live: boolean } | null>(null);

  const watching = enabled && client !== null && key !== "";
  const status: BookingSignalStatus = !watching
    ? "polling"
    : socket?.key !== key
      ? "connecting"
      : socket.live
        ? "live"
        : "polling";

  /* --- the socket ------------------------------------------------- */

  React.useEffect(() => {
    // No ids is not "watch everything" — see the prop's note. It is poll-only.
    if (!enabled || !client || key === "") return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const fire = () => {
      if (cancelled) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        onSignalRef.current();
      }, SIGNAL_DEBOUNCE_MS);
    };

    const ids = key.split(",");
    // A channel name unique to what is watched: two components watching
    // different bookings must not share (and therefore close) one channel.
    const channel = client.channel(`booking-signal:${key}`);

    // One handler per id. `postgres_changes` takes a single filter
    // expression, so a set of bookings is a set of handlers on one channel.
    for (const id of ids) {
      channel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: BOOKING_SIGNAL_TABLE,
          filter: `booking_id=eq.${id}`,
        },
        fire,
      );
    }

    channel.subscribe((state: string) => {
      if (cancelled) return;
      if (state === "SUBSCRIBED") {
        setSocket({ key, live: true });
        // Whatever happened while we were not listening produced no event we
        // will ever receive. One refetch on connect closes that hole.
        onSignalRef.current();
        return;
      }
      // CHANNEL_ERROR / TIMED_OUT / CLOSED. supabase-js retries on its own;
      // saying "polling" keeps the fallback honest until it comes back.
      setSocket({ key, live: false });
    });

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      client.removeChannel(channel);
    };
  }, [client, key, enabled]);

  /* --- the fallback ----------------------------------------------- */

  React.useEffect(() => {
    // Runs even while the socket is live, at a much slower cadence than the
    // 30-second poll it replaces would need to be. Cheap insurance against a
    // subscription that reports SUBSCRIBED and silently delivers nothing —
    // which is the failure this hook cannot detect from the inside.
    if (!enabled || pollMs <= 0) return;
    const every = status === "live" ? pollMs * 4 : pollMs;
    const id = setInterval(() => onSignalRef.current(), every);
    return () => clearInterval(id);
  }, [enabled, pollMs, status]);

  return status;
}
