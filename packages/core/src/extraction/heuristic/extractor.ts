import { extractText, getDocumentProxy } from "unpdf";
import { AIRPORT_CODES, type AirportCode } from "@koolee/db";

import {
  ticketExtractionSchema,
  type TicketExtractionOutcome,
  type TicketExtractionResult,
  type TicketExtractor,
  type TicketFileInput,
} from "../types";

/**
 * The free default: in-process PDF text extraction (unpdf — pure TS, no
 * external service) followed by targeted parsing of the text layer.
 *
 * The one place in `packages/core` allowed to import a pdf library —
 * enforced by ESLint like the Stripe boundary. Everything else depends on
 * the `TicketExtractor` interface.
 *
 * Honesty rules:
 *  - scanned/image PDFs (no text layer) → `unreadable`, never a guess;
 *  - multi-segment itineraries: prefer the segment departing JFK/LGA/EWR;
 *    when that is ambiguous, return LOW confidence rather than picking one;
 *  - a departure airport is only reported when it is one of the serviced
 *    NYC airports (the schema enforces this too).
 */

const AIRLINE_NAMES: Record<string, string> = {
  "UNITED AIRLINES": "UA",
  UNITED: "UA",
  "DELTA AIR LINES": "DL",
  DELTA: "DL",
  "AMERICAN AIRLINES": "AA",
  AMERICAN: "AA",
  JETBLUE: "B6",
  "JETBLUE AIRWAYS": "B6",
};

const MONTHS: Record<string, number> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
  JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
};

