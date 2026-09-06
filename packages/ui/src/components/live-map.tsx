"use client";

import * as React from "react";
/*
 * NAMED IMPORTS, not a default. maplibre-gl 6 ships ESM only and exports no
 * default — `import maplibregl from "maplibre-gl"` type-errors, and in a
 * bundler that papers over it you get `undefined.Map is not a function` at
 * runtime instead.
 */
import { createPortal } from "react-dom";
import {
  FullscreenControl,
  getWorkerUrl,
  LngLatBounds,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  Popup,
  setWorkerUrl,
} from "maplibre-gl";

import { cn } from "../lib/utils";

/**
 * The map, for watching a van come to your door.
 *
 * WHY THERE IS A MAP NOW. The driver card used to say "3.2 km away · Position
 * updating" and that was a deliberate call at the time: a map is a library,
 * third-party tiles, and somebody's live coordinate drawn at street
 * resolution. But "how long until somebody knocks" is not the only question a
 * person waiting on their bags is asking — they are also asking "is anything
 * actually happening", and a number that changes every 45 seconds answers that
 * worse than a pin that moves. Every delivery product in the world shows a map
 * for exactly this reason.
 *
 * WHY MAPLIBRE AND OPENFREEMAP, AND NOT GOOGLE MAPS.
 *
 * Google's Maps JavaScript API is a separate SKU from the Places and Routes
 * calls this product already makes — Dynamic Maps bills per map LOAD past a
 * 10,000/month free tier — and it needs a browser-side key restricted by HTTP
 * referrer, which is a key anybody can read out of the bundle and spend.
 * Today the only Maps key in this repo is server-only and never ships to a
 * browser (`/api/places` exists for precisely that reason), and it is worth
 * keeping that true.
 *
 * MapLibre GL is the open-source fork of Mapbox GL JS and needs no key at all.
 * OpenFreeMap serves OpenStreetMap vector tiles with no key, no rate limit and
 * no account, and MapLibre adds its attribution automatically. Google keeps
 * doing what it is good at and what we already pay for: geocoding an address
 * (Places) and estimating a drive (Routes), both server-side.
 *
 * SWAPPING IS ONE URL. `styleUrl` is a prop with a default. Moving to MapTiler,
 * Protomaps or a self-hosted tileset later is a string, not a rewrite.
 *
 * THE MAP IS NEVER A GATE. It mounts lazily, and every failure — a tile host
 * that is down, WebGL unavailable, a browser that refuses the canvas — leaves
 * the list of drivers and the ETA underneath it exactly as they were. Nothing
 * about choosing a driver or watching one arrive depends on this rendering.
 */

/** OpenFreeMap's "liberty" style. No key, no limit, attribution automatic. */
const DEFAULT_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

/**
 * Where the app serves MapLibre's tile-parsing worker from.
 *
 * THIS IS THE FIX FOR "THE MAP CAN'T LOAD RIGHT NOW", and it is not what
 * anybody looking at that sentence would guess. maplibre-gl 6 works out where
 * its worker lives from `import.meta.url`:
 *
 *     const here = import.meta.url;
 *     if (!/^https?:/.test(here)) return "";
 *     return new URL("./maplibre-gl-worker.mjs", here).href;
 *
 * That holds only when the library is served unbundled over HTTP. Under
 * Turbopack `import.meta.url` is not an `http(s):` URL, so it returns the
 * EMPTY STRING and MapLibre goes on to call `new Worker("", {type:"module"})`.
 * An empty URL resolves against the document, so the browser fetches the
 * current PAGE and tries to execute the HTML as a module; the Worker emits an
 * `error`, and MapLibre never re-raises it as a map `error`.
 *
 * The result is a map that fetches its style, its TileJSON and its sprites
 * successfully — all 200 — and then never requests one glyph or one vector
 * tile, never fires `load`, and reports nothing. The ten-second deadline below
 * was the only thing catching it, which is why the customer saw an apology
 * rather than a map, on a laptop and on Vercel alike.
 *
 * `scripts/copy-maplibre-worker.mjs` copies the worker (and the shared module
 * it imports) out of `node_modules` into the app's `public/maplibre/` before
 * every dev and every build. Same-origin, so MapLibre constructs the worker
 * directly rather than going through its cross-origin blob path.
 *
 * AN APP THAT MOUNTS THIS COMPONENT MUST RUN THAT SCRIPT. Only `apps/web`
 * does today. If admin or agent ever render a map, add the step to its `dev`
 * and `build` scripts — the failure otherwise is exactly the silent one above.
 */
const DEFAULT_WORKER_URL = "/maplibre/maplibre-gl-worker.mjs";

export interface MapPoint {
  lat: number;
  lng: number;
}

export interface MapDriver {
  /** Stable across renders — the shift id. Used to reconcile markers. */
  id: string;
  position: MapPoint;
  /** Rendered inside the pin. A first name, or empty. */
  label?: string | null;
  selected?: boolean;
}

