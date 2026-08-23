import { TZDate } from "@date-fns/tz";
import { describe, expect, it } from "vitest";

import {
  bookableWindows,
  enumerateHourlyWindows,
  evaluateHourlyWindow,
  pickupLeadMinutesFor,
  type WindowRulesContext,
} from "./windows";

const NY = "America/New_York";
const HOUR = 3_600_000;

/** Builds an instant from a New York wall-clock time. */
const ny = (iso: string): Date => new Date(new TZDate(...tzParts(iso), NY).getTime());

function tzParts(iso: string): [number, number, number, number, number] {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(iso);
  if (!match) throw new Error(`bad test date: ${iso}`);
  const [, y, mo, d, h, mi] = match;
  return [Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi)];
}

/** Defaults matching CoreDefaults: 6h reserve, 24h band, 2h notice. */
const ctx = (over: Partial<WindowRulesContext> = {}): WindowRulesContext => ({
  departureAt: ny("2025-06-10T18:00"),
  cutoffMinutes: 45,
  now: ny("2025-06-08T12:00"), // two days out: notice fence never bites
  driveTimeMinutes: 60,
  bufferMinutes: 30,
  operationsReserveMinutes: 6 * 60,
  bandMinutes: 24 * 60,
  noticeMinutes: 2 * 60,
  ...over,
});

describe("enumerateHourlyWindows — the band", () => {
  it("yields exactly 24 clock-aligned one-hour windows for an on-the-hour departure", () => {
    const verdicts = enumerateHourlyWindows(ctx());
    expect(verdicts).toHaveLength(24);
    // Ends span (T−30h, T−6h]: first end 13:00 on 9 Jun, last end 12:00 on 10 Jun.
    expect(verdicts[0]!.windowEnd.getTime()).toBe(ny("2025-06-09T13:00").getTime());
    expect(verdicts[23]!.windowEnd.getTime()).toBe(ny("2025-06-10T12:00").getTime());
    for (const v of verdicts) {
      expect(v.windowEnd.getTime() - v.windowStart.getTime()).toBe(HOUR);
      expect(v.windowStart.getTime() % HOUR).toBe(0);
    }
  });

  it("yields exactly 24 windows for an off-hour departure, clipped to full hours", () => {
    const verdicts = enumerateHourlyWindows(ctx({ departureAt: ny("2025-06-10T18:37") }));
    expect(verdicts).toHaveLength(24);
    // Reserve edge is 12:37; the last full window ends 12:00.
    expect(verdicts[23]!.windowEnd.getTime()).toBe(ny("2025-06-10T12:00").getTime());
  });

  it("orders windows chronologically with contiguous hours", () => {
    const verdicts = enumerateHourlyWindows(ctx());
    for (let i = 1; i < verdicts.length; i += 1) {
      expect(verdicts[i]!.windowStart.getTime()).toBe(
        verdicts[i - 1]!.windowStart.getTime() + HOUR,
      );
    }
  });

  it("computes the pricing lead from the window END to departure", () => {
    const verdicts = enumerateHourlyWindows(ctx());
    // Last window ends at T−6h → lead 360; first ends at T−29h → lead 1740.
    expect(verdicts[23]!.pickupLeadMinutes).toBe(360);
    expect(verdicts[0]!.pickupLeadMinutes).toBe(29 * 60);
  });
});

describe("enumerateHourlyWindows — fences", () => {
  it("far from departure, every window is bookable", () => {
    expect(bookableWindows(ctx())).toHaveLength(24);
  });

  it("tags windows starting inside the booking notice, including past ones", () => {
    // The worked example: flight tomorrow 6 PM, booking tonight at 7:30 PM.
    // The 8–9 PM window starts in 30 min and 9–10 PM in 90 min — both inside
    // the 2-hour notice. The first bookable window is 10–11 PM.
    const verdicts = enumerateHourlyWindows(ctx({ now: ny("2025-06-09T19:30") }));
    const bookable = verdicts.filter((v) => v.reason === undefined);
    expect(bookable[0]!.windowStart.getTime()).toBe(ny("2025-06-09T22:00").getTime());
    for (const v of verdicts.filter((x) => x.windowStart < ny("2025-06-09T21:30"))) {
      expect(v.reason).toBe("starts_before_notice");
    }
  });

  it("a window starting exactly at now + notice is bookable", () => {
    const verdicts = enumerateHourlyWindows(ctx({ now: ny("2025-06-09T11:00") }));
    const at = verdicts.find(
      (v) => v.windowStart.getTime() === ny("2025-06-09T13:00").getTime(),
    );
    expect(at?.reason).toBeUndefined();
  });

  it("returns nothing bookable when the flight is too close", () => {
    // 7h before departure: the last window ends T−6h but must START ≥ now+2h
    // = T−5h — impossible. Everything is either past, short-notice, or gone.
    const verdicts = enumerateHourlyWindows(ctx({ now: ny("2025-06-10T11:00") }));
    expect(verdicts.filter((v) => v.reason === undefined)).toHaveLength(0);
  });

  it("applies the airline cutoff when it is stricter than the reserve", () => {
    // cutoff formula: departure − (300 + 60 + 30) = T−6.5h < reserve edge T−6h.
    const verdicts = enumerateHourlyWindows(ctx({ cutoffMinutes: 300 }));
    const last = verdicts[23]!;
    expect(last.reason).toBe("misses_bag_drop_cutoff");
    expect(verdicts[22]!.reason).toBeUndefined(); // ends T−7h, safe
  });

  it("tags windows overlapping a block, and only those", () => {
    const verdicts = enumerateHourlyWindows(
      ctx({
        blocks: [
          // Blocks 14:00–16:00 on 9 Jun: overlaps the 13–14? No — half-open.
          { blockStart: ny("2025-06-09T14:00"), blockEnd: ny("2025-06-09T16:00") },
        ],
      }),
    );
    const reasons = new Map(
      verdicts.map((v) => [v.windowStart.getTime(), v.reason] as const),
    );
    expect(reasons.get(ny("2025-06-09T13:00").getTime())).toBeUndefined();
    expect(reasons.get(ny("2025-06-09T14:00").getTime())).toBe("blocked");
    expect(reasons.get(ny("2025-06-09T15:00").getTime())).toBe("blocked");
    expect(reasons.get(ny("2025-06-09T16:00").getTime())).toBeUndefined();
  });

  it("a partial-hour block still blocks the window it touches", () => {
    const verdicts = enumerateHourlyWindows(
      ctx({
        blocks: [
          { blockStart: ny("2025-06-09T14:30"), blockEnd: ny("2025-06-09T14:45") },
        ],
      }),
    );
    const blocked = verdicts.filter((v) => v.reason === "blocked");
    expect(blocked).toHaveLength(1);
    expect(blocked[0]!.windowStart.getTime()).toBe(ny("2025-06-09T14:00").getTime());
  });
});

