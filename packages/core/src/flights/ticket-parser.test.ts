import { describe, expect, it } from "vitest";

import { parseTicketText } from "./ticket-parser";

/** Mirrors the text layer of the sample e-ticket used by the upload flow. */
const SAMPLE_TICKET = `
UNITED AIRLINES
E-TICKET ITINERARY AND RECEIPT

Passenger: ALVAREZ/JORDAN
Confirmation: KX7Q2M
Ticket number: 016 2401234567

Flight: UA 1189                    Class: Economy (Q)
From: New York, NY (JFK) Terminal 7
To:   San Francisco, CA (SFO)
Date: Mar 14, 2026
Departs: 5:45 PM     Arrives: 9:12 PM
Domestic

Baggage allowance: 2 checked bags
`;

describe("parseTicketText", () => {
  it("parses the sample United e-ticket", () => {
    const parsed = parseTicketText(SAMPLE_TICKET);
    expect(parsed.flightNumber).toBe("UA1189");
    expect(parsed.airlineIata).toBe("UA");
    expect(parsed.departureAirport).toBe("JFK");
    expect(parsed.departureAtLocal).toBe("2026-03-14T17:45");
    expect(parsed.paxName).toBe("Jordan Alvarez");
    expect(parsed.scope).toBe("domestic");
  });

  it("handles Delta with EU-style date and plain passenger name", () => {
    const parsed = parseTicketText(`
      DELTA AIR LINES
      Passenger name: Maya Chen
      Flight DL 405 — 22 Nov 2026, departs 08:30 from LGA
      International
    `);
    expect(parsed.flightNumber).toBe("DL405");
    expect(parsed.airlineIata).toBe("DL");
    expect(parsed.departureAirport).toBe("LGA");
    expect(parsed.departureAtLocal).toBe("2026-11-22T08:30");
    expect(parsed.paxName).toBe("Maya Chen");
    expect(parsed.scope).toBe("international");
  });

  it("parses ISO dates and EWR departures", () => {
    const parsed = parseTicketText(
      "Flight: B6 1023 EWR to FLL 2026-07-04 06:15 traveler: SMITH/ALEX",
    );
    expect(parsed.flightNumber).toBe("B61023");
    expect(parsed.departureAirport).toBe("EWR");
    expect(parsed.departureAtLocal).toBe("2026-07-04T06:15");
  });

  it("returns an empty object for unusable text", () => {
    const parsed = parseTicketText("nothing to see here");
    expect(parsed.flightNumber).toBeUndefined();
    expect(parsed.departureAtLocal).toBeUndefined();
    expect(parsed.paxName).toBeUndefined();
  });

  it("never throws on adversarial input", () => {
    expect(() => parseTicketText("")).not.toThrow();
    expect(() => parseTicketText("A".repeat(100_000))).not.toThrow();
    expect(() => parseTicketText("FLIGHT 99999999 13:99 XX/YY")).not.toThrow();
  });
});
