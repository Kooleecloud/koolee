import { describe, expect, it } from "vitest";

import {
  CUTOFF_HORIZON_MS,
  formatCutoffDistance,
  withinCutoffHorizon,
} from "./cutoff-horizon";

/**
 * The bug this replaces, pinned: a booking six months out rendered
 * "4499h 3m until AI's bag-drop cutoff at EWR". Nobody converts that, and an
 * urgent-looking banner that is permanently non-urgent teaches people to skip
 * the one that matters.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const NOW = new Date("2026-06-10T12:00:00Z");
const at = (ms: number) => new Date(NOW.getTime() + ms);

describe("withinCutoffHorizon", () => {
  it("hides a cutoff further out than a week", () => {
    // The reported case: ~4499 hours, i.e. six months.
    expect(withinCutoffHorizon(at(4499 * HOUR), NOW)).toBe(false);
    expect(withinCutoffHorizon(at(8 * DAY), NOW)).toBe(false);
  });

  it("shows a cutoff inside the horizon", () => {
    expect(withinCutoffHorizon(at(6 * DAY), NOW)).toBe(true);
    expect(withinCutoffHorizon(at(2 * HOUR), NOW)).toBe(true);
  });

  it("is inclusive at the boundary", () => {
    expect(withinCutoffHorizon(at(CUTOFF_HORIZON_MS), NOW)).toBe(true);
    expect(withinCutoffHorizon(at(CUTOFF_HORIZON_MS + 1), NOW)).toBe(false);
  });

  it("ALWAYS shows a cutoff that has already passed", () => {
    // Not a countdown — the state of the booking, and the only thing on the
    // page that explains why nothing else works. Hiding it because the flight
    // was last month would be hiding the answer.
    expect(withinCutoffHorizon(at(-1 * MINUTE), NOW)).toBe(true);
    expect(withinCutoffHorizon(at(-90 * DAY), NOW)).toBe(true);
  });
});

describe("formatCutoffDistance", () => {
  it("uses days once past a day, and drops the hours", () => {
    // Between one day and two there is nothing a customer does differently at
    // 25 hours versus 47, and "1 day 23h" is a sentence people re-read.
    expect(formatCutoffDistance(DAY)).toBe("1 day");
    expect(formatCutoffDistance(DAY + 23 * HOUR)).toBe("1 day");
    expect(formatCutoffDistance(3 * DAY)).toBe("3 days");
    expect(formatCutoffDistance(6 * DAY + 23 * HOUR)).toBe("6 days");
  });

  it("uses hours and minutes inside a day", () => {
    expect(formatCutoffDistance(23 * HOUR + 59 * MINUTE)).toBe("23h 59m");
    expect(formatCutoffDistance(7 * HOUR + 12 * MINUTE)).toBe("7h 12m");
    expect(formatCutoffDistance(HOUR)).toBe("1h 0m");
  });

  it("uses minutes inside an hour — the range that actually drives action", () => {
    expect(formatCutoffDistance(42 * MINUTE)).toBe("42 min");
    expect(formatCutoffDistance(MINUTE)).toBe("1 min");
  });

  it("does not render a zero", () => {
    expect(formatCutoffDistance(30_000)).toBe("less than a minute");
    expect(formatCutoffDistance(0)).toBe("less than a minute");
  });

  it("reads the same in both directions", () => {
    // The same ladder serves "3 days until" and "3 days ago".
    expect(formatCutoffDistance(-3 * DAY)).toBe("3 days");
    expect(formatCutoffDistance(-42 * MINUTE)).toBe("42 min");
  });

  it("never renders the shape the bug report showed", () => {
    for (const span of [4499 * HOUR, 30 * DAY, 8 * DAY]) {
      expect(formatCutoffDistance(span)).not.toMatch(/\d{3,}h/);
    }
  });
});
