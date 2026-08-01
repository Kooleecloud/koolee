import { TZDate } from "@date-fns/tz";
import { differenceInMinutes, format, subMinutes } from "date-fns";
import type { AirlineCutoff, AirportCode, CutoffScope, Slot, SlotTier } from "@koolee/db";

import { CutoffUnknownError } from "../errors";

/**
 * Cutoff and slot-sellability logic.
 *
 * This is the highest-liability code in the repository. If it returns a slot it
 * should not have, a customer's bags miss their flight. Every function here is
 * pure, every input is an absolute instant, and the whole module is exercised
 * across DST boundaries by the accompanying test file.
 *
 * TIMEZONE POLICY (consistent throughout — do not mix in another approach):
 *
 *   1. All arithmetic is on absolute instants using date-fns `subMinutes` /
 *      `differenceInMinutes`. These operate on epoch milliseconds, so they are
 *      correct across DST transitions by construction. `subHours(t, 3)` on a
 *      wall-clock-shifted value is NOT, which is the bug this policy exists to
 *      prevent.
 *   2. Timezones enter only when a human needs to read a time. Those paths use
 *      `TZDate` from `@date-fns/tz` with the airport's IANA zone.
 *
 * A pickup window is sellable when the bags can be collected, driven, and
 * handed over before the airline stops accepting them:
 *
 *   latest pickup start = departure − cutoff − drive time − buffer
 */

/** Minutes of slack held back for loading, traffic variance, and queueing. */
export const DEFAULT_BUFFER_MINUTES = 30;

/** Used when a real drive-time estimate is unavailable (Maps is stubbed). */
export const DEFAULT_DRIVE_TIME_MINUTES = 60;

export interface LatestPickupStartInput {
  /** Scheduled departure, as an absolute instant. */
  departureAt: Date;
  /** Airline bag-drop cutoff, minutes before departure. */
  cutoffMinutes: number;
  /** Estimated door-to-bag-drop drive time, minutes. */
  driveTimeMinutes: number;
  /** Operational slack, minutes. */
  bufferMinutes: number;
}

/**
 * The latest instant a pickup may *begin* and still make the bag drop.
 *
 * Deliberately not clamped to "now": a caller may legitimately ask about a
 * flight in the past (reporting, backfill). Sellability filtering handles the
 * "is it still in the future" question separately.
 */
export function computeLatestPickupStart(input: LatestPickupStartInput): Date {
  const { departureAt, cutoffMinutes, driveTimeMinutes, bufferMinutes } = input;

  assertFiniteNonNegative(cutoffMinutes, "cutoffMinutes");
  assertFiniteNonNegative(driveTimeMinutes, "driveTimeMinutes");
  assertFiniteNonNegative(bufferMinutes, "bufferMinutes");

  if (Number.isNaN(departureAt.getTime())) {
    throw new RangeError("departureAt is not a valid date");
  }

  // subMinutes is epoch arithmetic — DST-correct by construction.
  return subMinutes(departureAt, cutoffMinutes + driveTimeMinutes + bufferMinutes);
}

/** The instant the airline stops accepting checked bags. */
export function computeBagDropCutoffAt(departureAt: Date, cutoffMinutes: number): Date {
  assertFiniteNonNegative(cutoffMinutes, "cutoffMinutes");
  return subMinutes(departureAt, cutoffMinutes);
}

/** Minutes remaining until the bag-drop cutoff. Negative once it has passed. */
export function minutesUntilCutoff(
  departureAt: Date,
  cutoffMinutes: number,
  now: Date,
): number {
  return differenceInMinutes(computeBagDropCutoffAt(departureAt, cutoffMinutes), now);
}

