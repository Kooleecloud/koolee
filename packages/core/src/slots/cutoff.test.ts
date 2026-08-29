import { TZDate } from "@date-fns/tz";
import { describe, expect, it } from "vitest";
import type { AirlineCutoff, AirportCode } from "@koolee/db";

import { CutoffUnknownError } from "../errors";
import {
  airportLocalDay,
  airportLocalDayBounds,
  airportLocalDateTime,
  airportLocalInstant,
  computeBagDropCutoffAt,
  computeLatestPickupStart,
  dstTransitionNote,
  formatDateTimeLocalInAirportTz,
  formatDayInAirportTz,
  formatHourRangeInAirportTz,
  formatWindowInAirportTz,
  minutesUntilCutoff,
  resolveCutoffMinutes,
  resolveStrictestCutoffMinutes,
  zoneAbbrev,
} from "./cutoff";

const NY = "America/New_York";
const MINUTE = 60_000;

/** Builds an instant from a New York wall-clock time. */
const ny = (iso: string): Date => new Date(new TZDate(...tzParts(iso), NY).getTime());

function tzParts(iso: string): [number, number, number, number, number] {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(iso);
  if (!match) throw new Error(`bad test date: ${iso}`);
  const [, y, mo, d, h, mi] = match;
  return [Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi)];
}

/* ================================================================== */
/* computeLatestPickupStart                                            */
/* ================================================================== */

describe("computeLatestPickupStart", () => {
  it("subtracts cutoff + drive + buffer from departure", () => {
    const result = computeLatestPickupStart({
      departureAt: new Date("2025-06-10T22:00:00Z"),
      cutoffMinutes: 45,
      driveTimeMinutes: 60,
      bufferMinutes: 30,
    });
    // 22:00 − 135m = 19:45Z
    expect(result.toISOString()).toBe("2025-06-10T19:45:00.000Z");
  });

  it("is exactly departure when every component is zero", () => {
    const departureAt = new Date("2025-06-10T22:00:00Z");
    expect(
      computeLatestPickupStart({
        departureAt,
        cutoffMinutes: 0,
        driveTimeMinutes: 0,
        bufferMinutes: 0,
      }).getTime(),
    ).toBe(departureAt.getTime());
  });

  it("is linear in each component", () => {
    const base = {
      departureAt: new Date("2025-06-10T22:00:00Z"),
      cutoffMinutes: 45,
      driveTimeMinutes: 60,
      bufferMinutes: 30,
    };
    const baseline = computeLatestPickupStart(base).getTime();

    expect(computeLatestPickupStart({ ...base, cutoffMinutes: 55 }).getTime()).toBe(
      baseline - 10 * MINUTE,
    );
    expect(computeLatestPickupStart({ ...base, driveTimeMinutes: 70 }).getTime()).toBe(
      baseline - 10 * MINUTE,
    );
    expect(computeLatestPickupStart({ ...base, bufferMinutes: 40 }).getTime()).toBe(
      baseline - 10 * MINUTE,
    );
  });

  it("handles a total that runs past midnight into the previous day", () => {
    const result = computeLatestPickupStart({
      departureAt: new Date("2025-06-10T01:00:00Z"),
      cutoffMinutes: 60,
      driveTimeMinutes: 90,
      bufferMinutes: 30,
    });
    expect(result.toISOString()).toBe("2025-06-09T22:00:00.000Z");
  });

  it("rejects negative or non-finite inputs rather than silently inverting", () => {
    const base = {
      departureAt: new Date("2025-06-10T22:00:00Z"),
      cutoffMinutes: 45,
      driveTimeMinutes: 60,
      bufferMinutes: 30,
    };
    expect(() => computeLatestPickupStart({ ...base, cutoffMinutes: -1 })).toThrow(
      RangeError,
    );
    expect(() => computeLatestPickupStart({ ...base, driveTimeMinutes: -1 })).toThrow(
      RangeError,
    );
    expect(() => computeLatestPickupStart({ ...base, bufferMinutes: -1 })).toThrow(
      RangeError,
    );
    expect(() => computeLatestPickupStart({ ...base, cutoffMinutes: NaN })).toThrow(
      RangeError,
    );
    expect(() =>
      computeLatestPickupStart({ ...base, driveTimeMinutes: Infinity }),
    ).toThrow(RangeError);
  });

  it("rejects an invalid departure date", () => {
    expect(() =>
      computeLatestPickupStart({
        departureAt: new Date("nonsense"),
        cutoffMinutes: 45,
        driveTimeMinutes: 60,
        bufferMinutes: 30,
      }),
    ).toThrow(RangeError);
  });
});

