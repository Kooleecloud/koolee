import { describe, expect, it } from "vitest";

import {
  deriveScope,
  normalizeSegment,
  selectSegment,
  todayAtServicedAirports,
} from "./select-segment";
import type { ExtractedSegment } from "./types";

/**
 * The leg-choosing policy, tested without a model or a network call.
 *
 * These shapes are the ones that actually reach us: the New York round trip,
 * the foreign round trip whose NYC departure is the RETURN leg (the case that
 * shipped broken — the extractor confidently returned the segment arriving at
 * JFK), the open-jaw with two NYC departures, and the ticket out of an
 * airport we do not serve at all.
 */

const TODAY = "2026-08-29";

function seg(partial: Partial<ExtractedSegment>): ExtractedSegment {
  return partial;
}

describe("selectSegment", () => {
  it("takes the only leg departing an airport we serve", () => {
    const result = selectSegment(
      [
        seg({
          originAirport: "JFK",
          destinationAirport: "LAX",
          departureAtLocal: "2026-09-02T08:00",
        }),
        seg({
          originAirport: "LAX",
          destinationAirport: "JFK",
          departureAtLocal: "2026-09-09T17:00",
        }),
      ],
      { today: TODAY },
    );
    expect(result.reason).toBe("single_serviced_origin");
    expect(result.chosenOrigin).toBe("JFK");
    expect(result.confidence).toBe("high");
    expect(result.alternatives).toEqual([]);
  });

  it("picks the NYC departure even when it is the RETURN leg printed second", () => {
    // The regression: a Delhi-origin round trip. The only serviced departure
    // is the second leg, and the document lists it last.
    const result = selectSegment(
      [
        seg({
          originAirport: "DEL",
          destinationAirport: "JFK",
          departureAtLocal: "2026-09-01T01:35",
        }),
        seg({
          originAirport: "EWR",
          destinationAirport: "DEL",
          departureAtLocal: "2026-09-20T13:15",
        }),
      ],
      { today: TODAY },
    );
    expect(result.chosenIndex).toBe(1);
    expect(result.chosenOrigin).toBe("EWR");
    expect(result.confidence).toBe("high");
  });

  it("skips a serviced leg that has already flown", () => {
    const result = selectSegment(
      [
        seg({
          originAirport: "JFK",
          destinationAirport: "LHR",
          departureAtLocal: "2026-08-01T20:00",
        }),
        seg({
          originAirport: "EWR",
          destinationAirport: "CDG",
          departureAtLocal: "2026-09-15T18:00",
        }),
      ],
      { today: TODAY },
    );
    expect(result.reason).toBe("earliest_upcoming_serviced_origin");
    expect(result.chosenOrigin).toBe("EWR");
    expect(result.confidence).toBe("high");
    expect(result.alternatives).toHaveLength(1);
  });

  it("drops to low confidence with two upcoming NYC departures (open-jaw)", () => {
    const result = selectSegment(
      [
        seg({
          originAirport: "JFK",
          destinationAirport: "MIA",
          departureAtLocal: "2026-09-05T09:00",
        }),
        seg({
          originAirport: "EWR",
          destinationAirport: "AUS",
          departureAtLocal: "2026-09-19T09:00",
        }),
      ],
      { today: TODAY },
    );
    expect(result.reason).toBe("ambiguous_serviced_origins");
    expect(result.confidence).toBe("low");
    // Earliest still wins the prefill; the other is offered as a swap.
    expect(result.chosenOrigin).toBe("JFK");
    expect(result.alternatives[0]?.originAirport).toBe("EWR");
  });

  it("reports the unserviced origin instead of blanking the field silently", () => {
    const result = selectSegment(
      [
        seg({
          originAirport: "SFO",
          destinationAirport: "JFK",
          departureAtLocal: "2026-09-03T08:15",
        }),
      ],
      { today: TODAY },
    );
    expect(result.reason).toBe("no_serviced_origin");
    expect(result.nonServicedOrigin).toBe("SFO");
    expect(result.chosen).toBeUndefined();
    expect(result.chosenOrigin).toBeUndefined();
    expect(result.confidence).toBe("low");
  });

  it("keeps a connection's first leg, not the onward hop", () => {
    const result = selectSegment(
      [
        seg({
          originAirport: "JFK",
          destinationAirport: "ORD",
          departureAtLocal: "2026-09-04T07:00",
        }),
        seg({
          originAirport: "ORD",
          destinationAirport: "LAX",
          departureAtLocal: "2026-09-04T11:30",
        }),
      ],
      { today: TODAY },
    );
    expect(result.reason).toBe("single_serviced_origin");
    expect(result.chosenOrigin).toBe("JFK");
  });

  it("says so when every serviced departure is in the past", () => {
    const result = selectSegment(
      [
        seg({
          originAirport: "EWR",
          destinationAirport: "DEL",
          departureAtLocal: "2017-12-12T13:15",
        }),
        seg({
          originAirport: "JFK",
          destinationAirport: "BOS",
          departureAtLocal: "2018-01-06T01:35",
        }),
      ],
      { today: TODAY },
    );
    expect(result.reason).toBe("all_serviced_departures_past");
    expect(result.confidence).toBe("low");
    expect(result.chosenOrigin).toBe("EWR");
  });

  it("has nothing to choose from when no segment was read", () => {
    const result = selectSegment([], { today: TODAY });
    expect(result.reason).toBe("no_segments");
    expect(result.chosen).toBeUndefined();
  });

  it("sorts a dateless leg last rather than discarding it", () => {
    const result = selectSegment(
      [
        seg({ originAirport: "JFK", destinationAirport: "SJU" }),
        seg({
          originAirport: "LGA",
          destinationAirport: "ORD",
          departureAtLocal: "2026-09-06T06:00",
        }),
      ],
      { today: TODAY },
    );
    expect(result.chosenOrigin).toBe("LGA");
    expect(result.reason).toBe("earliest_upcoming_serviced_origin");
  });
});

