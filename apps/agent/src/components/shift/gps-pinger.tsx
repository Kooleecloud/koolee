"use client";

import * as React from "react";

import {
  beaconLastFix,
  enqueue,
  flush,
  requestBackgroundFlush,
  type PositionFix,
} from "@/lib/position-queue";

/**
 * The driver's position, for as long as their shift is open.
 *
 * Feeds the "3.2 miles away · 15–25 min" line, the moving pin on the
 * customer's trip page, and every pin on the driver shortlist.
 *
 * WHAT THIS REPLACED, AND WHY. It was `setInterval` around
 * `getCurrentPosition`: a cold fix every 20 to 45 seconds, dropped on the
 * floor if the network happened to be down at that instant, stopping dead the
 * moment the tab lost focus. TD's report was blunt — the driver's location
 * goes missing while the shift is plainly running — and there was no single
 * cause to fix, because there were five:
 *
 *  1. **A timer only fires in the foreground.** Backgrounded tabs are
 *     throttled to a minute or worse and frozen outright on iOS.
 *  2. **The screen sleeps.** A phone on a passenger seat locks in thirty
 *     seconds and takes the page with it.
 *  3. **A failed send was a lost fix.** One `catch(() => undefined)` and a
 *     tunnel cost every position taken inside it.
 *  4. **Coming back was slow.** A driver reopening the app waited out the
 *     remainder of a 45-second tick before anything was sent.
 *  5. **A revoked permission was invisible** until the next fix failed, and
 *     even then only as a banner nobody was looking at.
 *
 * Each is answered below in the same order: `watchPosition`, a Wake Lock, the
 * IndexedDB queue in `lib/position-queue`, a send on `visibilitychange`, and a
 * `permissions` subscription.
 *
 * WHAT IS STILL TRUE, AND HAS TO BE SAID PLAINLY: none of this makes the web
 * report from a locked phone with the app in the background. A service worker
 * has no geolocation API, Periodic Background Sync is Chromium-only and does
 * not fire on a schedule anybody can rely on, and iOS Safari suspends a
 * backgrounded PWA outright. What this does is make the foreground airtight,
 * survive the network, shorten every gap to about a second on return — and
 * make the gaps that remain VISIBLE, to the driver here and to ops through
 * the staleness the server can now see. Genuine background tracking needs a
 * native wrapper and is deliberately out of scope.
 *
 * OFF THE CLOCK, NOTHING IS SENT. `phase` is null without an open shift and
 * nothing here touches `navigator.geolocation` — no permission prompt, no
 * request, nothing stored.
 */

/**
 * How often to SEND, by what the driver is doing.
 *
 * These are send cadences, not fix cadences, and that distinction is new.
 * `watchPosition` delivers whenever the device has something new to say; this
 * throttles what reaches the network, so the battery cost of a subscription
 * stays close to the old polling cost while the freshness improves.
 *
 * `POSITION_FRESH_MS` in core is sized at roughly four missed sends of the
 * ACTIVE cadence — 90 seconds against these 20. Changing this without
 * revisiting that one is how a pin starts being dropped as stale while the
 * driver is reporting normally.
 *
 *  - **`en_route`** — the pickup has started, the bags are still on the
 *    doorstep, somebody is very plausibly watching a dot approach their house.
 *  - **`carrying`** — seals scanned, bags aboard, booking `in_transit`. The
 *    question has changed from "where are they" to "did they make it", which
 *    the custody trail answers.
 *  - **`on_shift`** — clocked on, nothing running. Somebody may be looking at
 *    this driver as a pin on a shortlist right now, so it is not free to
 *    raise: two sends must fit inside the 90-second freshness window or one
 *    dropped request removes them from every customer's map.
 */
const PING_INTERVAL_MS: Record<GpsPingerPhase, number> = {
  en_route: 20_000,
  carrying: 45_000,
  on_shift: 45_000,
};

/**
 * A fix older than this is not worth reporting.
 *
 * The browser's cache window. A 60-second-old fix is a reasonable answer to
 * "where are you" in city traffic and saves a GPS wake; forcing fresh hardware
 * every time is most of the battery cost.
 */