/* ================================================================== */
/* DST                                                                 */
/* ================================================================== */

describe("DST boundaries (America/New_York)", () => {
  /**
   * 2025-03-09: clocks jump 02:00 → 03:00. The 02:00 hour does not exist.
   * 2025-11-02: clocks fall 02:00 → 01:00. The 01:00 hour happens twice.
   *
   * The property under test is that subtracting N minutes always moves exactly
   * N * 60_000 ms, regardless of what the local wall clock does. Wall-clock
   * arithmetic would be off by an hour in both directions here — and it would
   * be off in the *unsafe* direction on spring-forward, handing back a pickup
   * start an hour later than is actually safe.
   */

  it("spring forward: subtraction stays absolute across the skipped hour", () => {
    const departureAt = ny("2025-03-09T06:00"); // 06:00 EDT
    const result = computeLatestPickupStart({
      departureAt,
      cutoffMinutes: 60,
      driveTimeMinutes: 120,
      bufferMinutes: 30,
    });

    expect(departureAt.getTime() - result.getTime()).toBe(210 * MINUTE);
    // 06:00 EDT is 10:00Z; minus 3h30m is 06:30Z, which is 01:30 EST — before
    // the jump. The wall clock moved 4h30m; the instant moved 3h30m.
    expect(result.toISOString()).toBe("2025-03-09T06:30:00.000Z");
    expect(formatWindowInAirportTz(result, result, NY)).toContain("1:30 AM");
  });

  it("fall back: subtraction stays absolute across the repeated hour", () => {
    const departureAt = ny("2025-11-02T05:00"); // 05:00 EST
    const result = computeLatestPickupStart({
      departureAt,
      cutoffMinutes: 60,
      driveTimeMinutes: 120,
      bufferMinutes: 30,
    });

    expect(departureAt.getTime() - result.getTime()).toBe(210 * MINUTE);
    // 05:00 EST is 10:00Z; minus 3h30m is 06:30Z, which is 02:30 EDT — the
    // wall clock only moved 2h30m because an hour was repeated.
    expect(result.toISOString()).toBe("2025-11-02T06:30:00.000Z");
  });

  it("reports the airport-local day correctly either side of the transition", () => {
    expect(airportLocalDay(new Date("2025-03-09T06:30:00Z"), NY)).toBe("2025-03-09");
    // 03:30Z on 9 Mar is 22:30 on 8 Mar in New York.
    expect(airportLocalDay(new Date("2025-03-09T03:30:00Z"), NY)).toBe("2025-03-08");
  });
});

/* ================================================================== */
/* cutoff resolution                                                   */
/* ================================================================== */

