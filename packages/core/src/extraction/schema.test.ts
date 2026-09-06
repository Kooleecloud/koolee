import { describe, expect, it } from "vitest";

import { hasExtractedFields, ticketExtractionSchema } from "./types";

describe("ticketExtractionSchema", () => {
  it("accepts a complete, well-formed result", () => {
    const parsed = ticketExtractionSchema.safeParse({
      airlineIata: "UA",
      flightNumber: "UA1189",
      departureAtLocal: "2026-09-01T18:30",
      departureAirport: "JFK",
      destinationAirport: "SFO",
      paxName: "Jordan Alvarez",
      scope: "domestic",
      confidence: "high",
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts a partial result — extraction is partial by nature", () => {
    const parsed = ticketExtractionSchema.safeParse({
      flightNumber: "B61234",
      confidence: "low",
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.departureAirport).toBeUndefined();
  });

  it("requires the confidence signal", () => {
    expect(ticketExtractionSchema.safeParse({ flightNumber: "UA1" }).success).toBe(false);
  });

  it("rejects garbage field shapes", () => {
    const cases = [
      { confidence: "high", airlineIata: "UNITED" }, // not a 2-char code
      { confidence: "high", flightNumber: "FLIGHT 12" },
      { confidence: "high", departureAtLocal: "tomorrow at noon" },
      { confidence: "high", destinationAirport: "SFOX" },
      { confidence: "maybe" },
      { confidence: "high", scope: "transatlantic" },
    ];
    for (const bad of cases) {
      expect(ticketExtractionSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(
        false,
      );
    }
  });

  it("only serviced NYC airports are valid origins — LAX cannot proceed", () => {
    const parsed = ticketExtractionSchema.safeParse({
      confidence: "high",
      departureAirport: "LAX",
    });
    expect(parsed.success).toBe(false);

    for (const code of ["JFK", "LGA", "EWR"]) {
      expect(
        ticketExtractionSchema.safeParse({ confidence: "high", departureAirport: code })
          .success,
      ).toBe(true);
    }
  });

  it("hasExtractedFields distinguishes empty from useful results", () => {
    expect(hasExtractedFields({ confidence: "low" })).toBe(false);
    expect(hasExtractedFields({ confidence: "low", destinationAirport: "SFO" })).toBe(
      false,
    );
    expect(hasExtractedFields({ confidence: "low", flightNumber: "UA1189" })).toBe(true);
    expect(hasExtractedFields({ confidence: "high", paxName: "A B" })).toBe(true);
  });
});
