import type { MapDriver } from "@koolee/ui";

/**
 * The pure half of the fleet map: what the browser computes between server
 * renders, and what the tests can pin without a DOM.
 *
 * WHY THIS IS NOT IN `drivers-map.tsx`. Two reasons, both about what may be
 * imported where:
 *
 *  1. `@koolee/core`'s barrel is NOT client-safe — it reaches `@koolee/db`
 *     and then `postgres`, and marking a file that imports it `"use client"`
 *     drags a Postgres driver into the browser bundle (the trip page 500'd
 *     over exactly this; see `custody-timeline.tsx` in apps/web). So the
 *     health rule is re-stated here in two lines rather than imported, and
 *     the gap it depends on arrives as a PROP from the server page, which CAN
 *     import `POSITION_GAP_MS`. The number lives in one place; the comparison
 *     lives in two, and this file names the original.
 *  2. The admin vitest runs in `node` and this file imports nothing that
 *     needs a window, so `drivers-map.test.ts` can exercise every rule below
 *     without loading MapLibre or React.
 */

/** Same three states as core's `PositionHealth`; the type is not importable here. */
export type FleetHealth = "live" | "stale" | "silent";

/**
 * What the server sends the map: `LiveDriver` from core with `recordedAt` as
 * an ISO string, because a Date across the server/client boundary is one more
 * thing to be wrong about and a string is what the realtime payload carries
 * anyway.
 */
export interface FleetDriver {
  shiftId: string;
  staffUserId: string;
  fullName: string | null;
  truckName: string;
  bagsOnBoard: number;
  position: { lat: number; lng: number } | null;
  /** ISO 8601, or null when the phone has never reported this shift. */
  recordedAt: string | null;
}

/** A fix that arrived over the socket, newer than what the server rendered. */
export interface FleetFix {
  position: { lat: number; lng: number };
  recordedAt: string;
}

/**
 * Core's `positionHealthOf`, restated — see the header for why it is not
 * imported. `silent` is "never reported"; `stale` is "stopped reporting";
 * the boundary is strictly greater than the gap, as it is in core.
 */
export function fleetHealthOf(
  recordedAt: string | null,
  nowMs: number,
  gapMs: number,
): FleetHealth {
  const seenMs = recordedAt === null ? Number.NaN : Date.parse(recordedAt);
  if (Number.isNaN(seenMs)) return "silent";
  return nowMs - seenMs > gapMs ? "stale" : "live";
}

/** The first word of a name, or a neutral fallback for an unnamed account. */
export function givenNameOf(fullName: string | null): string {
  const first = fullName?.trim().split(/\s+/)[0];
  return first || "Driver";
}

/**
 * What the pin says. Name AND truck, because on a fleet map the van is what a
 * dispatcher is looking for as often as the person driving it.
 */
export function pinLabelOf(driver: Pick<FleetDriver, "fullName" | "truckName">): string {
  return `${givenNameOf(driver.fullName)} · ${driver.truckName}`;
}

/**
 * "last seen 3 min ago", for the popup.
 *
 * NO `toLocale*`: this renders on the server and in the browser, and the two
 * disagreeing about a locale is a hydration mismatch on a component whose
 * only job is to be quietly right. Minutes are rounded; past an hour the
 * exact figure stops changing what an operator does, which is ring the
 * driver.
 */
