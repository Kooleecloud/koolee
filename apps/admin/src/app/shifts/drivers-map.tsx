"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { LiveMap } from "@koolee/ui";

import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

import {
  countByHealth,
  lastSeenLabel,
  mergeFixes,
  readPositionChange,
  toMapDrivers,
  type FleetDriver,
  type FleetFix,
} from "./drivers-map-model";

/**
 * Every driver on shift, on one map, moving as their phones report.
 *
 * THE SHIFTS PAGE COULD SAY "silent 12 min" AND NOTHING ELSE. An operator
 * reading that badge knows a driver has gone quiet and has no idea where the
 * van was when it did — which is the first thing the customer on the phone is
 * going to ask. This puts the last known position of every van in front of
 * dispatch, greyed when it is old, and moves it in place as fixes arrive.
 *
 * TWO TRANSPORTS, AND THE SERVER STAYS THE SOURCE OF TRUTH. The roster — who
 * is out, in what, with how many bags — comes from `listLiveDrivers` on every
 * server render, and a `router.refresh()` every fifteen seconds keeps it
 * current whether or not the socket works (the page is `force-dynamic`). The
 * socket ADDS one thing the poll cannot: a pin that moves within a second of
 * the phone reporting, rather than up to fifteen later. It does that by
 * laying newer fixes over the server's roster, never by replacing it — see
 * `mergeFixes` for the backwards-jump that rule prevents.
 *
 * THIS IS THE ONE PLACE A REALTIME PAYLOAD IS RENDERED, and it is a deliberate
 * exception to the "signal, never source" rule in `booking-signal.ts`. The
 * payload is three numbers about a van that the same browser is already
 * allowed to read (0039's admin-only policy), it is validated field by field
 * before it is used, and the very next poll overwrites it with the server's
 * copy. Refetching the whole page per fix would be six queries every five
 * seconds per driver on shift.
 *
 * FILTERED PER DRIVER, NEVER UNFILTERED. One channel, one `postgres_changes`
 * handler per open shift on `driver_positions` (`staff_user_id=eq.<id>`), and
 * one on `driver_shifts` (`id=in.(…)`) that refreshes the roster when a
 * watched shift closes. An unfiltered subscription on an RLS table reports
 * CHANNEL_ERROR (measured — see `live-tasks.tsx` in apps/agent). With nobody
 * out there is nothing to filter on, so nothing is subscribed and the poll
 * carries the page until somebody clocks on — a NEW shift is the one event
 * these filters cannot see, which is also why the poll keeps running at full
 * cadence while the socket is live.
 */

/**
 * The fallback cadence, and the ceiling on how late a new shift appears.
 *
 * Inside the native app's 5-second report cadence by a wide margin is not the
 * point (the socket carries positions); this is how long a driver who just
 * clocked on can be missing from the map, and how long a closed shift's pin
 * can linger if the shifts subscription misses it.
 */
const POLL_MS = 15_000;

/**
 * How often health is re-judged from `recordedAt` without any new data.
 *
 * A pin drawn live at render time is a lie two minutes later if the phone
 * has gone quiet in between; nothing arrives to say so, so the clock has to.
 */
const HEALTH_TICK_MS = 10_000;

/** One channel for the whole fleet — the page mounts exactly one of these. */
const CHANNEL_NAME = "admin-drivers";

type FleetStatus = "connecting" | "live" | "polling";

