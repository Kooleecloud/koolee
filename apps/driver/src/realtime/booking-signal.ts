import * as React from "react";
import { AppState } from "react-native";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * `useBookingSignal` — the native twin of `@koolee/ui`'s hook
 * (packages/ui/src/lib/booking-signal.ts), with the same constants and the
 * same rules. A twin rather than an import because `@koolee/ui` is a web
 * package and would bring its own copy of React into the bundle.
 *
 * REALTIME IS A SIGNAL, NEVER A SOURCE OF TRUTH. Supabase says a booking
 * changed; the caller refetches through `/api/v1`. Nothing in a payload is
 * rendered, so an RLS mistake costs a wasted refetch, not a disclosure.
 *
 * FILTERED, ALWAYS. One `booking_id=eq.<id>` handler per booking. An
 * unfiltered subscription on the RLS-protected table reports CHANNEL_ERROR
 * (measured on the web), so no ids means no socket — the caller's poll
 * covers it.
 *
 * TWO ADDITIONS FOR A PHONE:
 *
 *  - Coming back to the foreground signals once. iOS suspends the socket with
 *    the app, and whatever happened meanwhile produced no event this will
 *    ever receive — the same reason a (re)connect signals.
 *  - `ignoreTouchedBy`: a change this person made is skipped. The driver's
 *    own GPS ping touches the signal of every booking they are carrying
 *    (`recordDriverPosition`), which at a 5 s cadence would refetch the list
 *    and the open task every five seconds for nothing; the driver's own
 *    steps already refetch when the server says yes. `touched_by` is read
 *    only to decide NOT to refetch — the worst a wrong value can do is delay
 *    a refresh to the next poll.
 */

/** The table the doorbell lives in. Migration 0030. */
export const BOOKING_SIGNAL_TABLE = "booking_signals";

/** Coalescing window: a visit fires several custody events in a second. */
export const SIGNAL_DEBOUNCE_MS = 400;

/** Fallback cadence when the socket is not delivering. */
export const SIGNAL_POLL_MS = 30_000;

export type BookingSignalStatus = "connecting" | "live" | "polling";

/** Sorted and joined, so `["a","b"]` and a fresh `["b","a"]` are one key. */
export function signalKey(bookingIds: readonly string[]): string {
  return [...new Set(bookingIds.filter(Boolean))].sort().join(",");
}

export interface UseBookingSignalOptions {
  client: SupabaseClient | null;
  /** Bookings to watch. Empty means no socket — see the header. */
  bookingIds: readonly string[];
  /** Refetch. Debounced, and called once on every (re)connect and foreground. */
  onSignal: () => void;
  /** Poll cadence; 0 when the screen already polls on its own. */
  pollMs?: number;
  /** False parks everything (a stopped job has nothing left to watch). */
  enabled?: boolean;
  /** Skip changes whose `touched_by` is this user — see the header. */
  ignoreTouchedBy?: string | null;
}

/** The `touched_by` of a `booking_signals` change, when the payload has one. */
export function touchedByOf(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const row = (payload as { new?: unknown }).new;
  if (typeof row !== "object" || row === null) return null;
  const value = (row as { touched_by?: unknown }).touched_by;
  return typeof value === "string" ? value : null;
}

export function useBookingSignal({
  client,
  bookingIds,
  onSignal,
  pollMs = SIGNAL_POLL_MS,
  enabled = true,
  ignoreTouchedBy = null,
}: UseBookingSignalOptions): BookingSignalStatus {
  const onSignalRef = React.useRef(onSignal);
  React.useEffect(() => {
    onSignalRef.current = onSignal;
  }, [onSignal]);
  const ignoreRef = React.useRef(ignoreTouchedBy);
  React.useEffect(() => {
    ignoreRef.current = ignoreTouchedBy;
  }, [ignoreTouchedBy]);

  const key = React.useMemo(() => signalKey(bookingIds), [bookingIds]);

  // Stamped with the subscription it describes and only ever written from
  // supabase-js's callback, so a report from a previous key reads as
  // "connecting" again without a second render.
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
    if (!enabled || !client || key === "") return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    // A channel name unique to what is watched: two screens watching
    // different bookings must not share (and so close) one channel.
    const name = `booking-signal:${key}`;
    let saidSkip = false;
    const fire = (payload: unknown) => {
      if (cancelled) return;
      const by = touchedByOf(payload);
      if (by !== null && by === ignoreRef.current) {
        if (__DEV__ && !saidSkip) {
          saidSkip = true;
          console.info(`[realtime] ${name}: skipping this driver's own changes`);
        }
        return;
      }
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        onSignalRef.current();
      }, SIGNAL_DEBOUNCE_MS);
    };

    const channel = client.channel(name);
    for (const id of key.split(",")) {
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

    channel.subscribe((state) => {
      if (cancelled) return;
      if (__DEV__) console.info(`[realtime] ${name}: ${state}`);
      if (state === "SUBSCRIBED") {
        setSocket({ key, live: true });
        onSignalRef.current();
        return;
      }
      // CHANNEL_ERROR / TIMED_OUT / CLOSED: supabase-js retries on its own.
      setSocket({ key, live: false });
    });

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      void client.removeChannel(channel);
    };
  }, [client, key, enabled]);

  /* --- the foreground ---------------------------------------------- */

  React.useEffect(() => {
    if (!enabled) return;
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") onSignalRef.current();
    });
    return () => subscription.remove();
  }, [enabled]);

  /* --- the fallback ----------------------------------------------- */

  React.useEffect(() => {
    // Still runs while live, four times slower: insurance against a channel
    // that reports SUBSCRIBED and silently delivers nothing.
    if (!enabled || pollMs <= 0) return;
    const every = status === "live" ? pollMs * 4 : pollMs;
    const id = setInterval(() => onSignalRef.current(), every);
    return () => clearInterval(id);
  }, [enabled, pollMs, status]);

  return status;
}

/**
 * Calls `announce(next, previous)` when `stage` changes — never on the first
 * value, so opening a screen announces nothing. The twin of `@koolee/ui`'s
 * `useAnnounceChange`. Null parks it (a stopped job announces nothing).
 */
export function useAnnounceChange(
  stage: string | null,
  announce: (next: string, previous: string) => void,
): void {
  const previous = React.useRef(stage);
  const announceRef = React.useRef(announce);
  // Before the effect below, so a render that changes both uses the new one.
  React.useEffect(() => {
    announceRef.current = announce;
  }, [announce]);

  React.useEffect(() => {
    if (stage === null || previous.current === null) {
      previous.current = stage;
      return;
    }
    if (previous.current === stage) return;
    const before = previous.current;
    previous.current = stage;
    announceRef.current(stage, before);
  }, [stage]);
}