describe("resolveCutoffMinutes", () => {
  const cutoff = (over: Partial<AirlineCutoff>): AirlineCutoff =>
    ({
      id: "c-1",
      airlineIata: "DL",
      airportCode: "JFK" as AirportCode,
      scope: "domestic",
      cutoffMinutesBeforeDeparture: 45,
      source: null,
      effectiveFrom: new Date("2024-01-01T00:00:00Z"),
      createdAt: new Date("2024-01-01T00:00:00Z"),
      ...over,
    }) as AirlineCutoff;

  const now = new Date("2025-06-01T00:00:00Z");

  it("finds an exact match", () => {
    expect(
      resolveCutoffMinutes(
        [cutoff({})],
        {
          airlineIata: "DL",
          airportCode: "JFK",
          scope: "domestic",
        },
        now,
      ),
    ).toBe(45);
  });

  it("matches the airline code case-insensitively", () => {
    expect(
      resolveCutoffMinutes(
        [cutoff({ airlineIata: "dl" })],
        {
          airlineIata: "DL",
          airportCode: "JFK",
          scope: "domestic",
        },
        now,
      ),
    ).toBe(45);
  });

  it("keeps domestic and international separate", () => {
    const rows = [
      cutoff({ id: "dom", scope: "domestic", cutoffMinutesBeforeDeparture: 45 }),
      cutoff({ id: "intl", scope: "international", cutoffMinutesBeforeDeparture: 60 }),
    ];

    expect(
      resolveCutoffMinutes(
        rows,
        {
          airlineIata: "DL",
          airportCode: "JFK",
          scope: "domestic",
        },
        now,
      ),
    ).toBe(45);
    expect(
      resolveCutoffMinutes(
        rows,
        {
          airlineIata: "DL",
          airportCode: "JFK",
          scope: "international",
        },
        now,
      ),
    ).toBe(60);
  });

  it("keeps airports separate", () => {
    const rows = [
      cutoff({ id: "jfk", airportCode: "JFK", cutoffMinutesBeforeDeparture: 45 }),
      cutoff({ id: "ewr", airportCode: "EWR", cutoffMinutesBeforeDeparture: 75 }),
    ];
    expect(
      resolveCutoffMinutes(
        rows,
        {
          airlineIata: "DL",
          airportCode: "EWR",
          scope: "domestic",
        },
        now,
      ),
    ).toBe(75);
  });

  it("prefers the most recent effective_from that is already in effect", () => {
    const rows = [
      cutoff({
        id: "old",
        cutoffMinutesBeforeDeparture: 45,
        effectiveFrom: new Date("2024-01-01T00:00:00Z"),
      }),
      cutoff({
        id: "new",
        cutoffMinutesBeforeDeparture: 90,
        effectiveFrom: new Date("2025-01-01T00:00:00Z"),
      }),
    ];
    expect(
      resolveCutoffMinutes(
        rows,
        {
          airlineIata: "DL",
          airportCode: "JFK",
          scope: "domestic",
        },
        now,
      ),
    ).toBe(90);
  });

  it("ignores a future effective_from", () => {
    const rows = [
      cutoff({ id: "current", cutoffMinutesBeforeDeparture: 45 }),
      cutoff({
        id: "future",
        cutoffMinutesBeforeDeparture: 120,
        effectiveFrom: new Date("2026-01-01T00:00:00Z"),
      }),
    ];
    expect(
      resolveCutoffMinutes(
        rows,
        {
          airlineIata: "DL",
          airportCode: "JFK",
          scope: "domestic",
        },
        now,
      ),
    ).toBe(45);
  });

  it("throws rather than guessing when nothing matches", () => {
    expect(() =>
      resolveCutoffMinutes(
        [cutoff({})],
        {
          airlineIata: "B6",
          airportCode: "JFK",
          scope: "domestic",
        },
        now,
      ),
    ).toThrow(CutoffUnknownError);

    expect(() =>
      resolveCutoffMinutes(
        [],
        {
          airlineIata: "DL",
          airportCode: "JFK",
          scope: "domestic",
        },
        now,
      ),
    ).toThrow(CutoffUnknownError);
  });
});

/* ================================================================== */
/* sellability                                                         */
/* ================================================================== */


describe("computeBagDropCutoffAt / minutesUntilCutoff", () => {
  it("returns the instant the airline stops accepting bags", () => {
    expect(
      computeBagDropCutoffAt(new Date("2025-06-10T22:00:00Z"), 45).toISOString(),
    ).toBe("2025-06-10T21:15:00.000Z");
  });

  it("counts down and then goes negative", () => {
    const departureAt = new Date("2025-06-10T22:00:00Z");
    expect(minutesUntilCutoff(departureAt, 45, new Date("2025-06-10T20:15:00Z"))).toBe(
      60,
    );
    expect(minutesUntilCutoff(departureAt, 45, new Date("2025-06-10T21:15:00Z"))).toBe(0);
    expect(minutesUntilCutoff(departureAt, 45, new Date("2025-06-10T21:45:00Z"))).toBe(
      -30,
    );
  });
});

