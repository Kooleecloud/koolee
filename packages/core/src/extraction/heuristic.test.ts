import { describe, expect, it } from "vitest";

import { HeuristicTicketExtractor } from "./heuristic";
import { makePdf } from "./test-utils/make-pdf";

/**
 * Heuristic extractor against synthetic ticket PDFs (generated in-process —
 * see make-pdf.ts): a typical single-segment confirmation, a multi-segment
 * itinerary preferring the NYC departure, an ambiguous multi-segment that
 * must come back LOW confidence, and a no-text-layer (scanned) ticket.
 */

const extractor = new HeuristicTicketExtractor();

function pdfInput(lines: string[]) {
  return { data: makePdf(lines), mimeType: "application/pdf" };
}

describe("HeuristicTicketExtractor", () => {
  it("reads a typical single-segment airline confirmation", async () => {
    const outcome = await extractor.extract(
      pdfInput([
        "UNITED AIRLINES - ETICKET ITINERARY AND RECEIPT",
        "PASSENGER NAME: ALVAREZ/JORDAN",
        "FLIGHT UA 1189",
        "JFK TO SFO",
        "DEPARTS SEP 1, 2026 6:30 PM",
        "CONFIRMATION CODE ABC123 - DOMESTIC",
      ]),
    );

    expect(outcome.status).toBe("extracted");
    if (outcome.status !== "extracted") return;
    expect(outcome.result.flightNumber).toBe("UA1189");
    expect(outcome.result.airlineIata).toBe("UA");
    expect(outcome.result.departureAirport).toBe("JFK");
    expect(outcome.result.destinationAirport).toBe("SFO");
    expect(outcome.result.departureAtLocal).toBe("2026-09-01T18:30");
    expect(outcome.result.paxName).toBe("Jordan Alvarez");
    expect(outcome.result.scope).toBe("domestic");
    expect(outcome.result.confidence).toBe("high");
  });

  it("prefers the segment departing a serviced NYC airport on a multi-segment itinerary", async () => {
    const outcome = await extractor.extract(
      pdfInput([
        "DELTA AIR LINES ITINERARY",
        "PASSENGER: SMITH/ALEX",
        "SEGMENT 1: BOS TO JFK  DL 405",
        "SEGMENT 2: JFK TO LHR  DL 2",
        "DEPARTURE: 14 MAR 2026 17:45",
        "INTERNATIONAL TRAVEL DOCUMENTS REQUIRED",
      ]),
    );

    expect(outcome.status).toBe("extracted");
    if (outcome.status !== "extracted") return;
    // The BOS→JFK positioning segment is NOT the pickup segment.
    expect(outcome.result.departureAirport).toBe("JFK");
    expect(outcome.result.destinationAirport).toBe("LHR");
    expect(outcome.result.flightNumber).toBe("DL2");
    expect(outcome.result.scope).toBe("international");
  });

  it("returns LOW confidence when two different NYC departures make the pickup segment ambiguous", async () => {
    const outcome = await extractor.extract(
      pdfInput([
        "MULTI-CITY ITINERARY",
        "PASSENGER: DOE/SAM",
        "SEGMENT 1: JFK TO MIA  AA 100",
        "SEGMENT 2: EWR TO ORD  AA 200",
        "DEPARTS JUN 2, 2026 9:00 AM",
      ]),
    );

    expect(outcome.status).toBe("extracted");
    if (outcome.status !== "extracted") return;
    // Ambiguity is reported, never silently guessed away.
    expect(outcome.result.confidence).toBe("low");
  });

  it("reports a scanned ticket (no text layer) as unreadable — never a guess", async () => {
    const outcome = await extractor.extract(pdfInput([]));
    expect(outcome).toEqual({
      status: "unreadable",
      reason: "no text layer (scanned ticket?)",
    });
  });

  it("reports images as unreadable for now (future OCR path)", async () => {
    const outcome = await extractor.extract({
      data: new Uint8Array([0xff, 0xd8, 0xff]),
      mimeType: "image/jpeg",
    });
    expect(outcome.status).toBe("unreadable");
  });

  it("reports a PDF with no flight details as unreadable rather than half-empty", async () => {
    const outcome = await extractor.extract(
      pdfInput(["THANK YOU FOR YOUR PURCHASE", "ORDER TOTAL 45.00"]),
    );
    expect(outcome.status).toBe("unreadable");
  });
});
