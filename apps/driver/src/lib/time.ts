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

export const FALLBACK_TZ = "America/New_York";

export function iso(value: string): Date {
  return new Date(value);
}
