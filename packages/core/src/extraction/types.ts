import { z } from "zod";
import { AIRPORT_CODES } from "@koolee/db";

/**
 * Ticket extraction — the seam, mirroring the `PaymentProvider` pattern.
 *
 * HARD RULE (non-negotiable): extracted values NEVER persist directly to
 * booking fields. An extraction result is a PREFILL for the editable review
 * form (the flight step); only the values the user confirms on that form
 * persist anywhere. On failure or low confidence the UI says "we couldn't
 * read this — please enter details manually" and falls back to manual entry.
 * Never present a guess as a confirmed fact.
 *
 * Nothing outside the adapter directories imports pdf/Anthropic libraries —
 * enforced by ESLint exactly like the Stripe boundary.
 */

/** Upload constraints, shared by the route handler and its tests. */
export const MAX_TICKET_UPLOAD_BYTES = 10 * 1024 * 1024;
/**
 * PDF is what airlines email. Images are accepted at the gate for a future
 * OCR path — the heuristic extractor simply reports "unreadable" for them.
 */
export const TICKET_UPLOAD_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
] as const;

export type TicketUploadMimeType = (typeof TICKET_UPLOAD_MIME_TYPES)[number];

/* ------------------------------------------------------------------ */
/* Extraction result schema                                            */
/* ------------------------------------------------------------------ */

/** IATA airline designator: two chars, letters or letter+digit (B6, 9W). */
const airlineIata = z
  .string()
  .regex(/^([A-Z]{2}|[A-Z]\d|\d[A-Z])$/, "not an IATA airline code");

/** e.g. UA1189 — designator + 1-4 digits. */
const flightNumber = z
  .string()
  .regex(/^([A-Z]{2}|[A-Z]\d|\d[A-Z])\d{1,4}$/, "not an IATA flight number");

/** IATA 3-letter airport code. */
const airportCode = z.string().regex(/^[A-Z]{3}$/, "not an IATA airport code");

/** NYC-departure product: only these origins can proceed to booking. */
const servicedOrigin = z.enum(AIRPORT_CODES);

export const CONFIDENCE_LEVELS = ["high", "low"] as const;
export type ExtractionConfidence = (typeof CONFIDENCE_LEVELS)[number];

/**
 * What an extractor may return. Every field optional — extraction is partial
 * by nature — and every value is a CANDIDATE, not a fact. The confirm step
 * (the flight review form's server action) applies the strict validation:
 * origin must be one of the serviced NYC airports, flight number must parse,
 * departure must be in the future, etc.
 */
export const ticketExtractionSchema = z.object({
  airlineIata: airlineIata.optional(),
  flightNumber: flightNumber.optional(),
  /** Local wall-clock at the departure airport, `YYYY-MM-DDTHH:mm`. */
  departureAtLocal: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
    .optional(),
  /**
   * Departure airport. Extractors may only emit a SERVICED origin here
   * (JFK/LGA/EWR) — a ticket departing anywhere else is reported without an
   * origin, and the review form makes the user choose.
   */
  departureAirport: servicedOrigin.optional(),
  /** Destination airport, informational (drives the domestic/intl guess). */
  destinationAirport: airportCode.optional(),
  paxName: z.string().min(1).max(120).optional(),
  scope: z.enum(["domestic", "international"]).optional(),
  /**
   * Overall confidence. "low" means the review form flags every prefilled
   * field for the customer's attention (e.g. an ambiguous multi-segment
   * itinerary). Extractors must prefer low confidence over guessing.
   */
  confidence: z.enum(CONFIDENCE_LEVELS),
});

export type TicketExtractionResult = z.infer<typeof ticketExtractionSchema>;

/* ------------------------------------------------------------------ */
/* The extractor interface                                             */
/* ------------------------------------------------------------------ */

export interface TicketFileInput {
  /** Raw uploaded bytes. */
  data: Uint8Array;
  mimeType: string;
  fileName?: string;
}

/**
 * Extraction never throws for content reasons — a scanned PDF, a malformed
 * model response, or an API failure all resolve to `unreadable`, which the
 * UI renders as the manual-entry fallback.
 */
export type TicketExtractionOutcome =
  | { status: "extracted"; result: TicketExtractionResult }
  | { status: "unreadable"; reason: string };

export interface TicketExtractor {
  /** "fake" | "heuristic" | "claude" — recorded for observability. */
  readonly name: string;
  extract(input: TicketFileInput): Promise<TicketExtractionOutcome>;
}

/** True when the result has anything worth prefilling at all. */
export function hasExtractedFields(result: TicketExtractionResult): boolean {
  return Boolean(
    result.flightNumber ??
      result.airlineIata ??
      result.departureAtLocal ??
      result.departureAirport ??
      result.paxName,
  );
}