describe("formatWindowInAirportTz", () => {
  it("renders a same-day window compactly, in airport local time", () => {
    const text = formatWindowInAirportTz(
      new Date("2025-06-10T14:00:00Z"), // 10:00 EDT
      new Date("2025-06-10T18:00:00Z"), // 14:00 EDT
      NY,
    );
    expect(text).toBe("Tue 10 Jun, 10:00 AM – 2:00 PM EDT");
  });

  it("spells out both dates when the window crosses local midnight", () => {
    const text = formatWindowInAirportTz(
      new Date("2025-06-11T02:00:00Z"), // 22:00 EDT on 10 Jun
      new Date("2025-06-11T06:00:00Z"), // 02:00 EDT on 11 Jun
      NY,
    );
    expect(text).toBe("Tue 10 Jun, 10:00 PM – Wed 11 Jun, 2:00 AM EDT");
  });

  it("formatDayInAirportTz gives the local day heading", () => {
    expect(formatDayInAirportTz(new Date("2025-06-11T02:00:00Z"), NY)).toBe(
      "Tue 10 Jun", // 22:00 EDT the previous local day
    );
  });

  it("formatHourRangeInAirportTz gives just the local hour span", () => {
    expect(
      formatHourRangeInAirportTz(
        new Date("2025-06-10T14:00:00Z"),
        new Date("2025-06-10T15:00:00Z"),
        NY,
      ),
    ).toBe("10:00 AM – 11:00 AM EDT");
  });

  /*
   * The zone label is the whole point of the suffix: without it a customer
   * booking from another zone reads a bare "10:00 AM" as their own.
   */
  it("names the zone, and names it differently across the DST boundary", () => {
    expect(zoneAbbrev(new Date("2025-01-15T15:00:00Z"), NY)).toBe("EST");
    expect(zoneAbbrev(new Date("2025-07-15T15:00:00Z"), NY)).toBe("EDT");
  });

  it("labels a window by the zone in force at HAND-OVER, not at the start", () => {
    // 1:30 AM EDT → 1:30 AM EST: the window straddles the fall-back, and the
    // agent and customer have to agree on the end of it.
    expect(
      formatHourRangeInAirportTz(
        new Date("2025-11-02T05:30:00Z"),
        new Date("2025-11-02T06:30:00Z"),
        NY,
      ),
    ).toBe("1:30 AM – 1:30 AM EST");
  });
});

/*
 * Koolee sells windows 24/7/365, so both DST edges are inventory that gets
 * paid for — not edge cases we can decline to render.
 */
describe("dstTransitionNote", () => {
  it("says nothing on the 363 ordinary days", () => {
    expect(dstTransitionNote(new Date("2025-06-10T14:00:00Z"), NY)).toBeNull();
    expect(dstTransitionNote(new Date("2025-01-15T15:00:00Z"), NY)).toBeNull();
  });

  it("separates the two 1 AM windows on fall-back night", () => {
    // Both of these render "1:00 AM – 2:00 AM". They are different hours.
    const firstOneAm = new Date("2025-11-02T05:00:00Z"); // 1 AM EDT
    const secondOneAm = new Date("2025-11-02T06:00:00Z"); // 1 AM EST

    expect(formatHourRangeInAirportTz(firstOneAm, secondOneAm, NY)).toContain("1:00 AM");
    expect(dstTransitionNote(firstOneAm, NY)).toBe(
      "first of two — clocks go back during this hour",
    );
    expect(dstTransitionNote(secondOneAm, NY)).toBe(
      "second of two — clocks have already gone back",
    );
  });

  it("explains the missing hour on spring-forward night", () => {
    // 07:00Z is 3 AM EDT; the window before it ended at 1 AM EST. No 2 AM
    // exists, so the picker shows a jump that would otherwise read as a bug.
    expect(dstTransitionNote(new Date("2025-03-09T07:00:00Z"), NY)).toBe(
      "clocks go forward — there is no earlier hour tonight",
    );
  });

  it("holds for a zone that transitions on other dates", () => {
    // Europe/London falls back a week earlier than New York — the detector
    // reads the zone rather than a table of US dates.
    // London goes back at 02:00 BST = 01:00 UTC, so 00:00Z is the first 1 AM
    // (BST) and 01:00Z is the second (GMT).
    expect(dstTransitionNote(new Date("2025-10-26T00:00:00Z"), "Europe/London")).toBe(
      "first of two — clocks go back during this hour",
    );
    expect(dstTransitionNote(new Date("2025-10-26T01:00:00Z"), "Europe/London")).toBe(
      "second of two — clocks have already gone back",
    );
    expect(dstTransitionNote(new Date("2025-11-02T05:00:00Z"), "Europe/London")).toBeNull();
  });
});