describe("enumerateHourlyWindows — DST (America/New_York)", () => {
  it("spring forward: every window is 60 real minutes and the band stays exact", () => {
    // Departure 18:00 EDT on 9 Mar 2025 (the 02:00→03:00 jump night is in-band).
    const verdicts = enumerateHourlyWindows(
      ctx({ departureAt: ny("2025-03-09T18:00"), now: ny("2025-03-07T12:00") }),
    );
    expect(verdicts).toHaveLength(24);
    for (const v of verdicts) {
      expect(v.windowEnd.getTime() - v.windowStart.getTime()).toBe(HOUR);
    }
    // The last window still ends exactly at T−6h as an instant.
    expect(verdicts[23]!.windowEnd.getTime()).toBe(
      ny("2025-03-09T18:00").getTime() - 6 * HOUR,
    );
  });

  it("fall back: the repeated wall-clock hour yields distinct instants", () => {
    // Departure 18:00 EST on 2 Nov 2025; the 01:00–02:00 hour repeats.
    const verdicts = enumerateHourlyWindows(
      ctx({ departureAt: ny("2025-11-02T18:00"), now: ny("2025-10-31T12:00") }),
    );
    expect(verdicts).toHaveLength(24);
    const starts = new Set(verdicts.map((v) => v.windowStart.getTime()));
    expect(starts.size).toBe(24); // no duplicated instants despite the wall clock
  });
});

describe("evaluateHourlyWindow — booking acceptance", () => {
  const start = ny("2025-06-09T14:00");
  const end = ny("2025-06-09T15:00");

  it("accepts a window the enumerator would offer", () => {
    expect(evaluateHourlyWindow(start, end, ctx())).toBeUndefined();
  });

  it("rejects a misaligned or wrong-length span as not_a_window", () => {
    expect(
      evaluateHourlyWindow(
        new Date(start.getTime() + 30 * 60_000),
        new Date(end.getTime() + 30 * 60_000),
        ctx(),
      ),
    ).toBe("not_a_window");
    expect(evaluateHourlyWindow(start, new Date(end.getTime() + HOUR), ctx())).toBe(
      "not_a_window",
    );
    expect(evaluateHourlyWindow(new Date(Number.NaN), end, ctx())).toBe("not_a_window");
  });

  it("rejects a window past the reserve edge", () => {
    expect(
      evaluateHourlyWindow(ny("2025-06-10T12:00"), ny("2025-06-10T13:00"), ctx()),
    ).toBe("misses_bag_drop_cutoff");
  });

  it("rejects a window before the band opens", () => {
    expect(
      evaluateHourlyWindow(ny("2025-06-09T11:00"), ny("2025-06-09T12:00"), ctx()),
    ).toBe("too_early_for_flight");
  });

  it("rejects a window inside the booking notice", () => {
    expect(
      evaluateHourlyWindow(start, end, ctx({ now: ny("2025-06-09T13:00") })),
    ).toBe("starts_before_notice");
  });

  it("rejects a blocked window", () => {
    expect(
      evaluateHourlyWindow(
        start,
        end,
        ctx({
          blocks: [
            { blockStart: ny("2025-06-09T14:15"), blockEnd: ny("2025-06-09T14:20") },
          ],
        }),
      ),
    ).toBe("blocked");
  });

  it("displayed-implies-accepted: every enumerated bookable window passes", () => {
    const context = ctx({
      now: ny("2025-06-09T09:17"),
      cutoffMinutes: 300,
      blocks: [
        { blockStart: ny("2025-06-09T16:00"), blockEnd: ny("2025-06-09T18:00") },
      ],
    });
    const offered = bookableWindows(context);
    expect(offered.length).toBeGreaterThan(0);
    for (const w of offered) {
      expect(evaluateHourlyWindow(w.windowStart, w.windowEnd, context)).toBeUndefined();
    }
  });
});

describe("pickupLeadMinutesFor", () => {
  it("measures minutes from window end to departure", () => {
    expect(pickupLeadMinutesFor(ny("2025-06-10T12:00"), ny("2025-06-10T18:00"))).toBe(
      360,
    );
  });
});

describe("input validation", () => {
  it("rejects negative or non-finite rule numbers", () => {
    expect(() => enumerateHourlyWindows(ctx({ noticeMinutes: -1 }))).toThrow(RangeError);
    expect(() =>
      enumerateHourlyWindows(ctx({ bandMinutes: Number.NaN })),
    ).toThrow(RangeError);
    expect(() =>
      enumerateHourlyWindows(ctx({ departureAt: new Date(Number.NaN) })),
    ).toThrow(RangeError);
  });
});
