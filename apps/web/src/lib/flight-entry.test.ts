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

/**
 * THE FOURTH PERSON: one we refused.
 *
 * `draftHasFlight` is false for them — the step never committed, because it
 * never succeeded — so the door check let them through to a file-drop area.
 * They had typed a flight number, an airport, a date, a time and a name, and
 * what they got wrong was a ZIP one street outside coverage.
 *
 * The out-of-area card makes this reachable rather than theoretical: it
 * replaces the whole form, and its "Try another ZIP" is a real link back to
 * this page.
 */
describe("flightEntryMode after a refusal", () => {
  const rejected: TypedBookingDraft["flightEntry"] = {
    zip: "90210",
    flightNumber: "DL123",
    departureAirport: "JFK",
    departureAt: "2026-09-03T18:00",
    paxName: "Casey Rivera",
  };

  it("does NOT send a refused customer back to the upload door", () => {
    expect(flightEntryMode({ draft: { flightEntry: rejected } })).toBe("manual");
  });

  it("is still the door when the refusal carried nothing", () => {
    // A draft with no rejected entry and no flight is a first visit.
    expect(flightEntryMode({ draft: {} })).toBe("door");
  });

  it("does not outrank a fresh ticket reading", () => {
    // They uploaded again after being refused. The reading is newer.
    expect(
      flightEntryMode({
        from: "ticket",
        draft: { ticketPrefill: prefill, flightEntry: rejected },
      }),
    ).toBe("review");
  });

  it("leaves a committed draft reading manual, as before", () => {
    expect(flightEntryMode({ draft: { ...filled, flightEntry: rejected } })).toBe(
      "manual",
    );
  });
});
