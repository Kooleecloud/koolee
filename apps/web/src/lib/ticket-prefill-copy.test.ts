import { describe, expect, it } from "vitest";

import { describePrefill, formatLocalStamp } from "./ticket-prefill-copy";
import type { TicketPrefill } from "./booking-draft-schema";

/**
 * The sentence above the review form. Its job is that no prefilled — or
 * conspicuously EMPTY — field goes unexplained, so each branch is pinned to
 * the situation that produces it.
 */

function prefill(partial: Partial<TicketPrefill>): TicketPrefill {
  return { confidence: "high", ...partial };
}

describe("describePrefill", () => {
  it("names the airport we cannot serve rather than leaving a blank dropdown", () => {
    const notice = describePrefill(
      prefill({
        selectionReason: "no_serviced_origin",
        nonServicedOrigin: "SFO",
        confidence: "low",
      }),
    );
    expect(notice?.tone).toBe("error");
    expect(notice?.text).toContain("departs SFO");
    expect(notice?.text).toContain("JFK, LGA and EWR");
  });

  it("says which leg of a round trip it used", () => {
    const notice = describePrefill(
      prefill({
        selectionReason: "single_serviced_origin",
        documentKind: "round_trip",
        departureAirport: "EWR",
        destinationAirport: "DEL",
        departureAtLocal: "2026-09-12T13:15",
      }),
    );
    expect(notice?.tone).toBe("info");
    expect(notice?.text).toBe(
      "Round trip — we used EWR → DEL on Sep 12, 1:15 PM, the only leg departing an airport we serve.",
    );
  });

  it("warns when more than one leg leaves New York", () => {
    const notice = describePrefill(
      prefill({
        selectionReason: "ambiguous_serviced_origins",
        departureAirport: "JFK",
        destinationAirport: "MIA",
        departureAtLocal: "2026-09-05T09:00",
        confidence: "low",
      }),
    );
    expect(notice?.tone).toBe("error");
    expect(notice?.text).toContain("more than one flight leaving New York");
  });

  it("flags a ticket whose flight has already gone", () => {
    const notice = describePrefill(
      prefill({
        selectionReason: "all_serviced_departures_past",
        departureAirport: "EWR",
        departureAtLocal: "2017-12-12T13:15",
        confidence: "low",
      }),
    );
    expect(notice?.tone).toBe("error");
    expect(notice?.text).toContain("already departed");
  });

  it("says nothing when there is no prefill or no recorded reason", () => {
    expect(describePrefill(undefined)).toBeNull();
    expect(describePrefill(prefill({ flightNumber: "UA1189" }))).toBeNull();
  });
});

describe("formatLocalStamp", () => {
  it("reads the wall clock off the string without inventing a zone", () => {
    expect(formatLocalStamp("2026-09-12T13:15")).toBe("Sep 12, 1:15 PM");
    expect(formatLocalStamp("2026-01-06T00:35")).toBe("Jan 6, 12:35 AM");
    expect(formatLocalStamp("2026-01-06T12:00")).toBe("Jan 6, 12:00 PM");
  });

  it("is undefined for anything that is not that shape", () => {
    expect(formatLocalStamp(undefined)).toBeUndefined();
    expect(formatLocalStamp("next Tuesday")).toBeUndefined();
  });
});
