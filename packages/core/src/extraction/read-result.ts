import type { SegmentSelection } from "./select-segment";
import { deriveScope, type DroppedField } from "./select-segment";
import type {
  ExtractedSegment,
  ExtractionConfidence,
  TicketDocumentKind,
  TicketExtractionAttempt,
  TicketExtractionDiagnostics,
  TicketExtractionOutcome,
  TicketExtractionResult,
  TicketExtractionScope,
} from "./types";

/**
 * What every extractor produces before it becomes an outcome, and the one
 * place that turns it into one.
 *
 * Both adapters used to assemble their own `TicketExtractionResult`, and only
 * the Claude one did it correctly — the heuristic wrote a departure airport
 * straight out of its own parse, skipping `selectSegment` entirely, so it
 * could neither report a second leg nor offer one as a swap. Sharing the
 * assembly means an extractor's job stops at READING; which leg the pickup is
 * for, what reaches the airport dropdown, and what the review form is offered
 * as an alternative are decided once, here, for every adapter.
 */
/** Matches `ticketExtractionSchema.legs`’ cap — the 4 KB cookie budget. */
const MAX_LEGS = 6;

export interface ReadItinerary {
  /** Every leg read off the document, in the order it was read. */
  segments: ExtractedSegment[];
  dropped: DroppedField[];
  selection: SegmentSelection;
  paxName?: string;
  documentKind?: TicketDocumentKind;
  readingNotes?: string;
  /**
   * A domestic/international reading taken from the document as a whole —
   * the word printed on it, not a per-leg fact. Used ONLY when the chosen
   * leg's own destination country is unknown, which is the case for every
   * text-layer read: the heuristic can see "INTERNATIONAL TRAVEL DOCUMENTS
   * REQUIRED" on the page and cannot see which leg it applies to. The model
   * adapter reports countries per segment and never needs this.
   */
  scope?: TicketExtractionScope;
}

export function assembleOutcome(args: {
  extractor: string;
  read: ReadItinerary;
  attempts: TicketExtractionAttempt[];
  /**
   * Overrides `selection.confidence`. Used by the heuristic, which is never
   * entitled to "high" whatever the selection says — see its module comment.
   */
  confidence?: ExtractionConfidence;
  /** Used when the result is empty and the caller knows why. */
  unreadableReason?: string;
}): TicketExtractionOutcome {
  const read = args.read;
  const selection = read.selection;

  const diagnostics: TicketExtractionDiagnostics = {
    extractor: args.extractor,
    attempts: args.attempts,
    segments: read.segments,
    chosenIndex: selection.chosenIndex,
    selectionReason: selection.reason,
    droppedFields: read.dropped,
    ...(read.readingNotes ? { readingNotes: read.readingNotes } : {}),
  };

  const chosen = selection.chosen;
  const scope = deriveScope(chosen) ?? read.scope;
  const result: TicketExtractionResult = {
    ...(chosen?.flightNumber ? { flightNumber: chosen.flightNumber } : {}),
    ...(chosen?.airlineIata ? { airlineIata: chosen.airlineIata } : {}),
    ...(chosen?.departureAtLocal ? { departureAtLocal: chosen.departureAtLocal } : {}),
    // Only a SERVICED origin ever reaches the form; `selectSegment` has
    // already guaranteed it, and `nonServicedOrigin` carries the rest.
    ...(selection.chosenOrigin ? { departureAirport: selection.chosenOrigin } : {}),
    ...(chosen?.destinationAirport
      ? { destinationAirport: chosen.destinationAirport }
      : {}),
    ...(read.paxName ? { paxName: read.paxName } : {}),
    ...(scope ? { scope } : {}),
    ...(read.documentKind ? { documentKind: read.documentKind } : {}),
    ...(selection.nonServicedOrigin
      ? { nonServicedOrigin: selection.nonServicedOrigin }
      : {}),
    ...(selection.alternatives.length > 0
      ? { alternativeSegments: selection.alternatives.slice(0, 3) }
      : {}),
    // The whole itinerary, display only. `chosenLegIndex` is re-derived
    // against the TRUNCATED list, so it never points past the end of what
    // the form will render.
    ...(read.segments.length > 0 ? { legs: read.segments.slice(0, MAX_LEGS) } : {}),
    ...(selection.chosenIndex !== null && selection.chosenIndex < MAX_LEGS
      ? { chosenLegIndex: selection.chosenIndex }
      : {}),
    selectionReason: selection.reason,
    confidence: args.confidence ?? selection.confidence,
  };

  // Nothing at all to show: no leg, no name. That is the manual-entry path.
  // A ticket out of an airport we do not serve is NOT this case — it has a
  // reason worth telling the customer, and the review form tells them.
  if (!result.paxName && !result.flightNumber && !result.departureAtLocal) {
    const reason =
      args.unreadableReason ??
      (read.segments.length === 0 ? "no flight details found" : "no usable segment");
    return { status: "unreadable", reason, diagnostics };
  }
  return { status: "extracted", result, diagnostics };
}