/* ================================================================== */
/* airportLocalDateTime                                                */
/* ================================================================== */

describe("airportLocalDateTime", () => {
  it("reads a datetime-local value in the AIRPORT's zone, not the server's", () => {
    // The bug this exists to prevent: `new Date("2026-09-01T18:30")` uses the
    // server zone, which is UTC in production — a 6:30 PM JFK departure was
    // being stored as 18:30Z and read back four hours early.
    expect(airportLocalDateTime("2026-09-01T18:30", NY).toISOString()).toBe(
      "2026-09-01T22:30:00.000Z",
    );
  });

  it("round-trips formatDateTimeLocalInAirportTz", () => {
    const local = "2025-12-24T06:05";
    expect(formatDateTimeLocalInAirportTz(airportLocalDateTime(local, NY), NY)).toBe(local);
  });

  it("is DST-correct on both sides of the change", () => {
    // EST (UTC-5) in January, EDT (UTC-4) in July.
    expect(airportLocalDateTime("2026-01-15T12:00", NY).toISOString()).toBe(
      "2026-01-15T17:00:00.000Z",
    );
    expect(airportLocalDateTime("2026-07-15T12:00", NY).toISOString()).toBe(
      "2026-07-15T16:00:00.000Z",
    );
  });

  it("throws on anything that is not a datetime-local value", () => {
    expect(() => airportLocalDateTime("2026-09-01", NY)).toThrow(RangeError);
    expect(() => airportLocalDateTime("tomorrow", NY)).toThrow(RangeError);
  });
});

/* ================================================================== */
/* airportLocalInstant                                                 */
/* ================================================================== */

describe("airportLocalInstant", () => {
  it("is the inverse of airportLocalDay at the display edge", () => {
    const instant = airportLocalInstant("2025-06-10", 14, NY);
    expect(instant.toISOString()).toBe("2025-06-10T18:00:00.000Z"); // 14:00 EDT
    expect(airportLocalDay(instant, NY)).toBe("2025-06-10");
  });

  it("uses the correct offset on either side of a DST transition", () => {
    // 9 Mar 2025: EST before the jump, EDT after.
    expect(airportLocalInstant("2025-03-09", 1, NY).toISOString()).toBe(
      "2025-03-09T06:00:00.000Z", // 01:00 EST
    );
    expect(airportLocalInstant("2025-03-09", 5, NY).toISOString()).toBe(
      "2025-03-09T09:00:00.000Z", // 05:00 EDT
    );
  });

  it("rejects malformed days and out-of-range hours", () => {
    expect(() => airportLocalInstant("2025-6-10", 9, NY)).toThrow(RangeError);
    expect(() => airportLocalInstant("2025-06-10", 24, NY)).toThrow(RangeError);
    expect(() => airportLocalInstant("2025-06-10", -1, NY)).toThrow(RangeError);
  });
});

/* ================================================================== */
/* airportLocalDayBounds                                               */
/* ================================================================== */

