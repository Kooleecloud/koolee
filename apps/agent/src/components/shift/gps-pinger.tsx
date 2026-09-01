"use client";

import * as React from "react";

/**
 * The driver's position, while there are bags to collect.
 *
 * Sends `navigator.geolocation` to `/api/driver-position` from the moment a
 * pickup is under way until the bags are delivered. That is what fills the
 * "3.2 km away · 15–25 min" line and the moving pin on the customer's trip
 * page.
 *
 * IT RUNS FOR THE WHOLE SHIFT, not only while a pickup is under way. That is
 * a change TD asked for and it is the difference between a driver-selection
 * map that works and one that is empty almost always: a customer choosing a
 * driver is shown pins built from `driver_positions`, and a fix older than
 * `POSITION_FRESH_MS` (90s) is dropped rather than drawn. A driver clocked on
 * and waiting for work used to report nothing at all, so there was nothing
 * fresh to draw and the map simply did not render.
 *
 * THREE CADENCES, BECAUSE THEY ARE NOT ALL BEING WATCHED THE SAME WAY.
 *
 * A single flat interval has to be a compromise between a customer staring at
 * a dot creeping toward their front door and a van on a motorway to the bag
 * drop that nobody has open. Those are not the same problem, and the driver's
 * battery pays for treating them as one.
 *
 *  - **En route to the door** (`en_route`): the pickup has started and the
 *    bags are still on the doorstep. Somebody is very plausibly watching.
 *    Twenty seconds — fast enough that the pin reads as alive between the
 *    1.2-second walks that smooth it.
 *  - **Carrying** (`carrying`): the seals are scanned, the bags are in the van
 *    and the booking is `in_transit`. The customer's question has changed from
 *    "where are they" to "did they make it", which the custody trail answers.
 *    Forty-five seconds.
 *  - **On shift** (`on_shift`): clocked on, nothing running. Somebody may be
 *    looking at this driver as a pin on a shortlist right now. Forty-five
 *    seconds, and the number is not free to raise: two pings have to fit
 *    inside the 90-second freshness window or one missed fix makes the pin
 *    vanish. Sixty would mean a single dropped request removes a driver from
 *    every customer's map.
 *
 * Below about fifteen seconds this stops buying anything visible: the phone's
 * own fix is not that fresh, the pin animation already covers the gap, and the
 * cost is battery on a device somebody needs all day and write volume against
 * one mutable row.
 *
 * WHAT THIS IS NOT. It is a foreground-only ping: no service worker, no
 * background sync, no `watchPosition`. A phone in a pocket with the screen off
 * stops reporting, and that is accepted for this slice — the customer's page
 * degrades to "Locating…", which is honest, rather than to a stale
 * position presented as current. Background tracking is a battery, permission
 * and privacy conversation of its own.
 *
 * PERMISSION DENIED IS NOT AN ERROR. The banner says the customer will not see
 * the driver coming, the pings simply stop, and every other part of the pickup
 * works exactly as before. Nothing here can block a driver at a door.
 */

/**
 * How often to ping, by what the driver is doing.
 *
 * `POSITION_FRESH_MS` in core is sized at roughly four missed pings of the
 * ACTIVE (en-route) cadence — 90 seconds against these 20. Changing this
 * number without revisiting that one is how a pin starts being dropped as
 * stale while the driver is still reporting normally.
 */
const PING_INTERVAL_MS: Record<GpsPingerPhase, number> = {
  en_route: 20_000,
  carrying: 45_000,
  on_shift: 45_000,
};

/**
 * A fix older than this is not worth sending.
 *
 * Deliberately NOT tied to the interval. It is the browser's cache window
 * (`maximumAge`), and a 60-second-old fix is a reasonable answer to "where are
 * you" in city traffic while saving a GPS wake — the alternative is forcing a
 * fresh hardware fix every single ping, which is most of the battery cost.
 */
const MAX_FIX_AGE_MS = 60_000;

export type GpsPingerState = "idle" | "sending" | "denied" | "unsupported";

/**
 * What the driver is doing, which is what decides the cadence — and whether
 * anything is sent at all. `null` means no open shift: off the clock, Koolee
 * knows nothing about where anybody is.
 */
export type GpsPingerPhase = "en_route" | "carrying" | "on_shift";

export function GpsPinger({
  /**
   * Null when the driver has no open shift, and then nothing is sent at all.
   *
   * Otherwise which leg: see the three cadences in the header.
   */
  phase,
}: {
  phase: GpsPingerPhase | null;
}) {
  const [state, setState] = React.useState<GpsPingerState>("idle");
  const active = phase !== null;

  React.useEffect(() => {
    if (phase === null) return;

    let cancelled = false;

    if (typeof navigator === "undefined" || !navigator.geolocation) {
      // Deferred rather than set synchronously: a setState in the body of an
      // effect cascades a second render before paint, and the lint rule that
      // catches it is right — nothing here is urgent enough to justify one.
      const timer = setTimeout(() => {
        if (!cancelled) setState("unsupported");
      }, 0);
      return () => {
        cancelled = true;
        clearTimeout(timer);
      };
    }

    const send = () => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          if (cancelled) return;
          setState("sending");
          void fetch("/api/driver-position", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              lat: position.coords.latitude,
              lng: position.coords.longitude,
              recordedAt: new Date(position.timestamp).toISOString(),
            }),
            // The next ping is seconds away; a failed one is not worth
            // retrying or reporting. Position is the most disposable data in
            // the system — it is explicitly NOT chain of custody.
          }).catch(() => undefined);
        },
        (error) => {
          if (cancelled) return;
          setState(error.code === error.PERMISSION_DENIED ? "denied" : "unsupported");
        },
        { enableHighAccuracy: false, timeout: 10_000, maximumAge: MAX_FIX_AGE_MS },
      );
    };

    /*
     * Sent immediately, then on the interval for this leg. Crossing from
     * `en_route` to `carrying` re-runs the effect, which clears the old
     * interval and sends one fix straight away — so the moment the seals are
     * scanned the customer's page gets a position rather than waiting out
     * whatever was left of the previous tick.
     */
    send();
    const id = setInterval(send, PING_INTERVAL_MS[phase]);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [phase]);

  if (!active || state === "idle" || state === "sending") return null;

  return (
    <p
      role="status"
      className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-navy-700"
    >
      {state === "denied"
        ? "Location is off for this site, so your customer can't see you coming. Everything else works — turn it on in your browser settings if you want them to."
        : "This device can't share a location, so your customer won't see you coming. Everything else works as normal."}
    </p>
  );
}