const MAX_FIX_AGE_MS = 60_000;

/** How long a single fix attempt gets before the browser gives up on it. */
const FIX_TIMEOUT_MS = 30_000;

/**
 * No accepted fix for this long and the chip stops claiming to be live.
 *
 * Twice the slowest cadence plus a margin. Long enough that an ordinary
 * missed send does not cry wolf, short enough that a driver whose location has
 * genuinely stopped finds out from the app rather than from dispatch.
 */
const STALL_AFTER_MS = 120_000;

/** How often the chip re-checks whether it has gone stale. */
const STALL_TICK_MS = 15_000;

export type GpsPingerState = "idle" | "live" | "stalled" | "denied" | "unsupported";

/**
 * What the driver is doing, which decides the cadence, whether a Wake Lock is
 * held, and whether anything is sent at all. `null` means no open shift: off
 * the clock, Koolee knows nothing about where anybody is.
 */
export type GpsPingerPhase = "en_route" | "carrying" | "on_shift";

export function GpsPinger({ phase }: { phase: GpsPingerPhase | null }) {
  const [state, setState] = React.useState<GpsPingerState>("idle");

  /** The newest fix seen, whether or not it has been sent. For the beacon. */
  const latest = React.useRef<PositionFix | null>(null);
  /** When the server last ACCEPTED something. Drives the stall check. */
  const acceptedAt = React.useRef<number>(0);
  /** When we last attempted a send. Drives the throttle. */
  const sentAt = React.useRef<number>(0);

  /*
   * ONE SEND PATH FOR EVERY TRIGGER — the watch, the foreground return, the
   * retry button. Held in a ref so the effects below can call it without
   * listing it as a dependency and re-subscribing the watch every render,
   * which would restart the GPS each time the chip re-rendered.
   */
  const send = React.useRef(async (fix: PositionFix) => {
    sentAt.current = Date.now();
    try {
      const response = await fetch("/api/driver-position", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(fix),
        keepalive: true,
      });
      if (response.ok) {
        acceptedAt.current = Date.now();
        setState("live");
        /*
         * A successful send means the network is back. Anything held from an
         * earlier outage goes now, on a connection that has just proved it
         * works, rather than waiting for a sync event that may never fire on
         * this browser.
         */
        void flush();
        return;
      }
      /*
       * 409 is "not on shift" and is not a network problem — the shift ended
       * under a tab that is still open. Queueing it would mean replaying a
       * fix that will be refused again for the rest of time.
       */
      if (response.status === 409) return;
      if (response.status >= 400 && response.status < 500) return;
      await enqueue(fix);
      void requestBackgroundFlush();
    } catch {
      // Offline, or the request died mid-flight. This is the case the queue
      // exists for: the fix is real, the network is not.
      await enqueue(fix);
      void requestBackgroundFlush();
    }
  });

  /* --- 1. the subscription ------------------------------------------ */

  React.useEffect(() => {
    if (phase === null) return;

    if (typeof navigator === "undefined" || !navigator.geolocation) {
      // Deferred rather than set synchronously: a setState in the body of an
      // effect cascades a second render before paint.
      const timer = setTimeout(() => setState("unsupported"), 0);
      return () => clearTimeout(timer);
    }

    let cancelled = false;
    const interval = PING_INTERVAL_MS[phase];

    /*
     * WATCHPOSITION, NOT AN INTERVAL OF GETCURRENTPOSITION.
     *
     * A subscription lets the device decide when it has something new, which
     * is both fresher and cheaper than waking the GPS on a fixed schedule:
     * a stationary driver produces almost no callbacks, and a moving one
     * produces them as fast as the hardware has news. The throttle below is
     * what keeps the NETWORK cost at the old cadence.
     *
     * It also survives what a timer does not. A backgrounded tab's timers are
     * throttled to a minute or frozen; a watch that is still registered
     * delivers again the instant the page is resumed, which is most of why
     * coming back to the app is now a second rather than most of a minute.
     */
    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        if (cancelled) return;
        const fix: PositionFix = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          recordedAt: new Date(position.timestamp).toISOString(),
        };
        latest.current = fix;

        // THE THROTTLE. Every fix is remembered; only one per cadence is
        // sent. The first callback after (re)subscribing always sends,
        // because `sentAt` is zero or older than the interval — which is what
        // makes a phase change and a foreground return immediate.
        if (Date.now() - sentAt.current < interval) return;
        void send.current(fix);
      },
      (error) => {
        if (cancelled) return;
        setState(error.code === error.PERMISSION_DENIED ? "denied" : "stalled");
      },
      {
        enableHighAccuracy: false,
        timeout: FIX_TIMEOUT_MS,
        maximumAge: MAX_FIX_AGE_MS,
      },
    );

    return () => {
      cancelled = true;
      navigator.geolocation.clearWatch(watchId);
    };
  }, [phase]);

  /* --- 2. the screen stays awake while a job is running -------------- */

  React.useEffect(() => {
    if (phase !== "en_route" && phase !== "carrying") return;
    if (typeof navigator === "undefined" || !("wakeLock" in navigator)) return;

    let sentinel: WakeLockSentinel | null = null;
    let released = false;

    /*
     * THE SINGLE BIGGEST WIN IN THIS FILE, and the least clever thing in it.
     *
     * A phone on a passenger seat locks in thirty seconds. Everything above —
     * the watch, the queue, the throttle — reports nothing at all once the
     * screen is off, because the page is suspended. Holding a Wake Lock while
     * a job is actually running keeps the page alive for the leg that anyone
     * is watching.
     *
     * ONLY WHILE A JOB IS RUNNING. `on_shift` does not qualify: a driver
     * clocked on and waiting is not worth a screen burning down their battery
     * for a pin on a shortlist, and this is their own device.
     *
     * THE BROWSER DROPS IT ON BACKGROUND and does not give it back — a
     * released lock stays released — so it is re-acquired on every return to
     * visible. Without that, one glance at a text message ends the lock for
     * the rest of the shift.
     */
    const acquire = async () => {
      if (released || document.visibilityState !== "visible") return;
      try {
        sentinel = await navigator.wakeLock.request("screen");
      } catch {
        // Denied, low battery, or unsupported. The leg carries on; the screen
        // simply sleeps as it always did.
      }
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") void acquire();
    };

    void acquire();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      released = true;
      document.removeEventListener("visibilitychange", onVisible);
      void sentinel?.release().catch(() => undefined);
    };
  }, [phase]);

  /* --- 3. coming back, and going away -------------------------------- */

  React.useEffect(() => {
    if (phase === null) return;

    /*
     * BACK IN THE FOREGROUND: send whatever is in hand immediately and drain
     * anything the outage left behind. Resetting `sentAt` is what makes the
     * next watch callback bypass the throttle, so the pin is current within
     * about a second of the driver looking at their phone instead of up to
     * three quarters of a minute later.
     */
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      sentAt.current = 0;
      void flush();
      if (latest.current) void send.current(latest.current);
    };

    /*
     * GOING AWAY: hand the newest fix to the browser process, which delivers
     * it after this page is gone. `pagehide` rather than `unload` — the latter
     * is ignored on iOS and disqualifies the page from the back/forward cache
     * everywhere else. See `beaconLastFix`.
     */
    const onPageHide = () => {
      if (latest.current) beaconLastFix(latest.current);
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [phase]);

  /* --- 4. the permission, watched rather than discovered ------------- */

  React.useEffect(() => {
    if (phase === null) return;
    if (typeof navigator === "undefined" || !navigator.permissions?.query) return;

    let cancelled = false;
    /* Held so the listener is actually removed — a subscription that outlives
       its effect fires setState on an unmounted tree at the next clock-off. */
    let detach: (() => void) | null = null;

    /*
     * A REVOKED PERMISSION USED TO BE INVISIBLE until the next fix failed —
     * up to 45 seconds of a driver believing they were being tracked, and on
     * some browsers no error at all, just silence. Subscribing means the chip
     * changes the moment the setting does.
     */
    void navigator.permissions
      .query({ name: "geolocation" as PermissionName })
      .then((result) => {
        if (cancelled) return;
        const apply = () => {
          if (result.state === "denied") setState("denied");
          // Granted again: clear the throttle so the next watch callback goes
          // straight out rather than waiting out a cadence.
          else if (result.state === "granted") sentAt.current = 0;
        };
        apply();
        result.addEventListener("change", apply);
        detach = () => result.removeEventListener("change", apply);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      detach?.();
    };
  }, [phase]);

  /* --- 5. is it actually still live? --------------------------------- */

  React.useEffect(() => {
    if (phase === null) return;
    /*
     * SAYING "LIVE" IS A CLAIM, so it expires. Nothing else here notices a
     * watch that has quietly stopped delivering — a phone that lost its fix
     * indoors raises no error and simply goes quiet — and a chip that keeps
     * saying Live through it is worse than no chip.
     */
    const id = setInterval(() => {
      setState((current) => {
        if (current === "denied" || current === "unsupported") return current;
        if (acceptedAt.current === 0) return current;
        return Date.now() - acceptedAt.current > STALL_AFTER_MS ? "stalled" : "live";
      });
    }, STALL_TICK_MS);
    return () => clearInterval(id);
  }, [phase]);

  /** The one-tap fix: force a fresh hardware fix, bypassing every cache. */
  const retry = React.useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    sentAt.current = 0;
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const fix: PositionFix = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          recordedAt: new Date(position.timestamp).toISOString(),
        };
        latest.current = fix;
        void send.current(fix);
      },
      (error) => {
        setState(error.code === error.PERMISSION_DENIED ? "denied" : "stalled");
      },
      { enableHighAccuracy: true, timeout: FIX_TIMEOUT_MS, maximumAge: 0 },
    );
  }, []);

  if (phase === null) return <span hidden data-gps-phase="off" />;

  return <GpsStatus state={state} onRetry={retry} />;
}

