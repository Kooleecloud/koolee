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

/**
 * The strictest cutoff on record for an airline/airport, across BOTH scopes.
 *
 * Bookings do not store domestic vs international — the ticket extractor
 * derives a scope at quote time and nothing persists it — so a booking read
 * back later matches cutoff rows for both. Guessing one is the bug this
 * function exists to remove: `cutoffRiskMonitor` assumed `domestic` for every
 * booking, which is the LOOSER of the two at Koolee's seeded values (45 vs 60
 * minutes) and therefore quietly under-alerted on exactly the flights whose
 * bags are hardest to re-cut.
 *
 * Strictest means the LARGEST minutes-before-departure: a deadline that runs
 * early costs the customer nothing, one that runs late puts bags on the wrong
 * side of the counter. Same rule, same words, as `getBookingDetail`.
 *
 * Throws `CutoffUnknownError` when neither scope has a row, for the same
 * reason `resolveCutoffMinutes` does.
 */
export function resolveStrictestCutoffMinutes(
  cutoffs: readonly AirlineCutoff[],
  lookup: Omit<CutoffLookup, "scope">,
  now: Date = new Date(),
): number {
  const minutes = cutoffs
    .filter(
      (c) =>
        c.airlineIata.toUpperCase() === lookup.airlineIata.toUpperCase() &&
        c.airportCode === lookup.airportCode &&
        c.effectiveFrom.getTime() <= now.getTime(),
    )
    .map((c) => c.cutoffMinutesBeforeDeparture);

  if (minutes.length === 0) {
    throw new CutoffUnknownError(lookup.airlineIata, lookup.airportCode, "any scope");
  }
  return Math.max(...minutes);
}

/* ------------------------------------------------------------------ */
/* Display                                                             */
/* ------------------------------------------------------------------ */

/**
 * ZONE LABELLING (why every formatter below ends in an abbreviation).
 *
 * A booking is read by three people in three places: the customer who buys
 * the window, the agent who shows up for it, and the dispatcher who plans
 * around it. They all read the SAME string, rendered in the booking's zone —
 * never the viewer's. That guarantee is worthless if the string doesn't say
 * which zone it is: "10:00 AM" is read as local by a customer booking from
 * London, and they will be out when the driver arrives.
 *
 * The abbreviation comes from `Intl`, not date-fns. date-fns' `zzz` token on a
 * TZDate emits the OFFSET ("GMT-5"), not the name ("EST") — verified, and
 * "GMT-5" is worse than nothing for a customer. `Intl` is therefore allowed in
 * this module and banned everywhere else (see the lint rule in eslint.config).
 */

/** Milliseconds in an hour — DST detection compares adjacent wall-clock hours. */
const HOUR_MS = 60 * 60 * 1000;

/**
 * The zone's short name at a given instant — "EST" in January, "EDT" in July.
 *
 * Instant-dependent by necessity: the same zone has two names a year, and
 * which one applies is exactly what disambiguates the repeated hour below.
 */
export function zoneAbbrev(instant: Date, tz: string): string {
  const part = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    timeZoneName: "short",
  })
    .formatToParts(instant)
    .find((p) => p.type === "timeZoneName");
  // Intl always emits the part for a valid zone; the fallback keeps a label
  // bug from becoming a thrown exception on a booking page.
  return part?.value ?? "";
}

/** `yyyy-MM-dd HH` in the given zone — the identity of one wall-clock hour. */
function wallHourKey(instant: Date, tz: string): string {
  return format(new TZDate(instant, tz), "yyyy-MM-dd HH");
}

/**
 * Plain-language warning for the two nights a year a wall-clock label lies.
 *
 * Koolee sells windows 24/7/365, so both DST edge cases are inventory we
 * actually take money for:
 *
 *   - fall back: two distinct one-hour windows both render "1:00 AM – 2:00 AM".
 *     `EDT`/`EST` technically separates them, but no customer reads it that
 *     way, so we say it in words.
 *   - spring forward: the 2 AM hour does not exist, so the picker shows a jump
 *     from 1 AM to 3 AM. Nothing is missing — but an unexplained gap reads as
 *     a bug, and support pays for it.
 *
 * Detection is by observation, not offset arithmetic: if the next hour carries
 * the same wall-clock label, this is the first of the pair; if the previous
 * hour does, this is the second. That works in any zone, including the
 * half-hour and 45-minute ones, with no table of transition dates to
 * maintain.
 *
 * Returns null on all the ordinary days, which is 363 of them.
 */
export function dstTransitionNote(windowStart: Date, tz: string): string | null {
  const here = wallHourKey(windowStart, tz);
  const prev = wallHourKey(new Date(windowStart.getTime() - HOUR_MS), tz);
  const next = wallHourKey(new Date(windowStart.getTime() + HOUR_MS), tz);

  if (here === next) return "first of two — clocks go back during this hour";
  if (here === prev) return "second of two — clocks have already gone back";

  // Wall clock skipped an hour between the previous window and this one: the
  // hour in between was never lived through.
  const hourOf = (key: string) => Number(key.slice(-2));
  const skipped = (hourOf(here) - hourOf(prev) + 24) % 24;
  if (skipped === 2) return "clocks go forward — there is no earlier hour tonight";

  return null;
}

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

  // The END's abbreviation, not the start's: a window that straddles the
  // transition is handed over after the clocks change, and the handover time
  // is the one the agent and customer have to agree on.
  const zone = zoneAbbrev(windowEnd, tz);
  const sameDay = format(start, "yyyy-MM-dd") === format(end, "yyyy-MM-dd");
  return sameDay
    ? `${format(start, "EEE d MMM, h:mm a")} – ${format(end, "h:mm a")} ${zone}`
    : `${format(start, "EEE d MMM, h:mm a")} – ${format(end, "EEE d MMM, h:mm a")} ${zone}`;
}