describe("normalizeSegment", () => {
  it("coerces the printed forms airlines actually use", () => {
    const { segment, dropped } = normalizeSegment(
      {
        originAirport: "ewr",
        destinationAirport: "DEL",
        flightNumber: "AI - 101",
        departureAtLocal: "2026-12-12T13:15:00",
        destinationCountry: "in",
      },
      0,
    );
    expect(segment.originAirport).toBe("EWR");
    expect(segment.flightNumber).toBe("AI101");
    expect(segment.airlineIata).toBe("AI");
    expect(segment.departureAtLocal).toBe("2026-12-12T13:15");
    expect(segment.destinationCountry).toBe("IN");
    expect(dropped).toEqual([]);
  });

  it("drops only the bad field, keeping everything that parsed", () => {
    const { segment, dropped } = normalizeSegment(
      { originAirport: "JFK", flightNumber: "UA1189", departureAtLocal: "next Tuesday" },
      2,
    );
    expect(segment.flightNumber).toBe("UA1189");
    expect(segment.originAirport).toBe("JFK");
    expect(segment.departureAtLocal).toBeUndefined();
    expect(dropped).toEqual([
      {
        field: "segments[2].departureAtLocal",
        value: "next Tuesday",
        reason: "not a YYYY-MM-DDTHH:mm local date-time",
      },
    ]);
  });

  it("survives a non-object segment without throwing", () => {
    expect(normalizeSegment("nonsense", 0).segment).toEqual({});
  });
});

describe("deriveScope", () => {
  it("reads domestic and international off the destination country", () => {
    expect(deriveScope({ destinationCountry: "US" })).toBe("domestic");
    expect(deriveScope({ destinationCountry: "PR" })).toBe("domestic");
    expect(deriveScope({ destinationCountry: "IN" })).toBe("international");
  });

  it("stays undefined rather than guessing when the country is unknown", () => {
    expect(deriveScope({ destinationAirport: "DEL" })).toBeUndefined();
    expect(deriveScope(undefined)).toBeUndefined();
  });
});

describe("todayAtServicedAirports", () => {
  it("is the calendar day at the NYC airports, not in UTC", () => {
    // 23:30Z on the 29th is 19:30 in New York — still the 29th there, and
    // the UTC answer happens to agree.
    expect(todayAtServicedAirports(new Date("2026-08-29T23:30:00Z"))).toBe("2026-08-29");
  });

  it("does not roll the day over at 20:00 New York time", () => {
    // 01:30Z on the 30th is 21:30 on the 29th in New York. The old UTC
    // anchor said "2026-08-30" here, which classified a flight leaving
    // later that same evening as already flown.
    expect(todayAtServicedAirports(new Date("2026-08-30T01:30:00Z"))).toBe("2026-08-29");
  });
});
