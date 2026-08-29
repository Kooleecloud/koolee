"use client";

import * as React from "react";

/**
 * The driver's position, while there are bags to collect.
 *
 * Sends `navigator.geolocation` to `/api/driver-position` every 45 seconds
 * from the moment a pickup is under way until the bags are delivered. That is
 * what fills the "3.2 km away · 15–25 min" line on the customer's trip page.
 *
 * WHAT THIS IS NOT. It is a foreground-only ping: no service worker, no
 * background sync, no `watchPosition`. A phone in a pocket with the screen off
 * stops reporting, and that is accepted for this slice — the customer's page
 * degrades to "ETA on the way", which is honest, rather than to a stale
 * position presented as current. Background tracking is a battery, permission
 * and privacy conversation of its own.
 *
 * PERMISSION DENIED IS NOT AN ERROR. The banner says the customer will not see
 * the driver coming, the pings simply stop, and every other part of the pickup
 * works exactly as before. Nothing here can block a driver at a door.
 */

const PING_INTERVAL_MS = 45_000;
/** A fix older than this is not worth sending. */
const MAX_FIX_AGE_MS = 60_000;

export type GpsPingerState = "idle" | "sending" | "denied" | "unsupported";

export function GpsPinger({
  /** True while the shift has a pickup between "set off" and "delivered". */
  active,
}: {
  active: boolean;
}) {
  const [state, setState] = React.useState<GpsPingerState>("idle");

  React.useEffect(() => {
    if (!active) return;

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
            // The next ping is 45 seconds away; a failed one is not worth
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

    send();
    const id = setInterval(send, PING_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [active]);

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
