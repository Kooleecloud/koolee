/* eslint-disable no-restricted-syntax -- this is the app's one time-formatting module, the twin of packages/core/src/slots/cutoff.ts; the same formatters, the same patterns, and the same single allowed use of Intl for the zone abbreviation. */
import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";

/**
 * Every time a driver sees is in the BOOKING's airport zone, never the
 * phone's. These mirror core's `format*InAirportTz` exactly (same patterns,
 * same "EDT" suffix from Intl) so the app and the web agree to the character.
 * Phase 4 lifts them into a shared package; until then they live here.
 */

export function zoneAbbrev(instant: Date, tz: string): string {
  const part = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" })
    .formatToParts(instant)
    .find((p) => p.type === "timeZoneName");
  return part?.value ?? "";
}

/** "Tue 10 Jun" */
export function formatDay(instant: Date, tz: string): string {
  return format(new TZDate(instant, tz), "EEE d MMM");
}

/** "Tue 10 Jun, 6:20 PM EDT" */
export function formatInstant(instant: Date, tz: string): string {
  return `${format(new TZDate(instant, tz), "EEE d MMM, h:mm a")} ${zoneAbbrev(instant, tz)}`;
}

/** "6:20 PM EDT" */
export function formatTime(instant: Date, tz: string): string {
  return `${format(new TZDate(instant, tz), "h:mm a")} ${zoneAbbrev(instant, tz)}`;
}

/** "10:00 AM" */
export function formatHour(instant: Date, tz: string): string {
  return format(new TZDate(instant, tz), "h:mm a");
}

/** "10:00 AM – 11:00 AM EDT" */
export function formatHourRange(start: Date, end: Date, tz: string): string {
  return `${format(new TZDate(start, tz), "h:mm a")} – ${format(new TZDate(end, tz), "h:mm a")} ${zoneAbbrev(end, tz)}`;
}

/** The airport-local calendar day an instant falls on, as `yyyy-MM-dd`. */
export function airportLocalDay(instant: Date, tz: string): string {
  return format(new TZDate(instant, tz), "yyyy-MM-dd");
}

/**
 * The absolute instant of an airport-local wall-clock hour. DST-correct
 * because TZDate owns the offset lookup.
 */
function airportLocalInstant(day: string, hour: number, tz: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match || !Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new RangeError(`Invalid airport-local day/hour: ${day} ${hour}`);
  }
  const [, year, month, dayOfMonth] = match.map(Number);
  return new Date(new TZDate(year!, month! - 1, dayOfMonth!, hour, 0, 0, tz).getTime());
}

/**
 * The half-open instant range covering the airport-local calendar day that
 * `instant` falls on: `[start, end)`. Ported from core's `slots/cutoff.ts`.
 *
 * Anything that buckets jobs "by day" needs this rather than
 * `setHours(0,0,0,0)`: the PHONE's zone is wherever the driver happens to be,
 * and a "today" computed from it disagrees with the airport's day the moment
 * the two differ.
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

export const FALLBACK_TZ = "America/New_York";

export function iso(value: string): Date {
  return new Date(value);
}
