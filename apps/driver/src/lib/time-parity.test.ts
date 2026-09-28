import { describe, expect, it } from "vitest";
import {
  airportLocalDay as coreAirportLocalDay,
  airportLocalDayBounds as coreAirportLocalDayBounds,
  formatDayInAirportTz,
  formatHourInAirportTz,
  formatHourRangeInAirportTz,
  formatInstantInAirportTz,
  formatTimeInAirportTz,
  zoneAbbrev as coreZoneAbbrev,
} from "@koolee/core/slots";

import {
  airportLocalDay,
  airportLocalDayBounds,
  formatDay,
  formatHour,
  formatHourRange,
  formatInstant,
  formatTime,
  zoneAbbrev,
} from "./time";

/**
 * The app's time formatters are TWINS of core's, not imports — core is a
 * server package and does not ship to a phone. The web agent app renders
 * with core's; a driver moving between the two must read the same string for
 * the same instant, so this holds every twin to core's output character for
 * character. `@koolee/core/slots` is pure (date-fns only), which is why the
 * test can import it at all.
 */
const ZONES = [
  "America/New_York",
  "America/Los_Angeles",
  "Europe/London",
  "Asia/Kolkata", // a half-hour offset
  "Asia/Kathmandu", // a 45-minute one
];

const HOUR = 60 * 60 * 1000;

// Ordinary days, both US DST transitions (8 Mar and 1 Nov 2026 in New York),
// London's, and the minutes either side of an airport-local midnight.
const INSTANTS = [
  "2026-06-10T22:20:00.000Z",
  "2026-12-11T04:00:00.000Z",
  "2026-03-08T06:30:00.000Z",
  "2026-03-08T07:30:00.000Z",
  "2026-11-01T05:30:00.000Z",
  "2026-11-01T06:30:00.000Z",
  "2026-03-29T00:30:00.000Z",
  "2026-10-25T01:30:00.000Z",
  "2026-09-27T03:59:00.000Z",
  "2026-09-27T04:01:00.000Z",
].map((value) => new Date(value));

describe("time formatters match core's", () => {
  for (const tz of ZONES) {
    it(`agree in ${tz}`, () => {
      for (const instant of INSTANTS) {
        const end = new Date(instant.getTime() + HOUR);
        expect(zoneAbbrev(instant, tz)).toBe(coreZoneAbbrev(instant, tz));
        expect(formatDay(instant, tz)).toBe(formatDayInAirportTz(instant, tz));
        expect(formatInstant(instant, tz)).toBe(formatInstantInAirportTz(instant, tz));
        expect(formatTime(instant, tz)).toBe(formatTimeInAirportTz(instant, tz));
        expect(formatHour(instant, tz)).toBe(formatHourInAirportTz(instant, tz));
        expect(formatHourRange(instant, end, tz)).toBe(
          formatHourRangeInAirportTz(instant, end, tz),
        );
        expect(airportLocalDay(instant, tz)).toBe(coreAirportLocalDay(instant, tz));
        expect(airportLocalDayBounds(instant, tz)).toEqual(
          coreAirportLocalDayBounds(instant, tz),
        );
      }
    });
  }

  it("say what the screens say", () => {
    // Pinned once in words, so a change to BOTH sides still gets noticed.
    const instant = new Date("2026-06-10T22:20:00.000Z");
    expect(formatInstant(instant, "America/New_York")).toBe("Wed 10 Jun, 6:20 PM EDT");
    expect(formatTime(new Date("2026-12-11T04:00:00.000Z"), "America/New_York")).toBe(
      "11:00 PM EST",
    );
  });
});