/** The airport-local calendar day an instant falls on, as `yyyy-MM-dd`. */
export function airportLocalDay(instant: Date, tz: string): string {
  return format(new TZDate(instant, tz), "yyyy-MM-dd");
}

/** Human day heading in airport local time — "Tue 10 Jun". */
export function formatDayInAirportTz(instant: Date, tz: string): string {
  return format(new TZDate(instant, tz), "EEE d MMM");
}

/**
 * Day and time of a single instant, airport-local — "Tue 10 Jun, 6:20 PM EDT".
 */
export function formatInstantInAirportTz(instant: Date, tz: string): string {
  return `${format(new TZDate(instant, tz), "EEE d MMM, h:mm a")} ${zoneAbbrev(instant, tz)}`;
}

/**
 * Just the clock time, airport-local — "6:20 PM EDT".
 *
 * For stacked table cells that put the time on the first line and the date
 * underneath: an operator scanning a board reads the hour first and only needs
 * the day to disambiguate. The zone stays on the time, never on the date line,
 * because the zone qualifies the clock.
 */
export function formatTimeInAirportTz(instant: Date, tz: string): string {
  return `${format(new TZDate(instant, tz), "h:mm a")} ${zoneAbbrev(instant, tz)}`;
}

/**
 * Just the hour span, airport-local — "10:00 AM – 11:00 AM EDT". For compact
 * window tiles under a day heading, where repeating the date is noise.
 *
 * The zone still is not noise: these tiles are what a customer picks from and
 * what an agent reads at the door.
 */
export function formatHourRangeInAirportTz(
  windowStart: Date,
  windowEnd: Date,
  tz: string,
): string {
  return `${format(new TZDate(windowStart, tz), "h:mm a")} – ${format(
    new TZDate(windowEnd, tz),
    "h:mm a",
  )} ${zoneAbbrev(windowEnd, tz)}`;
}

/**
 * Just the start hour, airport-local and unqualified — "10:00 AM".
 *
 * For the customer-facing window grid, where the zone is stated once above the
 * tiles ("all times are local") instead of on every tile. Anywhere the zone is
 * NOT stated nearby — ops boards, emails, agent screens — use
 * `formatTimeInAirportTz` instead, which carries it.
 */
export function formatHourInAirportTz(instant: Date, tz: string): string {
  return format(new TZDate(instant, tz), "h:mm a");
}

/**
 * `yyyy-MM-ddTHH:mm` in the airport's zone — the value format an
 * `<input type="datetime-local">` expects.
 *
 * A datetime-local input has no zone of its own: it round-trips whatever wall
 * clock you hand it. Feeding it a system-zone render means a customer reopens
 * the flight step and finds their 6 PM departure showing as 22:00.
 */
export function formatDateTimeLocalInAirportTz(instant: Date, tz: string): string {
  return format(new TZDate(instant, tz), "yyyy-MM-dd'T'HH:mm");
}

/**
 * The absolute instant of a `yyyy-MM-ddTHH:mm` wall clock READ AT AN AIRPORT
 * — the exact inverse of `formatDateTimeLocalInAirportTz`, and the only
 * correct way to turn a `datetime-local` form value into a stored instant.
 *
 * `new Date("2026-09-01T18:30")` looks like it does this and does not: with no
 * zone in the string, the runtime applies the SERVER's. In production that is
 * UTC, so a customer's 6:30 PM departure out of JFK was being stored as
 * 18:30Z and read back as 2:30 PM — four hours of drift through every cutoff
 * and every bookable window derived from it.
 */
export function airportLocalDateTime(local: string, tz: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!match) {
    throw new RangeError(`Invalid airport-local date-time: ${local}`);
  }
  const [, year, month, day, hour, minute] = match.map(Number);
  const instant = new Date(
    new TZDate(year!, month! - 1, day!, hour!, minute!, 0, tz).getTime(),
  );
  if (Number.isNaN(instant.getTime())) {
    throw new RangeError(`Invalid airport-local date-time: ${local}`);
  }
  return instant;
}

/**
 * The absolute instant of an airport-local wall-clock hour — the inverse
 * edge of `airportLocalDay`, for ops input ("block Aug 12, 2 PM at JFK").
 * DST-correct because TZDate owns the offset lookup.
 */
export function airportLocalInstant(day: string, hour: number, tz: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match || !Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new RangeError(`Invalid airport-local day/hour: ${day} ${hour}`);
  }
  const [, year, month, dayOfMonth] = match.map(Number);
  return new Date(new TZDate(year!, month! - 1, dayOfMonth!, hour, 0, 0, tz).getTime());
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