describe("airportLocalDayBounds", () => {
  it("brackets the airport-local day, not the server's", () => {
    // 20:30 EDT on 10 Jun is already 11 Jun in UTC — the bounds must still be
    // the 10th, which is the whole point of the helper.
    const lateEvening = new Date("2025-06-11T00:30:00.000Z");
    const { start, end } = airportLocalDayBounds(lateEvening, NY);

    expect(start.toISOString()).toBe("2025-06-10T04:00:00.000Z"); // 00:00 EDT
    expect(end.toISOString()).toBe("2025-06-11T04:00:00.000Z");
    expect(airportLocalDay(start, NY)).toBe("2025-06-10");
  });

  it("is half-open, so midnight belongs to exactly one day", () => {
    const day = airportLocalDayBounds(new Date("2025-06-10T16:00:00.000Z"), NY);
    const next = airportLocalDayBounds(new Date("2025-06-11T16:00:00.000Z"), NY);
    expect(day.end.getTime()).toBe(next.start.getTime());
  });

  it("spans 23 hours on the spring-forward day and 25 on the fall-back day", () => {
    const hours = (d: { start: Date; end: Date }) =>
      (d.end.getTime() - d.start.getTime()) / 3_600_000;

    // 9 Mar 2025 loses an hour; 2 Nov 2025 gains one. Adding 24h would put
    // both boundaries in the wrong place.
    expect(hours(airportLocalDayBounds(new Date("2025-03-09T17:00:00.000Z"), NY))).toBe(23);
    expect(hours(airportLocalDayBounds(new Date("2025-11-02T17:00:00.000Z"), NY))).toBe(25);
  });

  it("rolls over month and year ends", () => {
    const newYearEve = airportLocalDayBounds(new Date("2025-12-31T17:00:00.000Z"), NY);
    expect(airportLocalDay(newYearEve.start, NY)).toBe("2025-12-31");
    expect(newYearEve.end.toISOString()).toBe("2026-01-01T05:00:00.000Z"); // 00:00 EST
  });
});

describe("resolveStrictestCutoffMinutes", () => {
  const cutoff = (over: Partial<AirlineCutoff>): AirlineCutoff =>
    ({
      id: "c-1",
      airlineIata: "DL",
      airportCode: "JFK" as AirportCode,
      scope: "domestic",
      cutoffMinutesBeforeDeparture: 45,
      source: null,
      effectiveFrom: new Date("2024-01-01T00:00:00Z"),
      createdAt: new Date("2024-01-01T00:00:00Z"),
      ...over,
    }) as AirlineCutoff;

  const now = new Date("2025-06-01T00:00:00Z");
  const lookup = { airlineIata: "DL", airportCode: "JFK" as AirportCode };

  it("takes the larger of the two scopes — the earlier deadline", () => {
    const rows = [
      cutoff({ id: "dom", scope: "domestic", cutoffMinutesBeforeDeparture: 45 }),
      cutoff({ id: "intl", scope: "international", cutoffMinutesBeforeDeparture: 60 }),
    ];
    expect(resolveStrictestCutoffMinutes(rows, lookup, now)).toBe(60);
  });

  it("does not care which order the rows arrive in", () => {
    const rows = [
      cutoff({ id: "intl", scope: "international", cutoffMinutesBeforeDeparture: 90 }),
      cutoff({ id: "dom", scope: "domestic", cutoffMinutesBeforeDeparture: 45 }),
    ];
    expect(resolveStrictestCutoffMinutes(rows, lookup, now)).toBe(90);
  });

  it("works from a single scope", () => {
    const rows = [cutoff({ scope: "international", cutoffMinutesBeforeDeparture: 75 })];
    expect(resolveStrictestCutoffMinutes(rows, lookup, now)).toBe(75);
  });

  it("matches the airline code case-insensitively", () => {
    expect(resolveStrictestCutoffMinutes([cutoff({ airlineIata: "dl" })], lookup, now)).toBe(45);
  });

  it("ignores rows that have not taken effect yet", () => {
    const rows = [
      cutoff({ cutoffMinutesBeforeDeparture: 45 }),
      cutoff({
        id: "future",
        scope: "international",
        cutoffMinutesBeforeDeparture: 120,
        effectiveFrom: new Date("2030-01-01T00:00:00Z"),
      }),
    ];
    expect(resolveStrictestCutoffMinutes(rows, lookup, now)).toBe(45);
  });

  it("ignores another airport's rows", () => {
    const rows = [
      cutoff({ cutoffMinutesBeforeDeparture: 45 }),
      cutoff({ id: "lga", airportCode: "LGA" as AirportCode, cutoffMinutesBeforeDeparture: 200 }),
    ];
    expect(resolveStrictestCutoffMinutes(rows, lookup, now)).toBe(45);
  });

  it("throws rather than guessing when nothing is on record", () => {
    expect(() => resolveStrictestCutoffMinutes([], lookup, now)).toThrow(/No bag-drop cutoff/);
  });
});
