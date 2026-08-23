import { describe, expect, it } from "vitest";

import { bookingDraftSchema } from "./booking-draft-schema";

/**
 * Booking-critical schema coverage (zod v4): a complete valid draft parses,
 * and each class of bad input is rejected. The draft carries both the booking
 * creation fields and the bag data.
 */

const VALID_DRAFT = {
  flightNumber: "UA1189",
  airlineIata: "UA",
  departureAirport: "EWR",
  departureAt: "2026-09-14T14:30:00.000Z",
  scope: "domestic",
  paxName: "Alex Traveler",
  phone: "+12125550123",
  line1: "350 5th Ave",
  city: "New York",
  state: "NY",
  zip: "10118",
  bagCount: 2,
  windowStart: "2026-09-13T14:00:00.000Z",
  windowEnd: "2026-09-13T15:00:00.000Z",
} as const;

describe("bookingDraftSchema", () => {
  it("parses a complete valid draft", () => {
    const parsed = bookingDraftSchema.parse(VALID_DRAFT);
    expect(parsed.bagCount).toBe(2);
    expect(parsed.departureAirport).toBe("EWR");
    expect(parsed.windowStart).toBe("2026-09-13T14:00:00.000Z");
  });

  it("parses an empty draft (every field optional)", () => {
    expect(bookingDraftSchema.parse({})).toEqual({});
  });

  it.each([
    ["bagCount below minimum", { bagCount: 0 }],
    ["bagCount above maximum", { bagCount: 11 }],
    ["non-integer bagCount", { bagCount: 1.5 }],
    ["unknown airport", { departureAirport: "BOS" }],
    ["malformed departure timestamp", { departureAt: "tomorrow at 3" }],
    ["malformed windowStart", { windowStart: "next tuesday" }],
    ["malformed windowEnd", { windowEnd: "2026-09-13" }],
    ["non-uuid bookingId", { bookingId: "booking-42" }],
    ["single-letter airline code", { airlineIata: "U" }],
    ["overlong flight number", { flightNumber: "UA118934567" }],
  ])("rejects %s", (_label, patch) => {
    const result = bookingDraftSchema.safeParse({ ...VALID_DRAFT, ...patch });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.length).toBeGreaterThan(0);
    }
  });
});
