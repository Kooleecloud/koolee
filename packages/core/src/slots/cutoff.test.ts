import { TZDate } from "@date-fns/tz";
import { describe, expect, it } from "vitest";
import type { AirlineCutoff, AirportCode, SlotTier } from "@koolee/db";

import { CutoffUnknownError } from "../errors";
import {
  airportLocalDay,
  computeBagDropCutoffAt,
  computeLatestPickupStart,
  DEFAULT_BUFFER_MINUTES,
  DEFAULT_DRIVE_TIME_MINUTES,
  evaluateSlot,
  explainSlotSellability,
  filterSellableSlots,
  formatWindowInAirportTz,
  minutesUntilCutoff,
  resolveCutoffMinutes,
  type SellabilityContext,
  type SellableSlotInput,
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

const slot = (
  over: Partial<SellableSlotInput> & { windowStart: Date; windowEnd: Date },
): SellableSlotInput => ({
  id: "s-1",
  airportCode: "JFK",
  tier: "standard_4h" as SlotTier,
  capacity: 10,
  bookedCount: 0,
  ...over,
});

const ctx = (over: Partial<SellabilityContext> = {}): SellabilityContext => ({
  airportCode: "JFK",
  departureAt: ny("2025-06-10T18:00"),
  cutoffMinutes: 45,
  driveTimeMinutes: 60,
  bufferMinutes: 30,
  now: ny("2025-06-10T06:00"),
  ...over,
});

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

  it("keeps slot filtering correct across spring forward", () => {
    // Departure 08:00 EDT on the jump day. Latest start = −135m = 05:45 EDT.
    const context = ctx({
      departureAt: ny("2025-03-09T08:00"),
      now: ny("2025-03-08T20:00"),
      cutoffMinutes: 45,
      driveTimeMinutes: 60,
      bufferMinutes: 30,
    });

    const before = slot({
      id: "ends-0130-est",
      windowStart: ny("2025-03-09T00:30"),
      windowEnd: ny("2025-03-09T01:30"),
    });
    // 05:45 EDT == 09:45Z. A window ending 05:30 EDT (09:30Z) is safe.
    const justSafe = slot({
      id: "ends-0530-edt",
      windowStart: ny("2025-03-09T04:30"),
      windowEnd: ny("2025-03-09T05:30"),
    });
    const tooLate = slot({
      id: "ends-0600-edt",
      windowStart: ny("2025-03-09T05:00"),
      windowEnd: ny("2025-03-09T06:00"),
    });

    const sellable = filterSellableSlots([before, justSafe, tooLate], context);
    expect(sellable.map((s) => s.id)).toEqual(["ends-0130-est", "ends-0530-edt"]);
  });

  it("keeps slot filtering correct across fall back", () => {
    const context = ctx({
      departureAt: ny("2025-11-02T08:00"),
      now: ny("2025-11-01T20:00"),
    });
    // 08:00 EST == 13:00Z. Latest start = 13:00Z − 135m = 10:45Z == 05:45 EST.
    const safe = slot({
      id: "safe",
      windowStart: new Date("2025-11-02T04:00:00Z"),
      windowEnd: new Date("2025-11-02T10:00:00Z"),
    });
    const tooLate = slot({
      id: "too-late",
      windowStart: new Date("2025-11-02T10:00:00Z"),
      windowEnd: new Date("2025-11-02T11:00:00Z"),
    });

    expect(filterSellableSlots([safe, tooLate], context).map((s) => s.id)).toEqual([
      "safe",
    ]);
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

describe("evaluateSlot", () => {
  // Departure 18:00 local, cutoff 45, drive 60, buffer 30 → latest start 15:45.
  const context = ctx();

  it("sells a window that ends before the latest pickup start", () => {
    const verdict = evaluateSlot(
      slot({
        windowStart: ny("2025-06-10T10:00"),
        windowEnd: ny("2025-06-10T14:00"),
      }),
      context,
    );
    expect(verdict.sellable).toBe(true);
    expect(verdict.reason).toBeUndefined();
  });

  it("sells a window ending exactly at the latest pickup start", () => {
    const verdict = evaluateSlot(
      slot({
        windowStart: ny("2025-06-10T11:45"),
        windowEnd: ny("2025-06-10T15:45"),
      }),
      context,
    );
    expect(verdict.sellable).toBe(true);
  });

  it("rejects a window ending one minute after the latest pickup start", () => {
    const verdict = evaluateSlot(
      slot({
        windowStart: ny("2025-06-10T11:46"),
        windowEnd: ny("2025-06-10T15:46"),
      }),
      context,
    );
    expect(verdict.sellable).toBe(false);
    expect(verdict.reason).toBe("misses_bag_drop_cutoff");
  });

  it("judges on window END, not window start", () => {
    // Starts comfortably early, ends far too late. Filtering on windowStart
    // would sell this and the bags would miss the flight.
    const verdict = evaluateSlot(
      slot({
        windowStart: ny("2025-06-10T13:00"),
        windowEnd: ny("2025-06-10T17:00"),
      }),
      context,
    );
    expect(verdict.sellable).toBe(false);
    expect(verdict.reason).toBe("misses_bag_drop_cutoff");
  });

  it("rejects slots at another airport", () => {
    const verdict = evaluateSlot(
      slot({
        airportCode: "EWR",
        windowStart: ny("2025-06-10T10:00"),
        windowEnd: ny("2025-06-10T14:00"),
      }),
      context,
    );
    expect(verdict.sellable).toBe(false);
    expect(verdict.reason).toBe("wrong_airport");
  });

  it("rejects a window that has already ended", () => {
    const verdict = evaluateSlot(
      slot({
        windowStart: ny("2025-06-10T02:00"),
        windowEnd: ny("2025-06-10T05:00"),
      }),
      ctx({ now: ny("2025-06-10T06:00") }),
    );
    expect(verdict.sellable).toBe(false);
    expect(verdict.reason).toBe("window_in_the_past");
  });

  it("rejects a full slot", () => {
    const verdict = evaluateSlot(
      slot({
        capacity: 4,
        bookedCount: 4,
        windowStart: ny("2025-06-10T10:00"),
        windowEnd: ny("2025-06-10T14:00"),
      }),
      context,
    );
    expect(verdict.sellable).toBe(false);
    expect(verdict.reason).toBe("at_capacity");
  });

  it("reports the cutoff miss ahead of capacity", () => {
    const verdict = evaluateSlot(
      slot({
        capacity: 4,
        bookedCount: 4,
        windowStart: ny("2025-06-10T14:00"),
        windowEnd: ny("2025-06-10T18:00"),
      }),
      context,
    );
    expect(verdict.reason).toBe("misses_bag_drop_cutoff");
  });

  it("enforces a minimum lead time when configured", () => {
    const withLead = ctx({ now: ny("2025-06-10T09:30"), minimumLeadMinutes: 120 });

    expect(
      evaluateSlot(
        slot({
          windowStart: ny("2025-06-10T10:00"),
          windowEnd: ny("2025-06-10T12:00"),
        }),
        withLead,
      ).reason,
    ).toBe("starts_before_lead_time");

    expect(
      evaluateSlot(
        slot({
          windowStart: ny("2025-06-10T11:30"),
          windowEnd: ny("2025-06-10T13:30"),
        }),
        withLead,
      ).sellable,
    ).toBe(true);
  });

  it("applies the documented defaults when drive time and buffer are omitted", () => {
    const bare: SellabilityContext = {
      airportCode: "JFK",
      departureAt: ny("2025-06-10T18:00"),
      cutoffMinutes: 45,
      now: ny("2025-06-10T06:00"),
    };
    const total = 45 + DEFAULT_DRIVE_TIME_MINUTES + DEFAULT_BUFFER_MINUTES;
    expect(total).toBe(135);

    expect(
      evaluateSlot(
        slot({
          windowStart: ny("2025-06-10T11:45"),
          windowEnd: ny("2025-06-10T15:45"),
        }),
        bare,
      ).sellable,
    ).toBe(true);
    expect(
      evaluateSlot(
        slot({
          windowStart: ny("2025-06-10T12:00"),
          windowEnd: ny("2025-06-10T16:00"),
        }),
        bare,
      ).sellable,
    ).toBe(false);
  });
});

describe("domestic vs international cutoffs change what is sellable", () => {
  const windows = [
    slot({
      id: "w-14-15",
      windowStart: ny("2025-06-10T14:00"),
      windowEnd: ny("2025-06-10T15:00"),
    }),
    slot({
      id: "w-15-1530",
      windowStart: ny("2025-06-10T15:00"),
      windowEnd: ny("2025-06-10T15:30"),
    }),
    slot({
      id: "w-1530-16",
      windowStart: ny("2025-06-10T15:30"),
      windowEnd: ny("2025-06-10T16:00"),
    }),
  ];

  it("domestic (45m) permits later windows than international (60m)", () => {
    // domestic: latest start 15:45; international: latest start 15:30.
    const domestic = filterSellableSlots(windows, ctx({ cutoffMinutes: 45 }));
    const international = filterSellableSlots(windows, ctx({ cutoffMinutes: 60 }));

    expect(domestic.map((s) => s.id)).toEqual(["w-14-15", "w-15-1530"]);
    expect(international.map((s) => s.id)).toEqual(["w-14-15", "w-15-1530"]);

    // Tighten international to 90 minutes and the 15:00 window drops out.
    const strict = filterSellableSlots(windows, ctx({ cutoffMinutes: 90 }));
    expect(strict.map((s) => s.id)).toEqual(["w-14-15"]);
  });

  it("never returns a superset when the cutoff grows", () => {
    for (const extra of [0, 15, 30, 60, 120, 240]) {
      const loose = new Set(
        filterSellableSlots(windows, ctx({ cutoffMinutes: 45 })).map((s) => s.id),
      );
      const tight = filterSellableSlots(windows, ctx({ cutoffMinutes: 45 + extra })).map(
        (s) => s.id,
      );

      for (const id of tight) expect(loose.has(id)).toBe(true);
    }
  });
});

describe("filterSellableSlots", () => {
  it("returns chronological order regardless of input order", () => {
    const late = slot({
      id: "late",
      windowStart: ny("2025-06-10T12:00"),
      windowEnd: ny("2025-06-10T14:00"),
    });
    const early = slot({
      id: "early",
      windowStart: ny("2025-06-10T08:00"),
      windowEnd: ny("2025-06-10T10:00"),
    });
    const middle = slot({
      id: "middle",
      windowStart: ny("2025-06-10T10:00"),
      windowEnd: ny("2025-06-10T12:00"),
    });

    expect(filterSellableSlots([late, early, middle], ctx()).map((s) => s.id)).toEqual([
      "early",
      "middle",
      "late",
    ]);
  });

  it("returns an empty list rather than throwing when nothing is sellable", () => {
    const tooLate = slot({
      windowStart: ny("2025-06-10T17:00"),
      windowEnd: ny("2025-06-10T18:00"),
    });
    expect(filterSellableSlots([tooLate], ctx())).toEqual([]);
    expect(filterSellableSlots([], ctx())).toEqual([]);
  });

  it("never returns a slot whose window_end exceeds the latest pickup start", () => {
    // Property check over a spread of departures, cutoffs and windows.
    for (const departureHour of [6, 9, 12, 15, 18, 21]) {
      for (const cutoffMinutes of [30, 45, 60, 90, 120]) {
        const context = ctx({
          departureAt: ny(`2025-06-10T${String(departureHour).padStart(2, "0")}:00`),
          cutoffMinutes,
          now: ny("2025-06-09T00:00"),
        });

        const latest = computeLatestPickupStart({
          departureAt: context.departureAt,
          cutoffMinutes,
          driveTimeMinutes: 60,
          bufferMinutes: 30,
        });

        const candidates = Array.from({ length: 24 }, (_, hour) =>
          slot({
            id: `h-${hour}`,
            windowStart: ny(`2025-06-10T${String(hour).padStart(2, "0")}:00`),
            windowEnd: ny(`2025-06-10T${String(hour).padStart(2, "0")}:59`),
          }),
        );

        for (const sellable of filterSellableSlots(candidates, context)) {
          expect(sellable.windowEnd.getTime()).toBeLessThanOrEqual(latest.getTime());
        }
      }
    }
  });
});

describe("explainSlotSellability", () => {
  it("keeps rejected slots with their reasons, chronologically", () => {
    const verdicts = explainSlotSellability(
      [
        slot({
          id: "full",
          capacity: 1,
          bookedCount: 1,
          windowStart: ny("2025-06-10T08:00"),
          windowEnd: ny("2025-06-10T10:00"),
        }),
        slot({
          id: "ok",
          windowStart: ny("2025-06-10T10:00"),
          windowEnd: ny("2025-06-10T12:00"),
        }),
        slot({
          id: "late",
          windowStart: ny("2025-06-10T16:00"),
          windowEnd: ny("2025-06-10T18:00"),
        }),
      ],
      ctx(),
    );

    expect(verdicts.map((v) => [v.slot.id, v.sellable, v.reason])).toEqual([
      ["full", false, "at_capacity"],
      ["ok", true, undefined],
      ["late", false, "misses_bag_drop_cutoff"],
    ]);
  });
});

/* ================================================================== */
/* cutoff instants and display                                         */
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
    expect(text).toBe("Tue 10 Jun, 10:00 AM – 2:00 PM");
  });

  it("spells out both dates when the window crosses local midnight", () => {
    const text = formatWindowInAirportTz(
      new Date("2025-06-11T02:00:00Z"), // 22:00 EDT on 10 Jun
      new Date("2025-06-11T06:00:00Z"), // 02:00 EDT on 11 Jun
      NY,
    );
    expect(text).toBe("Tue 10 Jun, 10:00 PM – Wed 11 Jun, 2:00 AM");
  });
});