export interface LiveMapProps {
  /** The door. Always drawn, and what the map frames when there is nothing else. */
  pickup: MapPoint;
  /** Everybody worth showing. An empty list is fine — the door still draws. */
  drivers?: readonly MapDriver[];
  /** Called when a driver's pin is clicked. Omit to make pins inert. */
  onDriverClick?: (id: string) => void;
  /** Tailwind height, e.g. `h-72`. The map fills its container. */
  className?: string;
  /** Override the tile style. See the header — this is the swap point. */
  styleUrl?: string;
  /**
   * Override where the tile-parsing worker is served from. See
   * {@link DEFAULT_WORKER_URL} — an app that mounts this component must serve
   * it, or the map dies silently.
   */
  workerUrl?: string;
  /** Accessible description of what the map is showing. */
  label: string;
  /**
   * What the pickup pin says when it is tapped, and what a screen reader
   * announces it as.
   *
   * A second line — the street, usually — is optional and is the reason this
   * is a pair rather than a string: "Your pickup" answers which pin it is, and
   * the address answers whether it is the right one, which is the question
   * somebody who booked for a friend actually has.
   */
  pickupLabel?: string;
  pickupAddressLine?: string | null;
  /*
   * THERE IS DELIBERATELY NO "WHERE AM I" CONTROL, and this is the second
   * time that decision has been made.
   *
   * MapLibre ships a `GeolocateControl` and it was wired in here, because the
   * slice asked for the customer's own dot. It came out again on TD's
   * reasoning, which is better than the requirement: THE PICKUP ADDRESS IS THE
   * ANCHOR, not the viewer.
   *
   * Somebody booking a pickup for a friend across the city — or from an
   * office, or from another country — is shown a dot that is irrelevant and
   * looks like it means something. The question this map answers is "how close
   * is a van to THE DOOR", and the viewer's own position is not an input to
   * it. Even in the common case where they are standing at the address, the
   * pickup pin is already there and their dot adds nothing but a second thing
   * to interpret.
   *
   * It also costs a permission prompt, which is one-shot per origin in most
   * browsers — spending it on a feature that cannot help is worse than not
   * having it.
   */

  /** Offer a fullscreen toggle. Worth it wherever the map is a chooser. */
  allowFullscreen?: boolean;
  /**
   * Draw the map's own border and rounded corners. Default true.
   *
   * `false` is for a map that BLEEDS to its container's edge — a card whose
   * section has dropped its padding so the map spans the full width. There the
   * map's own border sits a pixel inside the card's and reads as a double
   * rule, and its rounded corners fight the card's. The container clips
   * instead (it needs `overflow-hidden`), so the map takes the card's radius
   * rather than drawing a second one.
   */
  frame?: boolean;
  /**
   * Which driver has an anchored card open, or null for none.
   *
   * CONTROLLED, not internal state. Which pin is open is the same fact as
   * which card is highlighted in the list below, and two components each
   * holding their own copy of it is how they end up disagreeing. The page owns
   * it; the map renders it.
   */
  popupDriverId?: string | null;
  /**
   * The card's contents, for the open driver. The map anchors it to the pin
   * and keeps it there through every pan and zoom; everything inside is the
   * caller's — a name, a capacity, an ETA and a button the map knows nothing
   * about.
   */
  renderPopup?: (driverId: string) => React.ReactNode;
  /** The viewer dismissed the card (its close button, or Escape). */
  onPopupClose?: () => void;
  /**
   * What the recenter button says. Names the thing it goes back to, because
   * "Reset" describes the mechanism and "Back to my pickup" describes the
   * destination — and only one of those is what somebody is looking for.
   */
  recenterLabel?: string;
}

/**
 * Why a map gave up, for the DOM and for the console.
 *
 * `failed` alone answered "is it broken" and never "how", which is precisely
 * what made the worker bug above take three attempts to find: the two causes
 * look identical on screen and have nothing in common underneath.
 */
type MapFailure = "webgl" | "style" | "timeout";

/**
 * Frames the door and every driver, with room to breathe — and MORE room at
 * the bottom, because the attribution bar lives there.
 *
 * Observed, not guessed: with even padding, a driver pin at the southern edge
 * of the shortlist landed underneath "OpenFreeMap © OpenMapTiles" and a real
 * click on it hit the attribution instead of the pin. The pin was visible
 * enough to invite the tap and covered enough to swallow it, which is the
 * worst of both.
 */
const FIT_PADDING = { top: 48, right: 48, bottom: 72, left: 48 };
const SOLO_ZOOM = 14;

/**
 * How long a map gets to reach `load` before we call it broken.
 *
 * NOT PARANOIA — this is a failure that was actually observed. A MapLibre map
 * whose tile-parsing worker cannot be fetched raises NO `error` event and
 * throws nothing: the style, the sprites and the TileJSON all resolve, the
 * canvas mounts at the right size, the zoom buttons work, and it simply never
 * requests a tile. What the customer sees is a blank cream rectangle, forever,
 * with no way to know it is not just slow.
 *
 * Ten seconds is far longer than a cold load on a bad connection and short
 * enough that nobody sits staring at nothing. Cleared the moment `load` fires,
 * so a slow map is never punished for being slow.
 */
const LOAD_TIMEOUT_MS = 10_000;

/**
 * How long a pin takes to walk from one fix to the next.
 *
 * The driver's phone reports every 20 seconds while they are on their way to
 * a door (45 once the bags are aboard — see `GpsPinger`), so without this the
 * van TELEPORTS a third of a minute at a time, which reads as a broken map
 * rather than a moving vehicle. 1.2s is long enough to be unmistakably motion
 * and far short of the next fix, so a pin is always at rest by the time the
 * following one lands: it never looks like it is lagging reality.
 *
 * This is a straight line between two points, NOT a route. Interpolating along
 * roads would mean a polyline per update from a billed routing API, for an
 * illusion nobody is checking against the kerb at this zoom.
 */
const MOVE_DURATION_MS = 1200;

/**
 * Past this, jump instead of animating.
 *
 * A van covers something like 270m in 20 seconds through city traffic, and
 * 600m in 45. Two and a half kilometres between consecutive fixes is a GPS
 * glitch, a phone that woke up somewhere else, or a different driver on the
 * same pin — and animating it would draw a smooth 1.2-second drive that never
 * happened. A jump is the honest rendering of "we do not know how they got
 * there". Kept well clear of both cadences on purpose: this threshold exists
 * to catch nonsense, not to second-guess a fast road.
 */
const MAX_SMOOTH_METRES = 2500;