function assertFiniteNonNegative(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite`);
  if (value < 0) throw new RangeError(`${name} must be >= 0`);
}

/* ------------------------------------------------------------------ */
/* Cutoff resolution                                                   */
/* ------------------------------------------------------------------ */

export interface CutoffLookup {
  airlineIata: string;
  airportCode: AirportCode;
  scope: CutoffScope;
}

/**
 * Picks the cutoff in effect for an airline/airport/scope.
 *
 * When several rows match, the one with the latest `effective_from` that is not
 * in the future wins — that is how a cutoff change is rolled out without
 * mutating history.
 *
 * Throws rather than defaulting when nothing matches. A guessed cutoff is worse
 * than no sale: it is how bags miss flights.
 */
export function resolveCutoffMinutes(
  cutoffs: readonly AirlineCutoff[],
  lookup: CutoffLookup,
  now: Date = new Date(),
): number {
  const applicable = cutoffs
    .filter(
      (c) =>
        c.airlineIata.toUpperCase() === lookup.airlineIata.toUpperCase() &&
        c.airportCode === lookup.airportCode &&
        c.scope === lookup.scope &&
        c.effectiveFrom.getTime() <= now.getTime(),
    )
    .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime());

  const winner = applicable[0];
  if (!winner) {
    throw new CutoffUnknownError(lookup.airlineIata, lookup.airportCode, lookup.scope);
  }
  return winner.cutoffMinutesBeforeDeparture;
}

/* ------------------------------------------------------------------ */
/* Slot filtering                                                      */
/* ------------------------------------------------------------------ */

/** The slot fields sellability depends on. */
export interface SellableSlotInput {
  id: string;
  airportCode: AirportCode;
  tier: SlotTier;
  windowStart: Date;
  windowEnd: Date;
  capacity: number;
  bookedCount: number;
}

export type SellabilityReason =
  | "wrong_airport"
  | "window_in_the_past"
  | "starts_before_lead_time"
  | "misses_bag_drop_cutoff"
  | "at_capacity";

export interface SlotVerdict {
  slot: SellableSlotInput;
  sellable: boolean;
  /** Populated when `sellable` is false. */
  reason?: SellabilityReason;
}

export interface SellabilityContext {
  /** Departure airport for the booking. Slots elsewhere are never sellable. */
  airportCode: AirportCode;
  departureAt: Date;
  cutoffMinutes: number;
  driveTimeMinutes?: number;
  bufferMinutes?: number;
  /** Evaluation instant. Injected so tests are deterministic. */
  now: Date;
  /** Minimum notice before a window may start. Defaults to 0. */
  minimumLeadMinutes?: number;
}

/**
 * Classifies one slot, with the reason it was rejected.
 *
 * The load-bearing condition is `windowEnd <= latestPickupStart`: the pickup
 * must be able to *begin* at any point in the window, so the whole window has
 * to sit at or before the latest safe start. Comparing `windowStart` instead
 * would sell a 4-hour window that begins safely and ends two hours after the
 * bags needed to be moving.
 */
export function evaluateSlot(
  slot: SellableSlotInput,
  ctx: SellabilityContext,
): SlotVerdict {
  if (slot.airportCode !== ctx.airportCode) {
    return { slot, sellable: false, reason: "wrong_airport" };
  }

  if (slot.windowEnd.getTime() <= ctx.now.getTime()) {
    return { slot, sellable: false, reason: "window_in_the_past" };
  }

  const leadMinutes = ctx.minimumLeadMinutes ?? 0;
  if (leadMinutes > 0 && differenceInMinutes(slot.windowStart, ctx.now) < leadMinutes) {
    return { slot, sellable: false, reason: "starts_before_lead_time" };
  }

  // Checked before capacity on purpose: "this window cannot make your flight"
  // is the safety-critical answer, and it stays true no matter how the slot
  // fills up. "Sold out" would mask it.
  const latestPickupStart = computeLatestPickupStart({
    departureAt: ctx.departureAt,
    cutoffMinutes: ctx.cutoffMinutes,
    driveTimeMinutes: ctx.driveTimeMinutes ?? DEFAULT_DRIVE_TIME_MINUTES,
    bufferMinutes: ctx.bufferMinutes ?? DEFAULT_BUFFER_MINUTES,
  });

  if (slot.windowEnd.getTime() > latestPickupStart.getTime()) {
    return { slot, sellable: false, reason: "misses_bag_drop_cutoff" };
  }

  if (slot.bookedCount >= slot.capacity) {
    return { slot, sellable: false, reason: "at_capacity" };
  }

  return { slot, sellable: true };
}

/**
 * The only function the booking flow should call to decide what to show.
 *
 * Returns slots in chronological order. Never returns a slot whose
 * `windowEnd` exceeds the latest safe pickup start.
 */
export function filterSellableSlots<T extends SellableSlotInput>(
  slots: readonly T[],
  ctx: SellabilityContext,
): T[] {
  return slots
    .filter((slot) => evaluateSlot(slot, ctx).sellable)
    .sort((a, b) => a.windowStart.getTime() - b.windowStart.getTime());
}

/** Same filtering, but keeps the rejected slots and their reasons — for ops. */
export function explainSlotSellability(
  slots: readonly SellableSlotInput[],
  ctx: SellabilityContext,
): SlotVerdict[] {
  return slots
    .map((slot) => evaluateSlot(slot, ctx))
    .sort((a, b) => a.slot.windowStart.getTime() - b.slot.windowStart.getTime());
}

/** Narrows a database row to the shape the filters need. */
export function toSellableSlotInput(slot: Slot): SellableSlotInput {
  return {
    id: slot.id,
    airportCode: slot.airportCode,
    tier: slot.tier,
    windowStart: slot.windowStart,
    windowEnd: slot.windowEnd,
    capacity: slot.capacity,
    bookedCount: slot.bookedCount,
  };
}

/* ------------------------------------------------------------------ */
/* Display                                                             */
/* ------------------------------------------------------------------ */

/**
 * Formats a window in the airport's local time.
 *
 * The only place a timezone is applied. Everything above operates on absolute
 * instants; this converts for human consumption at the very edge.
 */
export function formatWindowInAirportTz(
  windowStart: Date,
  windowEnd: Date,
  tz: string,
): string {
  const start = new TZDate(windowStart, tz);
  const end = new TZDate(windowEnd, tz);

  const sameDay = format(start, "yyyy-MM-dd") === format(end, "yyyy-MM-dd");
  return sameDay
    ? `${format(start, "EEE d MMM, h:mm a")} – ${format(end, "h:mm a")}`
    : `${format(start, "EEE d MMM, h:mm a")} – ${format(end, "EEE d MMM, h:mm a")}`;
}

/** The airport-local calendar day an instant falls on, as `yyyy-MM-dd`. */
export function airportLocalDay(instant: Date, tz: string): string {
  return format(new TZDate(instant, tz), "yyyy-MM-dd");
}
