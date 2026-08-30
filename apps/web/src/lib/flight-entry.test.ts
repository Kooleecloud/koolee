import { describe, expect, it } from "vitest";

import { draftHasFlight, flightEntryMode } from "./flight-entry";
import type { TypedBookingDraft } from "./booking-draft-schema";

/**
 * The door's one rule: nobody who has already answered gets asked again.
 *
 * The three ways past it are three different people — one who uploaded, one
 * who chose to type, and one who is stepping back to change an answer — and
 * the failure that matters is the third being sent back to an upload screen,
 * which reads as having lost their booking.
 */

const filled: TypedBookingDraft = {
  flightNumber: "DL123",
  departureAirport: "JFK",
  departureAt: "2026-09-03T22:00:00.000Z",
  paxName: "Casey Rivera",
};

const prefill: TypedBookingDraft["ticketPrefill"] = {
  flightNumber: "DL123",
  departureAirport: "JFK",
  departureAtLocal: "2026-09-03T18:00",
  paxName: "Casey Rivera",
  confidence: "high",
};

describe("flightEntryMode", () => {
  it("shows the door to a first-time visitor", () => {
    expect(flightEntryMode({ draft: {} })).toBe("door");
  });

  it("shows the review form once a reading has landed", () => {
    expect(flightEntryMode({ from: "ticket", draft: { ticketPrefill: prefill } })).toBe(
      "review",
    );
  });

  it("ignores ?from=ticket with no prefill behind it", () => {
    // A shared link, or a back button after the draft cookie expired. Showing
    // "here's what we read from your ticket" above six empty fields is worse
    // than showing the door.
    expect(flightEntryMode({ from: "ticket", draft: {} })).toBe("door");
  });

  it("shows the form when the customer chose to type", () => {
    expect(flightEntryMode({ entry: "manual", draft: {} })).toBe("manual");
  });

  it("shows the form when an unreadable file dropped them there", () => {
    // The upload component navigates to ?entry=manual&read=failed. The mode
    // must not depend on the apology, only on the entry.
    expect(flightEntryMode({ entry: "manual", draft: {} })).toBe("manual");
  });

  it("never sends somebody stepping back to edit through the door again", () => {
    expect(flightEntryMode({ draft: filled })).toBe("manual");
  });

  it("prefers a fresh reading over what the draft already holds", () => {
    // Uploading a second ticket from the form must show what the SECOND one
    // said, not the values the first one produced.
    expect(
      flightEntryMode({ from: "ticket", draft: { ...filled, ticketPrefill: prefill } }),
    ).toBe("review");
  });
});

describe("draftHasFlight", () => {
  it("requires all four, because submitFlight writes all four", () => {
    expect(draftHasFlight(filled)).toBe(true);
    for (const key of [
      "flightNumber",
      "departureAirport",
      "departureAt",
      "paxName",
    ] as const) {
      const partial = { ...filled };
      delete partial[key];
      expect(draftHasFlight(partial), `missing ${key}`).toBe(false);
    }
  });

  it("is false for an empty draft", () => {
    expect(draftHasFlight({})).toBe(false);
  });
});
