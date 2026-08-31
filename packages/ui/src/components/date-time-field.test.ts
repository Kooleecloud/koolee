import { describe, expect, it } from "vitest";

import { __dateTimeFieldInternals } from "./date-time-field";

const { toParts, toValue, daysInMonth } = __dateTimeFieldInternals;

/**
 * The wall-clock contract, in assertions.
 *
 * `DateTimeField` posts the same `YYYY-MM-DDTHH:mm` string a native
 * `datetime-local` input does, and the flight step feeds it the AIRPORT's wall
 * clock. So a round-trip that loses or shifts an hour is not a cosmetic bug:
 * it moves a stored departure, and with it every cutoff and bookable window
 * derived from one.
 */
describe("date-time field parts", () => {
  it("round-trips a value through parts unchanged", () => {
    for (const value of [
      "2026-09-12T13:15",
      "2026-01-06T01:35",
      "2026-12-31T23:59",
      "2026-06-01T00:00",
      "2026-06-01T12:00",
    ]) {
      expect(toValue(toParts(value))).toBe(value);
    }
  });

  it("reads midnight as 12 AM and noon as 12 PM, not 0 and 0", () => {
    // The two cases every hand-rolled 12-hour converter gets wrong.
    expect(toParts("2026-06-01T00:30")).toMatchObject({ hour: "12", meridiem: "AM" });
    expect(toParts("2026-06-01T12:30")).toMatchObject({ hour: "12", meridiem: "PM" });
    expect(toValue({ ...toParts("2026-06-01T00:30") })).toBe("2026-06-01T00:30");
    expect(toValue({ ...toParts("2026-06-01T12:30") })).toBe("2026-06-01T12:30");
  });

  it("is empty while any segment is unfinished — never a guessed value", () => {
    const base = toParts("2026-09-12T13:15");
    expect(toValue({ ...base, year: "202" })).toBe("");
    expect(toValue({ ...base, month: "" })).toBe("");
    expect(toValue({ ...base, minute: "" })).toBe("");
  });

  it("refuses a date that does not exist", () => {
    const base = toParts("2026-09-12T13:15");
    // Feb 30 and month 13 both submitted happily before the range checks.
    expect(toValue({ ...base, month: "02", day: "30" })).toBe("");
    expect(toValue({ ...base, month: "13" })).toBe("");
    expect(toValue({ ...base, hour: "13" })).toBe("");
  });

  it("knows February's real length, leap years included", () => {
    expect(daysInMonth(2, 2026)).toBe(28);
    expect(daysInMonth(2, 2028)).toBe(29);
    // 1900 is not a leap year, 2000 is — the rule most implementations skip.
    expect(daysInMonth(2, 1900)).toBe(28);
    expect(daysInMonth(2, 2000)).toBe(29);
    expect(daysInMonth(4, 2026)).toBe(30);
  });

  it("accepts a leap day only in a leap year", () => {
    const base = toParts("2026-09-12T13:15");
    expect(toValue({ ...base, year: "2028", month: "02", day: "29" })).toBe(
      "2028-02-29T13:15",
    );
    expect(toValue({ ...base, year: "2026", month: "02", day: "29" })).toBe("");
  });

  it("returns empty segments for anything it cannot parse", () => {
    expect(toParts("")).toMatchObject({ month: "", day: "", year: "" });
    expect(toParts("2026-09-12")).toMatchObject({ month: "", day: "", year: "" });
  });
});
