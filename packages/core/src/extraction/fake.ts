import {
  type TicketExtractionOutcome,
  type TicketExtractionResult,
  type TicketExtractor,
  type TicketFileInput,
} from "./types";

/**
 * Deterministic extractor for tests and credential-less dev, mirroring
 * `FakePaymentProvider`: fixed fixture output, no I/O, controllable failure.
 */

export const FAKE_EXTRACTION_RESULT: TicketExtractionResult = {
  airlineIata: "UA",
  flightNumber: "UA1189",
  departureAtLocal: "2026-09-01T18:30",
  departureAirport: "JFK",
  destinationAirport: "SFO",
  paxName: "Jordan Alvarez",
  scope: "domestic",
  documentKind: "one_way",
  selectionReason: "single_serviced_origin",
  confidence: "high",
};

export class FakeTicketExtractor implements TicketExtractor {
  readonly name = "fake";

  /** Set to simulate the manual-entry fallback path. */
  failWith: string | null = null;
  /** Override the fixture per test. */
  result: TicketExtractionResult;
  /** Inputs seen, for assertions. */
  readonly calls: TicketFileInput[] = [];

  constructor(result: TicketExtractionResult = FAKE_EXTRACTION_RESULT) {
    this.result = result;
  }

  extract(input: TicketFileInput): Promise<TicketExtractionOutcome> {
    this.calls.push(input);
    if (this.failWith !== null) {
      return Promise.resolve({ status: "unreadable", reason: this.failWith });
    }
    return Promise.resolve({ status: "extracted", result: this.result });
  }
}
