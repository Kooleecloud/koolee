import { describe, expect, it } from "vitest";

import { DEFAULTS } from "../config";
import { assignmentHorizonEnd, withinAssignmentHorizon } from "./assignment-horizon";

/**
 * The horizon predicate, on its own, because three callers depend on it
 * agreeing with itself: the on-paid hook, the sweep, and the console's
 * at-risk flag.
 */

const NOW = new Date("2026-09-01T12:00:00Z");
const hours = (n: number) => new Date(NOW.getTime() + n * 3_600_000);

describe("withinAssignmentHorizon", () => {
  it("is true inside the horizon and false beyond it", () => {
    expect(withinAssignmentHorizon(hours(1), NOW, 48)).toBe(true);
    expect(withinAssignmentHorizon(hours(47), NOW, 48)).toBe(true);
    expect(withinAssignmentHorizon(hours(49), NOW, 48)).toBe(false);
    expect(withinAssignmentHorizon(hours(24 * 90), NOW, 48)).toBe(false);
  });

  it("includes the boundary — a booking exactly on the line is assignable", () => {
    // Inclusive on purpose: the sweep's SQL is `<= horizonEnd`, and a
    // predicate that disagreed with it by a microsecond would leave a booking
    // selected by the query and refused by the guard.
    expect(withinAssignmentHorizon(hours(48), NOW, 48)).toBe(true);
  });

  it("treats a window already in the past as in-horizon", () => {
    // A late booking is not a booking to defer.
    expect(withinAssignmentHorizon(hours(-3), NOW, 48)).toBe(true);
  });

  it("never defers a booking with no window — there is no date to wait for", () => {
    expect(withinAssignmentHorizon(null, NOW, 48)).toBe(true);
    expect(withinAssignmentHorizon(null, NOW, 1)).toBe(true);
  });

  it("respects the configured horizon rather than a constant", () => {
    const windowStart = hours(24);
    expect(withinAssignmentHorizon(windowStart, NOW, 48)).toBe(true);
    expect(withinAssignmentHorizon(windowStart, NOW, 6)).toBe(false);
    expect(withinAssignmentHorizon(windowStart, NOW, 72)).toBe(true);
  });

  it("agrees with assignmentHorizonEnd, which is what the sweep queries with", () => {
    const end = assignmentHorizonEnd(NOW, 48);
    expect(end.toISOString()).toBe("2026-09-03T12:00:00.000Z");
    expect(withinAssignmentHorizon(end, NOW, 48)).toBe(true);
    expect(withinAssignmentHorizon(new Date(end.getTime() + 1), NOW, 48)).toBe(false);
  });

  it("ships a 48-hour default", () => {
    expect(DEFAULTS.assignmentHorizonHours).toBe(48);
  });
});