/** Metres between two points. Good enough over a city; this is not navigation. */
function metresBetween(a: MapPoint, b: MapPoint): number {
  const R = 6_371_000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Ease-out cubic: quick off the mark, settling gently. How a vehicle stops. */
const easeOut = (t: number): number => 1 - (1 - t) ** 3;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function LiveMap({
  pickup,
  drivers = [],
  onDriverClick,
  className,
  styleUrl = DEFAULT_STYLE_URL,
  workerUrl = DEFAULT_WORKER_URL,
  label,
  allowFullscreen = false,
  frame = true,
  pickupLabel = "Your pickup",
  pickupAddressLine = null,
  popupDriverId = null,
  renderPopup,
  onPopupClose,
  recenterLabel = "Back to my pickup",
}: LiveMapProps) {
  const container = React.useRef<HTMLDivElement | null>(null);
  const map = React.useRef<MapLibreMap | null>(null);
  // `Map` here is MapLibre's, so the JS one needs its global name spelled out.
  const markers = React.useRef(new globalThis.Map<string, Marker>());
  const pickupMarker = React.useRef<Marker | null>(null);
  /**
   * The pickup pin's own card. Created with the map, moved and refilled on
   * each tap — one instance, like the driver one, for the same reason.
   */
  const pickupPopup = React.useRef<Popup | null>(null);
  /**
   * In-flight pin animations, by driver id.
   *
   * Held so a fix that arrives mid-walk cancels the previous one rather than
   * fighting it — two `requestAnimationFrame` loops writing the same marker
   * make it stutter between two destinations.
   */
  const moves = React.useRef(new globalThis.Map<string, number>());
  /**
   * The DOM node MapLibre's popup positions, and that React renders into.
   *
   * State rather than a ref because the portal below has to re-render the
   * moment the node exists — a ref write does not schedule one, so the card
   * would stay empty until something else happened to re-render the map.
   */
  const [popupHost, setPopupHost] = React.useState<HTMLDivElement | null>(null);
  const popup = React.useRef<Popup | null>(null);
  /**
   * `onPopupClose`, held in a ref for the same reason `clickRef` exists: the
   * popup is created once and its `close` listener would otherwise call the
   * first render's handler forever.
   */
  const popupCloseRef = React.useRef(onPopupClose);
  React.useEffect(() => {
    popupCloseRef.current = onPopupClose;
  }, [onPopupClose]);

  const [failed, setFailed] = React.useState<MapFailure | null>(null);
  const [ready, setReady] = React.useState(false);
  /**
   * `ready`, readable from inside the create-once effect.
   *
   * That effect closes over the FIRST render's `ready` forever (its deps are
   * `[styleUrl]`), so the `error` listener below cannot ask the state whether
   * the map has loaded. A ref can. Same stale-closure shape as `clickRef`
   * above, and the same fix.
   */
  const loaded = React.useRef(false);

  /*
   * The click handler, held in a ref.
   *
   * Markers are created once per driver and their DOM listener closes over
   * whatever handler existed at creation time. Without this indirection a
   * marker made on the first render would keep calling the first render's
   * `onDriverClick` forever — the classic stale-closure bug, and an
   * unpleasant one here because it fails silently rather than throwing.
   *
   * Written in an EFFECT rather than during render: a ref write in a render
   * body is not safe under concurrent rendering, and the lint rule that says
   * so is right. The listener only fires after paint, so an effect is early
   * enough by construction.
   */
  const clickRef = React.useRef(onDriverClick);
  React.useEffect(() => {
    clickRef.current = onDriverClick;
  }, [onDriverClick]);

  /* --- the map itself, created once ---------------------------------- */
  React.useEffect(() => {
    if (map.current || !container.current) return;

    /*
     * BEFORE the first `new MapLibreMap`, and every time, because MapLibre
     * reads `WORKER_URL` when it acquires the worker pool rather than at
     * import. Idempotent, and cheap enough that guarding it would only add a
     * way to get the ordering wrong.
     *
     * `getWorkerUrl()` returning "" here is the bug in {@link
     * DEFAULT_WORKER_URL} arriving; the log names it rather than leaving the
     * next person to rediscover it from a blank rectangle.
     */
    if (!getWorkerUrl()) {
      console.info(
        "[live-map] maplibre derived no worker url from import.meta.url (expected under a bundler); serving it from",
        workerUrl,
      );
    }
    setWorkerUrl(workerUrl);

    let instance: MapLibreMap;
    try {
      instance = new MapLibreMap({
        container: container.current,
        style: styleUrl,
        center: [pickup.lng, pickup.lat],
        zoom: SOLO_ZOOM,
        // A customer watching a van does not need to rotate the world, and a
        // stray two-finger twist on a phone leaves the map at an angle they
        // cannot undo.
        pitchWithRotate: false,
        dragRotate: false,
        touchZoomRotate: true,
        /*
         * ONE FINGER SCROLLS THE PAGE; TWO PAN THE MAP.
         *
         * Without this a map sitting mid-page is a scroll trap on a phone:
         * a thumb landing anywhere on it pans the map, and the page under it
         * will not move — so somebody trying to reach the driver list below
         * is stuck dragging a map they did not want to move. MapLibre shows
         * its own hint the first time a single finger tries.
         *
         * On desktop it also means the wheel scrolls the page and ctrl+wheel
         * zooms, which is the behaviour every embedded map has taught people
         * to expect.
         */
        cooperativeGestures: true,
        attributionControl: { compact: true },
      });
    } catch {
      // No WebGL, or a browser that refuses the canvas. The list below the
      // map is the whole product; this is the garnish.
      //
      // Deferred rather than set synchronously: a setState in the body of an
      // effect cascades a second render before paint. Same treatment as
      // `GpsPinger`'s unsupported branch in the agent app.
      const timer = setTimeout(() => setFailed("webgl"), 0);
      return () => clearTimeout(timer);
    }

    instance.touchZoomRotate.disableRotation();
    instance.addControl(new NavigationControl({ showCompass: false }), "top-right");
    if (allowFullscreen) {
      instance.addControl(new FullscreenControl(), "top-right");
    }
    // The deadline above. Armed before `load` is wired so a map that never
    // starts is caught as surely as one that starts and stalls.
    const deadline = setTimeout(() => {
      /*
       * A map that reached neither `load` nor an `error` in ten seconds. The
       * cause is almost always the worker — see {@link DEFAULT_WORKER_URL} —
       * and the console line is the whole diagnosis, because this failure
       * produces no other evidence anywhere.
       */
      console.error(
        `[live-map] no load event in ${LOAD_TIMEOUT_MS}ms. Worker url: ${
          getWorkerUrl() || "(none)"
        } — if that 404s, the app is not running scripts/copy-maplibre-worker.mjs.`,
      );
      setFailed("timeout");
    }, LOAD_TIMEOUT_MS);
    instance.on("load", () => {
      clearTimeout(deadline);
      loaded.current = true;
      setReady(true);
    });

    /*
     * ONE `error` USED TO KILL THE MAP FOREVER, and this is the bug TD
     * reported as "the map can't load, everything else on the page is fine".
     *
     * `instance.on("error", () => setFailed(true))` treated every MapLibre
     * error as fatal and permanent. MapLibre emits `error` for things that
     * are neither: a single tile that 404s at one zoom level, a glyph or
     * sprite range that misses, a request aborted because the pin moved and
     * the viewport changed under it. A map that had loaded, drawn and been
     * panned around would emit one of those on a slow connection, and the
     * component swapped a working map for "the map can't load right now" —
     * with no way back, because `failed` is never cleared and the early
     * return unmounts the container, which tears the instance down.
     *
     * So an error is fatal ONLY BEFORE `load`. Before it, the likely cause is
     * the style itself failing and there is nothing on screen to lose. After
     * it, the map is drawing: MapLibre retries tiles on its own, and the
     * worst case is a blank square in one corner rather than a page that
     * claims to be broken. The ten-second deadline still catches the failure
     * that raises no error at all — a tile-parsing worker that never
     * arrives — which is the case it was written for.
     */
    instance.on("error", (event: unknown) => {
      if (loaded.current) {
        // Kept, not swallowed silently: this is the only place a tile problem
        // is observable at all, and the next person diagnosing a patchy map
        // needs it to exist.
        console.warn("[live-map] non-fatal error after load", event);
        return;
      }
      console.error("[live-map] fatal error before load", event);
      setFailed("style");
    });

    map.current = instance;

    // Captured now, not read at teardown: the lint rule is right that
    // `markers.current` may be a different object by then. It is the same
    // Map for the life of this component, but relying on that in a cleanup is
    // how the exception becomes the habit.
    const created = markers.current;

    return () => {
      clearTimeout(deadline);
      loaded.current = false;
      for (const marker of created.values()) marker.remove();
      created.clear();
      pickupMarker.current?.remove();
      pickupMarker.current = null;
      instance.remove();
      map.current = null;
    };
    // Created once. `pickup` is only the initial centre; the effect below
    // keeps the actual pin in step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [styleUrl, workerUrl]);

  /* --- the door ------------------------------------------------------- */
  React.useEffect(() => {
    const instance = map.current;
    if (!instance || !ready) return;

    if (!pickupMarker.current) {
      const element = pickupPin(pickupLabel);
      /*
       * ITS OWN POPUP, and deliberately not the driver one.
       *
       * What the pickup pin says involves no page state — no selection, no
       * race, nothing to commit — so routing it through the controlled
       * `popupDriverId` would mean the page owning a fact it has no use for,
       * and two things that can be open would have to agree about which. Two
       * instances cannot conflict: MapLibre closes neither, and each is
       * anchored to its own coordinate.
       */
      element.addEventListener("click", (event) => {
        event.stopPropagation();
        const instance = map.current;
        if (!instance) return;
        pickupPopup.current
          ?.setLngLat([pickup.lng, pickup.lat])
          .setDOMContent(pickupPopupContent(pickupLabel, pickupAddressLine))
          .addTo(instance);
      });
      pickupMarker.current = new Marker({ element })
        .setLngLat([pickup.lng, pickup.lat])
        .addTo(instance);
    } else {
      pickupMarker.current.setLngLat([pickup.lng, pickup.lat]);
    }
  }, [pickup.lat, pickup.lng, ready, pickupLabel, pickupAddressLine]);

  /* --- the drivers ---------------------------------------------------- */
  React.useEffect(() => {
    const instance = map.current;
    if (!instance || !ready) return;

    const seen = new Set<string>();

    for (const driver of drivers) {
      seen.add(driver.id);
      const existing = markers.current.get(driver.id);

      if (existing) {
        /*
         * MOVED, NOT REPLACED, and WALKED rather than jumped. Re-creating the
         * marker would teleport the pin and drop any transition; animating
         * `setLngLat` on the same element is what makes a van appear to drive
         * rather than blink from block to block every 45 seconds. The class
         * swap keeps the selected state in step without touching position.
         */
        const from = existing.getLngLat();
        walkMarker(
          existing,
          { lat: from.lat, lng: from.lng },
          driver.position,
          (frame) => {
            const previous = moves.current.get(driver.id);
            if (previous !== undefined) cancelAnimationFrame(previous);
            if (frame === null) moves.current.delete(driver.id);
            else moves.current.set(driver.id, frame);
          },
        );
        setPinSelected(existing.getElement(), driver.selected ?? false);
        continue;
      }

      const element = driverPin(driver);
      element.addEventListener("click", (event) => {
        event.stopPropagation();
        clickRef.current?.(driver.id);
      });
      markers.current.set(
        driver.id,
        new Marker({ element })
          .setLngLat([driver.position.lng, driver.position.lat])
          .addTo(instance),
      );
    }

    // A driver who clocked off, or whose phone stopped reporting.
    for (const [id, marker] of markers.current) {
      if (seen.has(id)) continue;
      const frame = moves.current.get(id);
      if (frame !== undefined) cancelAnimationFrame(frame);
      moves.current.delete(id);
      marker.remove();
      markers.current.delete(id);
    }
  }, [drivers, ready]);

  /* --- the anchored card ---------------------------------------------- */

  /*
   * ONE POPUP, MOVED — never one per driver, and never re-created per open.
   *
   * MapLibre keeps a popup pinned to a coordinate through every pan, zoom and
   * resize, which is the entire reason to use it rather than positioning a
   * card with `map.project` and a `moveend` listener. Its content node is
   * created once and portalled into, so React reconciles the card's insides
   * normally while MapLibre owns only where the box sits.
   *
   * `closeOnClick` is FALSE. The map click that opens a popup is a click on a
   * pin, which bubbles to the map — with it on, a popup opened and closed in
   * the same gesture and the card never appeared. `closeOnMove` is false for
   * the same class of reason: the driver's own ping moves the map, and a card
   * that vanishes every twenty seconds while somebody is reading it is worse
   * than no card.
   */
  React.useEffect(() => {
    const instance = map.current;
    if (!instance || !ready) return;

    const host = document.createElement("div");
    const created = new Popup({
      closeButton: true,
      closeOnClick: false,
      closeOnMove: false,
      // Clear of the pin, which is anchored at its own centre.
      offset: 18,
      maxWidth: "17rem",
      className: "koolee-map-popup",
    }).setDOMContent(host);

    // Fires for the close button AND for Escape, so both routes reach the
    // page rather than leaving it believing a card is still open.
    created.on("close", () => popupCloseRef.current?.());

    popup.current = created;
    setPopupHost(host);

    const forPickup = new Popup({
      closeButton: true,
      closeOnClick: false,
      closeOnMove: false,
      offset: 20,
      maxWidth: "15rem",
      className: "koolee-map-popup",
    });
    pickupPopup.current = forPickup;

    return () => {
      created.remove();
      popup.current = null;
      setPopupHost(null);
      forPickup.remove();
      pickupPopup.current = null;
    };
  }, [ready]);

  React.useEffect(() => {
    const instance = map.current;
    const card = popup.current;
    if (!instance || !card || !ready) return;

    const driver = popupDriverId
      ? drivers.find((candidate) => candidate.id === popupDriverId)
      : undefined;

    /*
     * A DRIVER WHO DISAPPEARS TAKES THEIR CARD WITH THEM. They clocked off,
     * or their van filled up and the shortlist refreshed underneath an open
     * card. Leaving it would offer a Select button for somebody who is no
     * longer selectable — the race the page already handles, arriving here as
     * a stale card instead of a stale click.
     */
    if (!driver) {
      if (card.isOpen()) card.remove();
      return;
    }

    card.setLngLat([driver.position.lng, driver.position.lat]);
    if (!card.isOpen()) card.addTo(instance);
  }, [popupDriverId, drivers, ready]);

  /** Nothing may keep animating a marker that is no longer on a map. */
  React.useEffect(() => {
    const inFlight = moves.current;
    return () => {
      for (const frame of inFlight.values()) cancelAnimationFrame(frame);
      inFlight.clear();
    };
  }, []);

  /* --- framing -------------------------------------------------------- */

  /** Which set of drivers the viewport was last framed for. */
  const framedFor = React.useRef<string | null>(null);
  /**
   * The viewer has moved the map themselves, so it is theirs now.
   *
   * A ref rather than state because the map's own listeners set it and no
   * render depends on the flag itself — `offFrame` below is the rendered
   * consequence, and it is recomputed on `moveend`.
   */
  const userMoved = React.useRef(false);
  /**
   * The viewer has taken the map, so the way back is offered.
   *
   * Mirrors `userMoved` into a render. It is deliberately NOT "something is
   * off screen": that was the first rule and it was too clever — a customer
   * who nudged the map and lost their bearings got no button, because
   * technically everything was still in frame. The honest rule is the one the
   * viewer can feel: the moment the map stops framing itself, it says so and
   * offers the way back.
   */
  const [taken, setTaken] = React.useState(false);

  /**
   * Frames the door and every driver. The one place that decides the viewport.
   */
  const frameAll = React.useCallback(() => {
    const instance = map.current;
    if (!instance) return;

    if (drivers.length === 0) {
      instance.easeTo({ center: [pickup.lng, pickup.lat], zoom: SOLO_ZOOM });
      return;
    }
    const bounds = new LngLatBounds([pickup.lng, pickup.lat], [pickup.lng, pickup.lat]);
    for (const driver of drivers)
      bounds.extend([driver.position.lng, driver.position.lat]);
    // `maxZoom` matters: a driver already outside the building would otherwise
    // frame two pins a few metres apart at street level, which is a map of
    // nothing.
    instance.fitBounds(bounds, { padding: FIT_PADDING, maxZoom: 15, duration: 600 });
  }, [drivers, pickup.lat, pickup.lng]);

  /*
   * A USER GESTURE ENDS THE AUTO-FRAMING, AND OFFERS A WAY BACK.
   *
   * Before this the map re-framed itself whenever a driver left the viewport,
   * which sounds considerate and is not: somebody who zoomed in to see which
   * corner the van was on had the viewport pulled out from under them at the
   * next ping, every ping, with no way to stop it. Their pan is theirs to
   * keep — TD's report, and it is right.
   *
   * So the map frames itself only while nobody has touched it. The moment a
   * real gesture arrives, automatic framing stops for good and a button
   * appears instead whenever something worth seeing has gone off screen.
   * Choosing to go back is a tap; being dragged back is not a choice.
   *
   * `originalEvent` is what separates a person's drag from our own
   * `fitBounds`/`easeTo` — MapLibre fires the same events for both, and
   * without the check the map would end its own auto-framing on the first
   * frame it drew.
   */
  React.useEffect(() => {
    const instance = map.current;
    if (!instance || !ready) return;

    /*
     * `originalEvent` is what separates a person's drag from our own
     * `fitBounds`/`easeTo`. MapLibre fires the same events for both, and
     * without the check the map would end its own auto-framing on the very
     * first frame it drew.
     */
    const onMoveStart = (event: { originalEvent?: unknown }) => {
      if (!event.originalEvent) return;
      userMoved.current = true;
      setTaken(true);
    };

    instance.on("dragstart", onMoveStart);
    instance.on("zoomstart", onMoveStart);
    instance.on("rotatestart", onMoveStart);
    return () => {
      instance.off("dragstart", onMoveStart);
      instance.off("zoomstart", onMoveStart);
      instance.off("rotatestart", onMoveStart);
    };
  }, [ready]);

  React.useEffect(() => {
    const instance = map.current;
    if (!instance || !ready) return;

    /*
     * FRAME ON A NEW SET OF DRIVERS, NOT ON EVERY POSITION.
     *
     * The tracking map re-renders every time the driver pings — every 20 to 45
     * seconds — and this used to `fitBounds` on each one, because `drivers` is
     * a fresh array identity per render.
     *
     * A driver arriving or dropping out is still worth re-framing for, because
     * the set of things the map is FOR has changed. A driver merely moving is
     * not.
     */
    const signature = drivers
      .map((driver) => driver.id)
      .sort()
      .join("|");
    const sameSet = framedFor.current === signature;
    framedFor.current = signature;

    // Once the viewer has taken the map, they keep it. The recenter button is
    // the way back, and it is the only way back.
    if (userMoved.current) return;
    if (sameSet) return;
    frameAll();
  }, [drivers, ready, frameAll]);

  const recenter = React.useCallback(() => {
    userMoved.current = false;
    setTaken(false);
    frameAll();
  }, [frameAll]);

  if (failed) {
    // Deliberately quiet. The customer is not missing anything they need — the
    // driver list and the ETA are right below this.
    //
    // The SENTENCE stays generic on purpose. "Map style not configured" or
    // "worker script missing" is true and is also somebody else's problem
    // described to a person waiting on their bags; the copy rules do not admit
    // it. What the customer gets is honest and actionable ("everything else is
    // up to date"); what an engineer gets is `data-map-failure` and a console
    // line naming the cause exactly.
    return (
      <div
        // Same idea as `data-live-signal` on the realtime probe: "is this map
        // broken, or is it just slow?" should be answerable by looking at the
        // DOM rather than by asking somebody to open a console. This is what
        // TD's report had to be diagnosed WITHOUT.
        data-map-state="failed"
        data-map-failure={failed}
        className={cn(
          "flex items-center justify-center border-dashed border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground",
          frame ? "rounded-lg border" : "border-y",
          className,
        )}
      >
        The map can&apos;t load right now. Everything else on this page is up to date.
      </div>
    );
  }

  return (
    /*
     * A wrapper, so the recenter button can sit OVER the map.
     *
     * The caller's `className` (a height, usually) lands HERE, and the map
     * fills it. The button positions against this element.
     *
     * THE MAP FILLS ITS PARENT; IT IS NOT ABSOLUTELY POSITIONED.
     *
     * The obvious version — `absolute inset-0` on the container — silently
     * does not work, and the way it fails is worth writing down. MapLibre adds
     * `.maplibregl-map` to whatever element you hand it, and
     * `maplibre-gl.css` sets `position: relative` on that class. Tailwind v4
     * puts its utilities in `@layer utilities`, and unlayered CSS beats
     * layered CSS regardless of specificity or source order — so MapLibre's
     * `relative` wins over `.absolute` every time.
     *
     * The result was a container computing to `position: relative` with
     * `inset: 0` doing nothing, collapsing to 2px tall while the canvas stayed
     * 300px: a sliver of map, no error anywhere. `h-full w-full` needs no
     * positioning at all and cannot lose that fight.
     */
    <div className={cn("relative", className)}>
      <div
        ref={container}
        role="img"
        aria-label={label}
        data-map-state={ready ? "ready" : "loading"}
        className="size-full overflow-hidden rounded-lg border border-border bg-muted/30"
      />
      {/*
        Shown from the moment the viewer moves the map, and only then — a
        button on an untouched map is clutter offering to undo something
        nobody did.

        It appears exactly when automatic framing STOPS, which is what makes
        the pair legible: the map is yours now, and this gives it back.

        Bottom-left: the zoom, fullscreen and geolocate controls are top-right
        and the attribution is bottom-right, so this is the one corner nothing
        else claims.
      */}
      {taken && (
        <button
          type="button"
          onClick={recenter}
          data-map-recenter
          className={cn(
            "absolute bottom-3 left-3 z-10 flex items-center gap-1.5 rounded-full",
            "border border-border bg-background/95 px-3 py-1.5 shadow-lift",
            "text-xs font-medium text-navy-800 backdrop-blur-sm",
            "transition-colors hover:bg-background",
            "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          <svg
            viewBox="0 0 24 24"
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
          </svg>
          {recenterLabel}
        </button>
      )}

      {/*
        The card's insides, rendered by React into the node MapLibre carries.
        A portal rather than markup inside the map container: MapLibre reparents
        and repositions that node itself, and anything React tried to own the
        position of would fight it.
      */}
      {popupHost && popupDriverId && renderPopup
        ? createPortal(renderPopup(popupDriverId), popupHost)
        : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Pins                                                                */
/* ------------------------------------------------------------------ */

/*
 * Markers are built as DOM rather than as React elements because MapLibre owns
 * their position and re-parents them on every frame — rendering them through
 * React would mean a portal per pin and a re-render per pan. These are small
 * enough to write by hand, and doing so keeps the map's frame budget entirely
 * outside React.
 */

/**
 * Walks a marker from one fix to the next over {@link MOVE_DURATION_MS}.
 *
 * `onFrame` hands the caller each `requestAnimationFrame` handle so it can
 * cancel a walk in progress — the loop itself holds no state, which is what
 * keeps it safe to call again before the previous one has finished.
 *
 * Three cases refuse to animate, all deliberately:
 *  - a move of a few metres, which is GPS noise rather than travel, and would
 *    make a parked van jitter continuously;
 *  - a move beyond {@link MAX_SMOOTH_METRES}, which did not happen in 45
 *    seconds and must not be drawn as though it did;
 *  - `prefers-reduced-motion`, where the pin still updates and simply does not
 *    slide there.
 */
function walkMarker(
  marker: Marker,
  from: MapPoint,
  to: MapPoint,
  onFrame: (frame: number | null) => void,
): void {
  const distance = metresBetween(from, to);

  if (distance < 5 || distance > MAX_SMOOTH_METRES || prefersReducedMotion()) {
    onFrame(null);
    marker.setLngLat([to.lng, to.lat]);
    return;
  }

  const started = performance.now();

  const step = (nowMs: number) => {
    const progress = Math.min(1, (nowMs - started) / MOVE_DURATION_MS);
    const eased = easeOut(progress);
    marker.setLngLat([
      from.lng + (to.lng - from.lng) * eased,
      from.lat + (to.lat - from.lat) * eased,
    ]);
    if (progress < 1) onFrame(requestAnimationFrame(step));
    else onFrame(null);
  };

  onFrame(requestAnimationFrame(step));
}

/*
 * THE MARKER ROOT BELONGS TO MAPLIBRE. NOTHING ELSE MAY STYLE IT.
 *
 * This is the pin flicker TD reported, and it is not a hover bug — hovering
 * only made it visible. MapLibre positions a marker by writing
 *
 *     element.style.transform = "translate(-50%,-50%) translate(412px, 233px)"
 *
 * on the marker's own root element, on EVERY render frame. The pin carried
 * `transition-transform`, and in Tailwind v4 that covers `transform`,
 * `translate`, `scale` and `rotate` — so the browser was asked to animate
 * every one of those position writes over 150ms. During `walkMarker`'s 1.2s
 * requestAnimationFrame walk, and during any pan or zoom, the transition
 * restarted before the previous one finished: the pin lagged the map and
 * jittered. Growing it on hover put a second animation on the same property
 * and made the fight obvious.
 *
 * So the root is now a bare positioning shell with no classes that touch a
 * transform, and everything visual — the pill, the hover growth, the
 * transition — lives on a child MapLibre never touches. The standard MapLibre
 * pattern, arrived at the hard way.
 *
 * `data-selected` stays on the ROOT because that is the element the drivers
 * effect already reconciles, and the child styles off it with `group-data-*`.
 */

/** The positioning shell. MapLibre owns its transform; we own its children. */
function markerRoot(): HTMLElement {
  const element = document.createElement("div");
  // `group` is what lets the child below react to `data-selected` on this
  // element. No transform, no transition, no scale — see the note above.
  element.className = "group";
  return element;
}

/**
 * What the pickup pin says when tapped.
 *
 * Built as DOM rather than portalled through React like the driver card,
 * because it is two lines of static text with nothing to click: a portal and
 * a render pass for that would be machinery in place of a paragraph.
 *
 * `textContent`, never `innerHTML` — the second line is an ADDRESS somebody
 * typed, and the one rule about strings a customer supplied is that they
 * never become markup.
 */
function pickupPopupContent(label: string, addressLine: string | null): HTMLElement {
  const root = document.createElement("div");
  // `pr-9` reserves the close button's corner: on a one-line card the text
  // otherwise runs straight under it.
  root.className = "flex flex-col gap-0.5 p-4 pr-9";

  const title = document.createElement("p");
  title.className = "text-sm font-medium";
  title.textContent = label;
  root.appendChild(title);

  if (addressLine) {
    const address = document.createElement("p");
    address.className = "text-xs text-muted-foreground";
    address.textContent = addressLine;
    root.appendChild(address);
  }

  return root;
}

/**
 * The door: the Koolee bag, static, unmistakably not a vehicle.
 *
 * IT WAS A PLAIN NAVY DOT, which said "a place" and nothing else — on a map
 * whose entire subject is bags being collected from that place. The glyph is
 * the same sealed case the hero animation puts on the stoop
 * (`hero-route-scene.tsx`, `[data-bags]`): a rounded body, a handle, and the
 * orange seal dot that is the brand's own mark for "closed, and nobody has
 * been in it". Reused rather than redrawn, at pin scale, so the thing a
 * customer watched on the marketing page is the thing on their trip.
 *
 * THE SAME MARK AS `JourneyGlyph name="seal"`, simplified rather than
 * redrawn, and the same way round: a navy bag on white with the tag in the
 * brand's `#FF6B35`. Bag, handle, highlight, and the orange tag HANGING off
 * the side —
 * that hanging tag is the gesture the marketing glyph makes, and a dot on the
 * front of the bag (the first attempt) read as a different icon that happened
 * to share a colour. The glyph keeps its serial ticks and its grommet detail
 * because it is drawn at four times this size; a pin that tried to carry them
 * would be mud.
 *
 * SQUARE-ISH, NOT A CIRCLE, and that is deliberate against the driver pins:
 * they are rounded pills, this is a rounded square. Shape carries the
 * difference before colour does, which is what a colour-blind reader and a
 * small screen both need.
 *
 * BIGGER THAN THE VANS, also deliberately. It is the one fixed thing on the
 * map — everything else is moving relative to it — and at the size of a driver
 * pin the glyph inside was too small to read as a bag at all, which is the
 * whole reason for drawing one. 44px square is also the smallest comfortable
 * touch target, and it is now a button.
 *
 * A BUTTON, because it now says what it is when tapped. Previously
 * `aria-hidden` — a decoration. It is the anchor of the whole map, and "which
 * of these is my house" is a fair question to be able to ask it.
 */
function pickupPin(label: string): HTMLElement {
  const root = markerRoot();

  const button = document.createElement("button");
  button.type = "button";
  button.dataset.pin = "pickup";
  button.setAttribute("aria-label", label);
  button.className = [
    /*
     * WHITE GROUND, NAVY BAG, ORANGE TAG — the same way round as the
     * `seal` journey glyph on the marketing page. The first version inverted
     * it (navy ground, white bag) and read as a different icon that happened
     * to share a silhouette: the bag is a navy object, and making it the hole
     * rather than the shape is exactly the kind of difference somebody
     * notices without being able to name.
     */
    "flex size-11 cursor-pointer items-center justify-center rounded-xl border-2 border-navy-800",
    "bg-white text-navy-800 shadow-lg",
    // Only `scale`, and only on the child — see the note above `markerRoot`.
    "transition-[scale] duration-150 hover:scale-110",
    "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
  ].join(" ");

  /*
   * The bag, normalised from the hero's own coordinates onto a 24-box: body,
   * handle, the highlight across the front, and the seal. The seal is the one
   * element drawn in tag orange rather than inheriting `currentColor` — it is
   * the brand's accent and the only part of the mark that means something on
   * its own.
   */
  button.innerHTML = [
    '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" aria-hidden="true">',
    // Handle, body, highlight — the bag.
    '<path d="M8.5 8.5V6.6A2.1 2.1 0 0 1 10.6 4.5h2.3a2.1 2.1 0 0 1 2.1 2.1v1.9" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
    '<rect x="3.4" y="8.5" width="12.7" height="11.2" rx="2" fill="currentColor"/>',
    // The highlight across the front is WHITE on the navy body, as it is in
    // the glyph — a darker line would read as a seam rather than a catch of
    // light.
    '<line x1="3.4" y1="12.6" x2="16.1" y2="12.6" stroke="#FFFFFF" stroke-opacity="0.35" stroke-width="1.1"/>',
    // The tag, HANGING off the side rather than a dot on the front — the same
    // gesture the `seal` journey glyph makes, at a twentieth of the size.
    '<path d="M16.1 12.4c1.7 0 2.3.4 2.8 1.1" stroke="currentColor" stroke-opacity="0.55" stroke-width="1.1" stroke-linecap="round"/>',
    '<rect x="17.6" y="11.5" width="6.2" height="4.6" rx="1.8" fill="#FF6B35"/>',
    '<circle cx="19.3" cy="13.8" r="0.8" fill="#FFFFFF"/>',
    "</svg>",
  ].join("");

  root.appendChild(button);
  return root;
}

/** A van. Tag orange when chosen, sky otherwise — the brand's own two accents. */
function driverPin(driver: MapDriver): HTMLElement {
  const root = markerRoot();
  root.dataset.selected = driver.selected ? "true" : "false";
  // The pin sits above its own ring; both share the root's centre.
  root.classList.add("relative");

  /*
   * THE RING, and why a map needs one.
   *
   * Between updates every pin holds perfectly still, and a still map is
   * indistinguishable from a broken one — which is the exact confusion this
   * component has already cost twice. The ring says "these are live
   * positions" continuously, without claiming a frequency it cannot keep and
   * without a single extra request.
   *
   * Slow (2.8s) and low-contrast on purpose: a fast, bright pulse reads as an
   * alert, and nothing here is wrong. `motion-reduce` drops it entirely —
   * somebody who asked for less motion is not asking for a subtler version of
   * it, and the map is complete without it.
   */
  const ring = document.createElement("span");
  ring.setAttribute("aria-hidden", "true");
  ring.className = [
    "pointer-events-none absolute left-1/2 top-1/2 size-9 -translate-x-1/2 -translate-y-1/2",
    "rounded-full bg-sky-500/40 animate-pin-ping motion-reduce:hidden",
    "group-data-[selected=true]:bg-tag-500/40",
  ].join(" ");
  root.appendChild(ring);

  const button = document.createElement("button");
  button.type = "button";
  button.dataset.pin = "driver";
  button.setAttribute("aria-pressed", driver.selected ? "true" : "false");
  button.setAttribute(
    "aria-label",
    driver.label ? `Driver ${driver.label}` : "Koolee driver",
  );
  button.className = [
    // `relative` so the pill paints above the ring behind it.
    "relative flex cursor-pointer items-center gap-1 rounded-full border-2 border-white px-2 py-1",
    "text-xs font-semibold text-white shadow-lg",
    // Only `scale` transitions. NOT `transition-transform`, which would also
    // cover `transform` — the property MapLibre rewrites every frame on the
    // parent, and which a child inherits nothing of but which it is far too
    // easy to reintroduce here by habit.
    "transition-[scale] duration-150",
    "bg-sky-600 hover:scale-110",
    "group-data-[selected=true]:bg-tag-500 group-data-[selected=true]:scale-110",
    "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
  ].join(" ");
  // A truck glyph plus the driver's first name. The name is what turns four
  // identical pins into four people.
  button.innerHTML = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 17h4V5H2v12h3"/><path d="M20 17h2v-3.34a4 4 0 0 0-1.17-2.83L19 9h-5v8h1"/><circle cx="7.5" cy="17.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/></svg>`;
  if (driver.label) {
    const name = document.createElement("span");
    name.textContent = driver.label;
    button.appendChild(name);
  }

  root.appendChild(button);
  return root;
}

/**
 * Keeps a pin's selected state in step, on both elements that carry it.
 *
 * The root holds `data-selected` (what the child styles off, and what the
 * drivers effect reconciles); the button holds `aria-pressed` (what a screen
 * reader announces). One helper so the two cannot drift — they did, once,
 * when the pin was a single element and both lived on it.
 */
function setPinSelected(root: HTMLElement, selected: boolean): void {
  root.dataset.selected = selected ? "true" : "false";
  root
    .querySelector('[data-pin="driver"]')
    ?.setAttribute("aria-pressed", selected ? "true" : "false");
}
