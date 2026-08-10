import { TZDate } from "@date-fns/tz";
import { differenceInMinutes, format, subMinutes } from "date-fns";
import type { AirlineCutoff, AirportCode, CutoffScope } from "@koolee/db";

import { CutoffUnknownError } from "../errors";

/**
 * Airline-cutoff maths and window display.
 *
 * This is the highest-liability code in the repository: windows.ts builds the
 * bookable band on the deadlines computed here, and a wrong deadline is how a
 * customer's bags miss their flight. Every function here is pure, every input
 * is an absolute instant, and the module is exercised across DST boundaries
 * by the accompanying test file.
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

/** Human day heading in airport local time — "Tue 10 Jun". */
export function formatDayInAirportTz(instant: Date, tz: string): string {
  return format(new TZDate(instant, tz), "EEE d MMM");
}

/** Day and time of a single instant, airport-local — "Tue 10 Jun, 6:20 PM". */
export function formatInstantInAirportTz(instant: Date, tz: string): string {
  return format(new TZDate(instant, tz), "EEE d MMM, h:mm a");
}

/**
 * Just the hour span, airport-local — "10:00 AM – 11:00 AM". For compact
 * window tiles under a day heading, where repeating the date is noise.
 */
export function formatHourRangeInAirportTz(
  windowStart: Date,
  windowEnd: Date,
  tz: string,
): string {
  return `${format(new TZDate(windowStart, tz), "h:mm a")} – ${format(
    new TZDate(windowEnd, tz),
    "h:mm a",
  )}`;
}

/**
 * The absolute instant of an airport-local wall-clock hour — the inverse
 * edge of `airportLocalDay`, for ops input ("block Aug 12, 2 PM at JFK").
 * DST-correct because TZDate owns the offset lookup.
 */
export function airportLocalInstant(
  day: string,
  hour: number,
  tz: string,
): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match || !Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new RangeError(`Invalid airport-local day/hour: ${day} ${hour}`);
  }
  const [, year, month, dayOfMonth] = match.map(Number);
  return new Date(
    new TZDate(year!, month! - 1, dayOfMonth!, hour, 0, 0, tz).getTime(),
  );
}

/**
 * The half-open instant range covering the airport-local calendar day that
 * `instant` falls on: `[start, end)`.
 *
 * Anything that buckets rows "by day" needs this rather than
 * `setHours(0,0,0,0)`. Server-local midnight is UTC midnight in production,
 * which slices an Eastern day at 8 or 7 PM the evening before — so a
 * "today's pickups" query and a "today" badge computed from the airport
 * timezone would disagree about the same row.
 *
 * The next day is derived by calendar arithmetic on the `yyyy-MM-dd` string,
 * not by adding 24 hours, so the DST days that are 23 or 25 hours long still
 * produce exactly one day.
 */
export function airportLocalDayBounds(
  instant: Date,
  tz: string,
): { start: Date; end: Date } {
  const day = airportLocalDay(instant, tz);
  const [year, month, dayOfMonth] = day.split("-").map(Number);
  const nextDay = new Date(Date.UTC(year!, month! - 1, dayOfMonth! + 1))
    .toISOString()
    .slice(0, 10);

  return {
    start: airportLocalInstant(day, 0, tz),
    end: airportLocalInstant(nextDay, 0, tz),
  };
}
