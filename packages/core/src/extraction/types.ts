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

/**
 * Upload constraints, re-exported from their real home.
 *
 * They live in `../uploads/buckets` because that file declares every bucket's
 * limits in one place AND is import-free, which is what lets a client
 * component read them without dragging `@koolee/db` into a browser bundle.
 * This module imports `AIRPORT_CODES` from `@koolee/db`, so anything that
 * stayed here would be unreachable from the client.
 */
export {
  MAX_TICKET_UPLOAD_BYTES,
  TICKET_UPLOAD_MIME_TYPES,
  type TicketUploadMimeType,
} from "../uploads/buckets";

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

export const TICKET_SCOPES = ["domestic", "international"] as const;
export type TicketExtractionScope = (typeof TICKET_SCOPES)[number];

/** What kind of document this is — a round trip has a leg we must choose. */
export const DOCUMENT_KINDS = ["one_way", "round_trip", "multi_city", "unclear"] as const;
export type TicketDocumentKind = (typeof DOCUMENT_KINDS)[number];

/**
 * ONE flight segment as printed on the document — every leg, unfiltered.
 *
 * Extractors report the whole itinerary and `selectSegment` decides which leg
 * the pickup is for. Asking a model to pre-filter to a single answer is what
 * made a round trip come back as the leg that ARRIVES in New York; see
 * `select-segment.ts`.
 *
 * Airport codes here are ANY IATA code, not only the serviced ones — the
 * origin we cannot serve is exactly what the review form needs in order to
 * explain itself.
 */
export const extractedSegmentSchema = z.object({
  originAirport: airportCode.optional(),
  destinationAirport: airportCode.optional(),
  flightNumber: flightNumber.optional(),
  airlineIata: airlineIata.optional(),
  /** Local wall-clock at the ORIGIN airport, `YYYY-MM-DDTHH:mm`. */
  departureAtLocal: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
    .optional(),
  /** ISO-3166 alpha-2 — what `scope` is derived from, rather than guessed. */
  originCountry: z.string().length(2).optional(),
  destinationCountry: z.string().length(2).optional(),
  /** The model's own doubts about this leg, surfaced in diagnostics. */
  notes: z.string().max(500).optional(),
});

export type ExtractedSegment = z.infer<typeof extractedSegmentSchema>;

/** Why `selectSegment` chose the leg it chose — rendered for the customer. */
export const SEGMENT_SELECTION_REASONS = [
  /** Exactly one leg departs an airport we serve. */
  "single_serviced_origin",
  /** Several did; this is the only one that has not already flown. */
  "earliest_upcoming_serviced_origin",
  /** Several upcoming legs depart airports we serve — a real ambiguity. */
  "ambiguous_serviced_origins",
  /** Every serviced departure on this ticket is in the past. */
  "all_serviced_departures_past",
  /** The itinerary was read, but it departs somewhere we do not serve. */
  "no_serviced_origin",
  /** No flight segments could be read at all. */
  "no_segments",
] as const;
export type SegmentSelectionReason = (typeof SEGMENT_SELECTION_REASONS)[number];

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
  scope: z.enum(TICKET_SCOPES).optional(),
  /** One-way vs round trip — drives the "did you mean the other leg?" offer. */
  documentKind: z.enum(DOCUMENT_KINDS).optional(),
  /** Why this leg was chosen. Absent from extractors that read one leg only. */
  selectionReason: z.enum(SEGMENT_SELECTION_REASONS).optional(),
  /**
   * The origin we read but cannot serve (e.g. SFO). Present ONLY when
   * `departureAirport` is absent — the honest reason the dropdown is blank.
   */
  nonServicedOrigin: airportCode.optional(),
  /**
   * Other legs on the ticket that also depart a serviced airport, offered on
   * the review form as a one-click swap. Never includes the chosen leg.
   */
  alternativeSegments: z.array(extractedSegmentSchema).max(3).optional(),
  /**
   * EVERY leg read off the document, in print order — including the legs that
   * depart airports we do not serve.
   *
   * Display only, and never a swap offer: we cannot collect bags at Heathrow.
   * It exists because a customer whose three-leg itinerary came back as one
   * flight has no way to tell a correct read from a partial one, and "we read
   * three legs and this is the one leaving New York" is the difference
   * between a form that decided something and one that shows its work. Capped
   * at six because the whole draft rides in a 4 KB cookie.
   */
  legs: z.array(extractedSegmentSchema).max(6).optional(),
  /** Index into `legs` of the leg prefilled above, when there is one. */
  chosenLegIndex: z.number().int().min(0).max(5).optional(),
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
/**
 * Everything needed to answer "why did it read my ticket that way?" — one
 * model call's raw output, the segments it found, and the choice made from
 * them.
 *
 * Carried on BOTH outcome branches on purpose: an `unreadable` result is
 * exactly when someone needs to see what came back. It is developer-facing
 * and may contain the customer's itinerary, so the app layer only forwards it
 * to the browser behind an explicit debug flag (never in production) and
 * never writes it to the booking draft cookie.
 */
export interface TicketExtractionAttempt {
  model: string;
  latencyMs: number;
  usage?: { inputTokens: number; outputTokens: number };
  /** Exactly what the model returned, before any coercion of ours. */
  rawToolInput?: unknown;
  /** Set instead when the model answered with prose rather than the tool. */
  rawText?: string;
  error?: string;
  /** Set when this call was a retry on the stronger model, with the trigger. */
  escalatedBecause?: string;
}

export interface TicketExtractionDiagnostics {
  extractor: string;
  attempts: TicketExtractionAttempt[];
  /** Every leg read off the document, after coercion. */
  segments: ExtractedSegment[];
  chosenIndex: number | null;
  selectionReason: SegmentSelectionReason;
  /** Values the model returned that failed their shape check and were dropped. */
  droppedFields: Array<{ field: string; value: unknown; reason: string }>;
  /** The model's free-text account of what was hard to read. */
  readingNotes?: string;
}

export type TicketExtractionOutcome =
  | {
      status: "extracted";
      result: TicketExtractionResult;
      diagnostics?: TicketExtractionDiagnostics;
    }
  | { status: "unreadable"; reason: string; diagnostics?: TicketExtractionDiagnostics };

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