export function lastSeenLabel(recordedAt: string | null, nowMs: number): string {
  const seenMs = recordedAt === null ? Number.NaN : Date.parse(recordedAt);
  if (Number.isNaN(seenMs)) return "no position yet";
  const ms = Math.max(0, nowMs - seenMs);
  if (ms < 60_000) return "last seen just now";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `last seen ${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours === 1 ? "last seen 1 hr ago" : `last seen ${hours} hrs ago`;
}

/**
 * Reads a `driver_positions` change off the wire, or returns null.
 *
 * NEVER THROWS, by the same contract as every other realtime path: a payload
 * this cannot read is a wasted event, not a broken map. The columns are
 * snake_case because Realtime forwards the row as Postgres names it, not as
 * drizzle does. A DELETE has no `new` row and is ignored — the poll will drop
 * the driver when the shift closes, and a deleted position row with an open
 * shift is not a state the app writes.
 */
export function readPositionChange(
  payload: unknown,
): { staffUserId: string; fix: FleetFix } | null {
  if (typeof payload !== "object" || payload === null) return null;
  const row = (payload as { new?: unknown }).new;
  if (typeof row !== "object" || row === null) return null;
  const { staff_user_id, lat, lng, recorded_at } = row as Record<string, unknown>;
  if (typeof staff_user_id !== "string" || staff_user_id === "") return null;
  if (typeof lat !== "number" || !Number.isFinite(lat)) return null;
  if (typeof lng !== "number" || !Number.isFinite(lng)) return null;
  if (typeof recorded_at !== "string" || Number.isNaN(Date.parse(recorded_at))) {
    return null;
  }
  return {
    staffUserId: staff_user_id,
    fix: { position: { lat, lng }, recordedAt: recorded_at },
  };
}

/**
 * The server's roster with the socket's newer fixes laid over it.
 *
 * NEWER WINS, PER DRIVER. A `router.refresh()` lands a fresh roster a few
 * hundred milliseconds after the socket already moved a pin; if the roster
 * simply replaced the overlay the pin would jump BACK to the older fix and
 * forward again on the next event. Comparing `recordedAt` — the device's
 * clock, the same field core's upsert orders on — keeps the pin where the
 * latest fix put it whichever path delivered it.
 *
 * A fix for a user who is not on the roster is ignored: the subscription is
 * filtered per open shift, so this only happens in the window between a shift
 * ending and the roster refreshing, and drawing that driver would resurrect a
 * pin the server has already retired.
 */
export function mergeFixes(
  roster: readonly FleetDriver[],
  fixes: ReadonlyMap<string, FleetFix>,
): FleetDriver[] {
  return roster.map((driver) => {
    const fix = fixes.get(driver.staffUserId);
    if (!fix) return driver;
    const rendered =
      driver.recordedAt === null ? -Infinity : Date.parse(driver.recordedAt);
    if (Date.parse(fix.recordedAt) <= rendered) return driver;
    return { ...driver, position: fix.position, recordedAt: fix.recordedAt };
  });
}

/**
 * Pins for the map. A driver without a position gets no pin — drawing a van
 * at an invented coordinate is worse than the legend's "no position" count.
 * The id is the SHIFT id, which is what `LiveMap` reconciles markers by: a
 * different key per render would tear every pin down and re-add it, which is
 * the difference between a van that drives and one that blinks.
 */
export function toMapDrivers(
  drivers: readonly FleetDriver[],
  nowMs: number,
  gapMs: number,
  selectedShiftId: string | null,
): MapDriver[] {
  const pins: MapDriver[] = [];
  for (const driver of drivers) {
    if (driver.position === null) continue;
    pins.push({
      id: driver.shiftId,
      position: driver.position,
      label: pinLabelOf(driver),
      selected: driver.shiftId === selectedShiftId,
      variant:
        fleetHealthOf(driver.recordedAt, nowMs, gapMs) === "live" ? "live" : "stale",
    });
  }
  return pins;
}

export interface FleetCounts {
  live: number;
  stale: number;
  silent: number;
}

/** The legend's three numbers. */
export function countByHealth(
  drivers: readonly FleetDriver[],
  nowMs: number,
  gapMs: number,
): FleetCounts {
  const counts: FleetCounts = { live: 0, stale: 0, silent: 0 };
  for (const driver of drivers)
    counts[fleetHealthOf(driver.recordedAt, nowMs, gapMs)] += 1;
  return counts;
}