/** e.g. "UA 1189", "UA1189" */
const FLIGHT_RE = /\b([A-Z]{2}|[A-Z]\d|\d[A-Z])\s?(\d{1,4})\b/g;
const FLIGHT_LABELED_RE =
  /FLIGHT\s*(?:NO\.?|NUMBER|#|:)?\s*([A-Z]{2}|[A-Z]\d|\d[A-Z])\s?(\d{1,4})\b/;
const PAX_RE =
  /(?:PASSENGER|TRAVELLER|TRAVELER|NAME OF PASSENGER|PASSENGER NAME)\s*[:#]?\s*([A-Z][A-Za-z'.-]+(?:[ /][A-Z][A-Za-z'.-]+){1,3})/;
const DATE_US_RE =
  /\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\.?\s+(\d{1,2}),?\s+(\d{4})/;
const DATE_EU_RE =
  /\b(\d{1,2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\.?\s+(\d{4})/;
const DATE_ISO_RE = /\b(\d{4})-(\d{2})-(\d{2})/;
const TIME_RE = /\b(\d{1,2}):(\d{2})\s*(AM|PM)?\b/;
/** "JFK → SFO", "JFK - SFO", "JFK TO SFO" — an itinerary segment. */
const SEGMENT_RE = /\b([A-Z]{3})\s*(?:→|->|–|-|TO)\s*([A-Z]{3})\b/g;

interface Segment {
  origin: string;
  destination: string;
  index: number;
}

export class HeuristicTicketExtractor implements TicketExtractor {
  readonly name = "heuristic";

  async extract(input: TicketFileInput): Promise<TicketExtractionOutcome> {
    if (input.mimeType !== "application/pdf") {
      // Accepted at the gate for a future OCR path; honestly unreadable now.
      return {
        status: "unreadable",
        reason: `no text extraction for ${input.mimeType} yet`,
      };
    }

    let text: string;
    try {
      const pdf = await getDocumentProxy(new Uint8Array(input.data));
      const extracted = await extractText(pdf, { mergePages: true });
      text = extracted.text.trim();
    } catch {
      return { status: "unreadable", reason: "could not parse the PDF" };
    }

    if (!text) {
      // Scanned/image-only ticket: no text layer to read.
      return { status: "unreadable", reason: "no text layer (scanned ticket?)" };
    }

    const result = parseTicketTextHeuristics(text);
    const parsed = ticketExtractionSchema.safeParse(result);
    if (!parsed.success) {
      return { status: "unreadable", reason: "parsed values failed validation" };
    }
    if (
      !parsed.data.flightNumber &&
      !parsed.data.departureAtLocal &&
      !parsed.data.paxName
    ) {
      return { status: "unreadable", reason: "no flight details found" };
    }
    return { status: "extracted", result: parsed.data };
  }
}

/**
 * Pure text-layer parsing, exported for tests. Successor to the retired
 * `parseTicketText` scaffold, extended with segment awareness and an honest
 * confidence signal.
 */
export function parseTicketTextHeuristics(text: string): TicketExtractionResult {
  const upper = text.toUpperCase();
  const result: TicketExtractionResult = { confidence: "high" };

  /* --- itinerary segments -------------------------------------------- */
  const segments: Segment[] = [];
  for (const match of upper.matchAll(SEGMENT_RE)) {
    if (match[1] && match[2] && match[1] !== match[2]) {
      segments.push({ origin: match[1], destination: match[2], index: match.index ?? 0 });
    }
  }

  const serviced = new Set<string>(AIRPORT_CODES);
  const nycSegments = segments.filter((s) => serviced.has(s.origin));

  let chosen: Segment | undefined;
  if (nycSegments.length === 1) {
    chosen = nycSegments[0];
  } else if (nycSegments.length > 1) {
    // Two different NYC departures on one ticket (e.g. an open-jaw trip):
    // picking one would be a guess. Take the first but say so loudly.
    chosen = nycSegments[0];
    const distinct = new Set(nycSegments.map((s) => `${s.origin}-${s.destination}`));
    if (distinct.size > 1) result.confidence = "low";
  } else if (segments.length > 0) {
    // Segments exist but none departs a serviced airport: report the
    // destination knowledge we have, leave the origin for the user.
    result.confidence = "low";
  }

  if (chosen) {
    result.departureAirport = chosen.origin as AirportCode;
    result.destinationAirport = chosen.destination;
  } else if (segments.length === 0) {
    // No "A → B" structure; fall back to first serviced code mentioned.
    let firstIdx = Number.POSITIVE_INFINITY;
    for (const code of AIRPORT_CODES) {
      const idx = upper.indexOf(code);
      if (idx !== -1 && idx < firstIdx) {
        firstIdx = idx;
        result.departureAirport = code;
      }
    }
  }

  /* --- flight number --------------------------------------------------
   * Prefer a labelled "FLIGHT UA1189"; else, with a chosen segment, the
   * flight code nearest AFTER that segment's position; else first match. */
  const labelled = FLIGHT_LABELED_RE.exec(upper);
  let flight: { iata: string; digits: string } | undefined;
  if (labelled?.[1] && labelled[2]) {
    flight = { iata: labelled[1], digits: labelled[2] };
  } else {
    const all = [...upper.matchAll(FLIGHT_RE)]
      .filter((m) => m[1] && m[2])
      // A bare 3-letter airport code followed by digits is not a flight.
      .filter((m) => !serviced.has(`${m[1]}${m[2]}`.slice(0, 3)));
    let pick = all[0];
    if (chosen && all.length > 1) {
      pick = all.find((m) => (m.index ?? 0) >= chosen.index) ?? all[0];
    }
    if (pick?.[1] && pick[2]) flight = { iata: pick[1], digits: pick[2] };
  }
  if (flight) {
    result.airlineIata = flight.iata;
    result.flightNumber = `${flight.iata}${flight.digits}`;
  }
  // A written-out airline name beats a bare two-letter guess.
  for (const [name, iata] of Object.entries(AIRLINE_NAMES)) {
    if (upper.includes(name)) {
      result.airlineIata = iata;
      if (result.flightNumber && !result.flightNumber.startsWith(iata)) {
        const digits = /(\d{1,4})$/.exec(result.flightNumber)?.[1];
        if (digits) result.flightNumber = `${iata}${digits}`;
      }
      break;
    }
  }

  /* --- departure date + time ------------------------------------------ */
  let y: number | undefined;
  let mo: number | undefined;
  let d: number | undefined;

  const us = DATE_US_RE.exec(upper);
  const eu = DATE_EU_RE.exec(upper);
  const iso = DATE_ISO_RE.exec(upper);
  if (us?.[1] !== undefined && us[2] !== undefined && us[3] !== undefined) {
    mo = MONTHS[us[1]];
    d = Number(us[2]);
    y = Number(us[3]);
  } else if (eu?.[1] !== undefined && eu[2] !== undefined && eu[3] !== undefined) {
    d = Number(eu[1]);
    mo = MONTHS[eu[2]];
    y = Number(eu[3]);
  } else if (iso?.[1] !== undefined && iso[2] !== undefined && iso[3] !== undefined) {
    y = Number(iso[1]);
    mo = Number(iso[2]);
    d = Number(iso[3]);
  }

  const depSection = /DEPART(?:S|URE)?[^\n]*/.exec(upper)?.[0];
  const time = (depSection && TIME_RE.exec(depSection)) || TIME_RE.exec(upper);
  let hh: number | undefined;
  let mm: number | undefined;
  if (time?.[1] !== undefined && time[2] !== undefined) {
    hh = Number(time[1]);
    mm = Number(time[2]);
    if (time[3] === "PM" && hh < 12) hh += 12;
    if (time[3] === "AM" && hh === 12) hh = 0;
  }

  if (y && mo && d && mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
    const pad = (n: number) => String(n).padStart(2, "0");
    result.departureAtLocal = `${y}-${pad(mo)}-${pad(d)}T${pad(hh ?? 12)}:${pad(mm ?? 0)}`;
  }

  /* --- passenger name -------------------------------------------------- */
  const pax = PAX_RE.exec(upper);
  if (pax?.[1] !== undefined) {
    // "ALVAREZ/JORDAN" (ticket convention) → "Jordan Alvarez"
    const raw = pax[1].trim();
    const parts = raw.includes("/") ? raw.split("/").reverse().join(" ") : raw;
    result.paxName = parts
      .toLowerCase()
      .split(/\s+/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  }

  /* --- scope ------------------------------------------------------------ */
  if (upper.includes("INTERNATIONAL")) result.scope = "international";
  else if (upper.includes("DOMESTIC")) result.scope = "domestic";

  return result;
}
