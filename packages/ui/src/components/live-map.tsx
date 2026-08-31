"use client";

import * as React from "react";
/*
 * NAMED IMPORTS, not a default. maplibre-gl 6 ships ESM only and exports no
 * default — `import maplibregl from "maplibre-gl"` type-errors, and in a
 * bundler that papers over it you get `undefined.Map is not a function` at
 * runtime instead.
 */
import {
  LngLatBounds,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
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
  /** Accessible description of what the map is showing. */
  label: string;
}

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

export function LiveMap({
  pickup,
  drivers = [],
  onDriverClick,
  className,
  styleUrl = DEFAULT_STYLE_URL,
  label,
}: LiveMapProps) {
  const container = React.useRef<HTMLDivElement | null>(null);
  const map = React.useRef<MapLibreMap | null>(null);
  // `Map` here is MapLibre's, so the JS one needs its global name spelled out.
  const markers = React.useRef(new globalThis.Map<string, Marker>());
  const pickupMarker = React.useRef<Marker | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [ready, setReady] = React.useState(false);

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
        attributionControl: { compact: true },
      });
    } catch {
      // No WebGL, or a browser that refuses the canvas. The list below the
      // map is the whole product; this is the garnish.
      //
      // Deferred rather than set synchronously: a setState in the body of an
      // effect cascades a second render before paint. Same treatment as
      // `GpsPinger`'s unsupported branch in the agent app.
      const timer = setTimeout(() => setFailed(true), 0);
      return () => clearTimeout(timer);
    }

    instance.touchZoomRotate.disableRotation();
    instance.addControl(new NavigationControl({ showCompass: false }), "top-right");

    // The deadline above. Armed before `load` is wired so a map that never
    // starts is caught as surely as one that starts and stalls.
    const deadline = setTimeout(() => setFailed(true), LOAD_TIMEOUT_MS);
    instance.on("load", () => {
      clearTimeout(deadline);
      setReady(true);
    });
    // A tile host that is down must not leave a grey rectangle with no
    // explanation — `error` fires for style and tile failures alike. It does
    // NOT fire for a worker that will not load, which is what the deadline is
    // for.
    instance.on("error", () => setFailed(true));

    map.current = instance;

    // Captured now, not read at teardown: the lint rule is right that
    // `markers.current` may be a different object by then. It is the same
    // Map for the life of this component, but relying on that in a cleanup is
    // how the exception becomes the habit.
    const created = markers.current;

    return () => {
      clearTimeout(deadline);
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
  }, [styleUrl]);

  /* --- the door ------------------------------------------------------- */
  React.useEffect(() => {
    const instance = map.current;
    if (!instance || !ready) return;

    if (!pickupMarker.current) {
      pickupMarker.current = new Marker({ element: pickupPin() })
        .setLngLat([pickup.lng, pickup.lat])
        .addTo(instance);
    } else {
      pickupMarker.current.setLngLat([pickup.lng, pickup.lat]);
    }
  }, [pickup.lat, pickup.lng, ready]);

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
         * MOVED, NOT REPLACED. Re-creating the marker would teleport the pin
         * and drop any transition; `setLngLat` on the same element is what
         * makes a van appear to drive. The class swap keeps the selected
         * state in step without touching position.
         */
        existing.setLngLat([driver.position.lng, driver.position.lat]);
        const element = existing.getElement();
        element.dataset.selected = driver.selected ? "true" : "false";
        element.setAttribute("aria-pressed", driver.selected ? "true" : "false");
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
      marker.remove();
      markers.current.delete(id);
    }
  }, [drivers, ready]);

  /* --- framing -------------------------------------------------------- */
  React.useEffect(() => {
    const instance = map.current;
    if (!instance || !ready) return;

    if (drivers.length === 0) {
      instance.easeTo({ center: [pickup.lng, pickup.lat], zoom: SOLO_ZOOM });
      return;
    }

    const bounds = new LngLatBounds(
      [pickup.lng, pickup.lat],
      [pickup.lng, pickup.lat],
    );
    for (const driver of drivers) bounds.extend([driver.position.lng, driver.position.lat]);
    // `maxZoom` matters: a driver already outside the building would otherwise
    // frame two pins a few metres apart at street level, which is a map of
    // nothing.
    instance.fitBounds(bounds, { padding: FIT_PADDING, maxZoom: 15, duration: 600 });
  }, [drivers, pickup.lat, pickup.lng, ready]);

  if (failed) {
    // Deliberately quiet. The customer is not missing anything they need — the
    // driver list and the ETA are right below this.
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-lg border border-dashed border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground",
          className,
        )}
      >
        The map can&apos;t load right now. Everything else on this page is up to date.
      </div>
    );
  }

  return (
    <div
      ref={container}
      role="img"
      aria-label={label}
      className={cn("overflow-hidden rounded-lg border border-border bg-muted/30", className)}
    />
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

/** The door: navy, static, unmistakably not a vehicle. */
function pickupPin(): HTMLElement {
  const element = document.createElement("div");
  element.className =
    "flex size-6 items-center justify-center rounded-full border-2 border-white bg-navy-800 shadow-lg";
  element.innerHTML =
    '<span class="block size-2 rounded-full bg-white"></span>';
  element.setAttribute("aria-hidden", "true");
  return element;
}

/** A van. Tag orange when chosen, sky otherwise — the brand's own two accents. */
function driverPin(driver: MapDriver): HTMLElement {
  const element = document.createElement("button");
  element.type = "button";
  element.dataset.selected = driver.selected ? "true" : "false";
  element.setAttribute("aria-pressed", driver.selected ? "true" : "false");
  element.setAttribute(
    "aria-label",
    driver.label ? `Driver ${driver.label}` : "Koolee driver",
  );
  element.className = [
    "flex cursor-pointer items-center gap-1 rounded-full border-2 border-white px-2 py-1",
    "text-xs font-semibold text-white shadow-lg transition-transform",
    "bg-sky-600 hover:scale-110",
    "data-[selected=true]:bg-tag-500 data-[selected=true]:scale-110",
    "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
  ].join(" ");
  // A truck glyph plus the driver's first name. The name is what turns four
  // identical pins into four people.
  element.innerHTML = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 17h4V5H2v12h3"/><path d="M20 17h2v-3.34a4 4 0 0 0-1.17-2.83L19 9h-5v8h1"/><circle cx="7.5" cy="17.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/></svg>`;
  if (driver.label) {
    const name = document.createElement("span");
    name.textContent = driver.label;
    element.appendChild(name);
  }
  return element;
}