export function DriversMap({
  initial,
  gapMs,
  renderedAt,
}: {
  /** The roster as the server rendered it. Replaced on every refresh. */
  initial: readonly FleetDriver[];
  /**
   * `POSITION_GAP_MS` from core, handed down by the server page because the
   * core barrel cannot be imported here. See `drivers-map-model.ts`.
   */
  gapMs: number;
  /**
   * The server's clock at render, in ms. The first client render judges
   * health against THIS rather than `Date.now()`, so the HTML the server sent
   * and the HTML the browser hydrates agree to the millisecond; the tick below
   * takes over from there.
   */
  renderedAt: number;
}) {
  const router = useRouter();
  const client = getSupabaseBrowserClient();

  const [fixes, setFixes] = React.useState<ReadonlyMap<string, FleetFix>>(
    () => new Map(),
  );
  const [nowMs, setNowMs] = React.useState(renderedAt);
  const [selected, setSelected] = React.useState<string | null>(null);

  /*
   * WHAT IS WATCHED, AS A STRING. `initial` is a fresh array on every server
   * render — every fifteen seconds — and an effect keyed on it would tear the
   * channel down and rebuild it on each poll. Keyed on the sorted ids instead,
   * the subscription survives a refresh that changes nothing and rebuilds only
   * when a shift opens or closes. `booking-signal.ts` does the same.
   */
  const watchKey = React.useMemo(
    () =>
      initial
        .map((driver) => `${driver.shiftId}:${driver.staffUserId}`)
        .sort()
        .join(","),
    [initial],
  );

  // Stamped with the key it describes, and only ever written from
  // supabase-js's own callback — never synchronously in an effect body.
  const [socket, setSocket] = React.useState<{ key: string; live: boolean } | null>(null);

  const watching = client !== null && watchKey !== "";
  const status: FleetStatus = !watching
    ? "polling"
    : socket?.key !== watchKey
      ? "connecting"
      : socket.live
        ? "live"
        : "polling";

  const drivers = React.useMemo(() => mergeFixes(initial, fixes), [initial, fixes]);

  /* --- the clock ------------------------------------------------------ */
  React.useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), HEALTH_TICK_MS);
    return () => clearInterval(id);
  }, []);

  /* --- the fallback --------------------------------------------------- */
  React.useEffect(() => {
    // Full cadence even while live: the socket cannot announce a shift it
    // was not told to watch, so a driver clocking on arrives this way only.
    const id = setInterval(() => router.refresh(), POLL_MS);
    return () => clearInterval(id);
  }, [router]);

  /* --- the socket ----------------------------------------------------- */
  React.useEffect(() => {
    // Nobody out is not "watch everything" — it is nothing to subscribe to.
    if (!client || watchKey === "") return;

    let cancelled = false;
    const watched = watchKey.split(",").map((pair) => {
      const [shiftId = "", staffUserId = ""] = pair.split(":");
      return { shiftId, staffUserId };
    });

    const channel = client.channel(CHANNEL_NAME);

    for (const { staffUserId } of watched) {
      channel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "driver_positions",
          filter: `staff_user_id=eq.${staffUserId}`,
        },
        (payload: unknown) => {
          if (cancelled) return;
          // Unreadable is a wasted event, not an error — see the reader.
          const change = readPositionChange(payload);
          if (!change) return;
          setFixes((previous) => {
            const next = new Map(previous);
            next.set(change.staffUserId, change.fix);
            return next;
          });
        },
      );
    }

    /*
     * A shift closing (force-ended here, or ended from the van) is a pin to
     * take down, and only the server knows the new roster. Refresh rather
     * than reading `ended_at` off the payload: the roster is the server's.
     */
    channel.on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "driver_shifts",
        filter: `id=in.(${watched.map((w) => w.shiftId).join(",")})`,
      },
      () => {
        if (!cancelled) router.refresh();
      },
    );

    channel.subscribe((state: string) => {
      if (cancelled) return;
      if (state === "SUBSCRIBED") {
        setSocket({ key: watchKey, live: true });
        // Whatever moved while we were not listening produced no event we
        // will ever receive. One refetch on connect closes that hole.
        router.refresh();
        return;
      }
      // CHANNEL_ERROR / TIMED_OUT / CLOSED. supabase-js retries on its own;
      // saying "polling" keeps the DOM honest until it comes back.
      setSocket({ key: watchKey, live: false });
    });

    return () => {
      cancelled = true;
      client.removeChannel(channel);
    };
  }, [client, watchKey, router]);

  const pins = React.useMemo(
    () => toMapDrivers(drivers, nowMs, gapMs, selected),
    [drivers, nowMs, gapMs, selected],
  );
  const counts = countByHealth(drivers, nowMs, gapMs);

  return (
    <div className="flex flex-col gap-3">
      {/*
        A hidden span, never `null`: a client component that returns null is
        never committed in this app's production build and its effects never
        fire (Next 16 / Turbopack — see `live-tasks.tsx`). This one always
        renders something, but the span is also the diagnostic: "is the map
        live or polling?" is answerable from the DOM.
      */}
      <span hidden aria-hidden="true" data-fleet-map={status} />

      {drivers.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nobody is out. The map appears when a shift opens.
        </p>
      ) : (
        <LiveMap
          drivers={pins}
          onDriverClick={setSelected}
          popupDriverId={selected}
          onPopupClose={() => setSelected(null)}
          renderPopup={(shiftId) => {
            const driver = drivers.find((candidate) => candidate.shiftId === shiftId);
            if (!driver) return null;
            const bags = driver.bagsOnBoard;
            return (
              <div className="flex flex-col gap-0.5 p-4 pr-9">
                <p className="text-sm font-medium">
                  {driver.fullName?.trim() || "Unnamed driver"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {driver.truckName} · {bags} bag{bags === 1 ? "" : "s"} aboard ·{" "}
                  {lastSeenLabel(driver.recordedAt, nowMs)}
                </p>
              </div>
            );
          }}
          recenterLabel="Show every driver"
          className="h-[360px]"
          label={`Map of ${drivers.length} driver${drivers.length === 1 ? "" : "s"} on shift right now`}
        />
      )}

      {/*
        The legend doubles as the count. Three states, matching the pins:
        the sky pulse is a fix inside the gap, grey is a last known position
        past it, and the hollow ring is a driver the map cannot draw at all.
      */}
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true" className="size-2.5 rounded-full bg-sky-600" />
          {counts.live} live
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true" className="size-2.5 rounded-full bg-navy-400" />
          {counts.stale} stale
        </li>
        <li className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="size-2.5 rounded-full border border-navy-400"
          />
          {counts.silent} no position
        </li>
      </ul>
    </div>
  );
}