/**
 * What the driver is told, and what they can do about it.
 *
 * IT IS ALWAYS PRESENT, which is the change. The old component rendered
 * nothing at all unless something had already failed, so "is Koolee seeing
 * me?" was unanswerable on the happy path — and a driver who had never seen
 * the banner had no way to know whether that meant working or not looking.
 * A quiet line that says Live is what makes the loud one mean something.
 *
 * `data-gps-state` is on the element deliberately: it makes the transport's
 * real state readable from the DOM in a browser pass, which is how the
 * `null`-return bug in `TripLive` was eventually pinned down.
 */
function GpsStatus({
  state,
  onRetry,
}: {
  state: GpsPingerState;
  onRetry: () => void;
}) {
  if (state === "idle" || state === "live") {
    return (
      <p
        data-gps-state={state}
        className="flex items-center gap-2 text-xs text-muted-foreground"
      >
        <span
          aria-hidden="true"
          className={
            state === "live"
              ? "size-1.5 rounded-full bg-success"
              : "size-1.5 rounded-full bg-muted-foreground/40"
          }
        />
        {state === "live" ? "Location live" : "Finding your location…"}
      </p>
    );
  }

  return (
    <div
      role="status"
      data-gps-state={state}
      className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-navy-700"
    >
      <span>
        {state === "denied"
          ? "Location is off for this site, so your customer can't see you coming. Turn it on in your browser settings — everything else works as normal."
          : state === "unsupported"
            ? "This device can't share a location, so your customer won't see you coming. Everything else works as normal."
            : "We've lost your location. Your customer can't see you moving — everything else works as normal."}
      </span>
      {state !== "unsupported" && (
        <button
          type="button"
          onClick={onRetry}
          className="rounded-md border border-navy-300 px-2 py-1 text-xs font-medium text-navy-800"
        >
          Try again
        </button>
      )}
    </div>
  );
}