/**
 * Ticket convention prints `SURNAME/GIVEN`, often with a title and an
 * `(Adult)` suffix. Shared by both adapters: the heuristic used to have its
 * own version that left the title in the middle of the reordered name
 * ("Jordan Mr Alvarez"), which is the sort of thing a customer corrects
 * silently and an agent reads at the door.
 *
 * Returns undefined for anything unusable, INCLUDING text that is plainly a
 * heading rather than a person — a regex anchored on the word "passenger"
 * matches "PASSENGERS DETAILS" and the cancellation terms' "per passenger
 * basis. In case of amendment" just as happily as it matches a name.
 *
 * The label words themselves ("passenger", "traveller") are deliberately NOT
 * in the list: the caller has already consumed the label, and Traveler is a
 * surname on one of the fixtures.
 */
const HEADING_WORDS = new Set([
  "ADULT",
  "AMENDMENT",
  "ARRIVAL",
  "ARRIVE",
  "BAGGAGE",
  "BASIS",
  "BOOKING",
  "CASE",
  "CHILD",
  "CLASS",
  "CONFIRMATION",
  "DEPARTURE",
  "DETAIL",
  "DETAILS",
  "ETICKET",
  "FARE",
  "FLIGHT",
  "INFANT",
  "INFORMATION",
  "ITINERARY",
  "NAME",
  "NUMBER",
  "PNR",
  "RECEIPT",
  "REF",
  "REFERENCE",
  "SEAT",
  "SEGMENT",
  "TICKET",
]);

/**
 * True when a token can be part of a printed name: it starts with a capital
 * and is not one of the labels that sit beside names on e-tickets.
 *
 * Used to TRUNCATE a candidate rather than reject it, because the row a name
 * is printed on usually carries the next label too — "Passenger: DANA
 * WHITFIELD Booking Ref: QX7T2M" is one row on a real fixture, and the name
 * ends where "Booking" begins.
 */
export function isNameWord(word: string): boolean {
  const letters = word.replace(/[^A-Za-z]/g, "");
  if (letters.length === 0) return false;
  if (!/^[A-Z]/.test(word.replace(/^[("']+/, ""))) return false;
  if (HEADING_WORDS.has(letters.toUpperCase())) return false;
  // A token carrying digits or a separator that is not part of a name
  // ("·", "1189", "SFO-JFK") ends the name.
  return /^[A-Za-z][A-Za-z'’.-]*\/?[A-Za-z'’.-]*$/.test(word.replace(/[,;]$/, ""));
}

/** The leading run of name-shaped words, at most four of them. */
export function takeNameWords(text: string): string {
  const words: string[] = [];
  for (const word of text.trim().split(/\s+/)) {
    if (!isNameWord(word)) break;
    words.push(word.replace(/[,;]$/, ""));
    if (words.length === 4) break;
  }
  return words.join(" ");
}

export function cleanPaxName(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const stripped = raw
    .replace(/\((?:adult|child|infant)\)/gi, "")
    .replace(/\b(mr|mrs|ms|miss|dr|master)\b\.?/gi, "")
    .trim();
  const ordered = stripped.includes("/")
    ? stripped.split("/").reverse().join(" ")
    : stripped;
  const words = ordered.split(/\s+/).filter(Boolean);
  if (words.length === 0) return undefined;
  // One heading word anywhere means this is a label, not a person. Refusing
  // the whole string is right: half a heading is not half a name.
  if (words.some((w) => HEADING_WORDS.has(w.replace(/[^A-Za-z]/g, "").toUpperCase()))) {
    return undefined;
  }
  const name = words
    .map((w) =>
      /[a-z]/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(),
    )
    .join(" ");
  return name.length > 120 ? undefined : name;
}
