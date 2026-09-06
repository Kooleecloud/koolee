import { extractText, getDocumentProxy } from "unpdf";

import {
  assembleOutcome,
  cleanPaxName,
  takeNameWords,
  type ReadItinerary,
} from "../read-result";
import {
  normalizeSegment,
  selectSegment,
  todayAtServicedAirports,
  type DroppedField,
} from "../select-segment";
import type {
  ExtractedSegment,
  TicketDocumentKind,
  TicketExtractionScope,
  TicketExtractionOutcome,
  TicketExtractor,
  TicketFileInput,
} from "../types";

/**
 * The free default: in-process PDF text extraction (unpdf — pure TS, no
 * external service) followed by targeted parsing of the text layer.
 *
 * The one place in `packages/core` allowed to import a pdf library —
 * enforced by ESLint like the Stripe boundary. Everything else depends on
 * the `TicketExtractor` interface.
 *
 * **This extractor is never confident.** Every result it returns carries
 * `confidence: "low"`, so the review form flags every prefilled field, and
 * that is a statement about the METHOD rather than about any one document.
 * Run over twelve fixtures it previously reported "high" on seven of the ten
 * it read, and was wrong on five of those seven: it read a printed DURATION
 * ("15:30 Hrs") as a departure time, paired a date-of-issue with a departure
 * time from a different row, and answered "Basis. In Case Of" when asked for
 * the passenger — each with the same confidence as a correct read. A text
 * layer with no layout is not a document the way a model reads one, and
 * pretending otherwise is what put wrong times in front of customers.
 *
 * Honesty rules, all of them enforced below:
 *  - scanned/image PDFs (no text layer) → `unreadable`, never a guess;
 *  - EVERY leg the text layer shows is reported, and `selectSegment` — the
 *    same deterministic chooser the Claude adapter uses — picks the one the
 *    pickup is for. This adapter never writes a departure airport of its own;
 *  - a departure time is emitted ONLY when a date and a clock time are bound
 *    together on the same printed row. An unpaired date is dropped rather
 *    than completed with a midday guess, which is what the old code did;
 *  - values printed as durations, and dates labelled as issue/booking dates,
 *    are refused outright;
 *  - a passenger name has to survive `cleanPaxName`, which rejects headings.
 */

const AIRLINE_NAMES: Record<string, string> = {
  "UNITED AIRLINES": "UA",
  UNITED: "UA",
  "DELTA AIR LINES": "DL",
  DELTA: "DL",
  "AMERICAN AIRLINES": "AA",
  AMERICAN: "AA",
  "AIR INDIA": "AI",
  JETBLUE: "B6",
  "JETBLUE AIRWAYS": "B6",
};

const MONTHS: Record<string, number> = {
  JAN: 1,
  FEB: 2,
  MAR: 3,
  APR: 4,
  MAY: 5,
  JUN: 6,
  JUL: 7,
  AUG: 8,
  SEP: 9,
  OCT: 10,
  NOV: 11,
  DEC: 12,
};

/**
 * "JFK → SFO", "JFK - SFO", "JFK TO SFO" — a route printed on one row.
 *
 * The `TO` form needs REAL whitespace on both sides. Allowing zero-width
 * spacing makes "CUSTOMER" a route from CUS to MER, which is where a third
 * leg on the Yatra fixture came from.
 */
const ROUTE_RE = /\b([A-Z]{3})(?:\s*(?:→|->|–|—|-)\s*|\s+TO\s+)([A-Z]{3})\b/g;
/** "From: New York John F Kennedy Intl (JFK) Terminal 4" */
const FROM_RE = /\bFROM\s*:?[^\n(]*\(([A-Z]{3})\)/;
const TO_RE = /\bTO\s*:?[^\n(]*\(([A-Z]{3})\)/;

/** A labelled flight number: the only form trusted without a route nearby. */
const FLIGHT_LABELED_RE =
  /\bFLIGHT\s*(?:NO\.?|NUMBER|#)?\s*:?\s*([A-Z]{2}|[A-Z]\d|\d[A-Z])\s*-?\s*(\d{1,4})\b/;
/** Any flight-number-shaped token, used only inside a segment's own window. */
const FLIGHT_LOOSE_RE = /\b([A-Z]{2}|[A-Z]\d|\d[A-Z])\s*-?\s*(\d{1,4})\b/g;
/**
 * What follows a number decides whether it was ever a flight number. A
 * baggage line reading "NA 2 piece (Free)" is shaped exactly like "AI 144",
 * and it is how the Yatra fixture came back as flight NA2.
 */
const UNIT_SUFFIX_RE =
  /^\s*(PIECES?|PCS?|KG|KGS|LBS?|HRS?|HOURS?|MINS?|ADT|CHD|INF|BAGS?|SEATS?|RS\.?|USD|EUR|GBP)\b/;

const PAX_LABEL_RE =
  /\b(?:NAME OF PASSENGER|PASSENGER NAME|PASSENGER|TRAVELLER|TRAVELER)S?\s*[:#]?\s*(.+)/i;

const DATE_US_RE =
  /\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\.?\s+(\d{1,2}),?\s+(\d{4})\b/;
const DATE_EU_RE =
  /\b(\d{1,2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\.?\s+(\d{4})\b/;
const DATE_ISO_RE = /\b(\d{4})-(\d{2})-(\d{2})\b/;
const TIME_RE = /\b(\d{1,2}):(\d{2})\s*(AM|PM)?/g;

/**
 * A clock time is refused when the words around it say it is not one.
 * `15:30 Hrs` is a real departure on one document and a flight duration on
 * the next, so the discriminator has to be the LABEL, not the suffix.
 */
const DURATION_NEAR_RE =
  /\b(DURATION|TOTAL\s+JOURNEY|JOURNEY\s+TIME|ELAPSED|LAYOVER|NON\s*STOP)\b/;
/** A date is refused when its row says it is not a departure date. */
const NON_DEPARTURE_DATE_RE =
  /\b(ISSUE[D]?|ISSUING|BOOKING|BOOKED|PURCHASE[D]?|VALID|EXPIR|PRINTED)\b/;
/** A row that names an arrival is not a departure row. */
const ARRIVAL_ROW_RE = /\bARRIV(?:E|ES|AL)\b/;
/** The label that lets a time on a LATER row belong to an earlier date. */
const DEPART_LABEL_RE = /\bDEPART(?:S|URE|ING)?\b/;

/** How many rows after a route header a leg's own details may sit. */
const WINDOW_AFTER = 6;
const WINDOW_BEFORE = 2;

interface RouteAnchor {
  origin: string;
  destination: string;
  line: number;
}

export class HeuristicTicketExtractor implements TicketExtractor {
  readonly name = "heuristic";

  private readonly now: () => Date;

  constructor(options: { now?: () => Date } = {}) {
    this.now = options.now ?? (() => new Date());
  }

  async extract(input: TicketFileInput): Promise<TicketExtractionOutcome> {
    if (input.mimeType !== "application/pdf") {
      // Accepted at the gate for a future OCR path; honestly unreadable now.
      // The Claude adapter reads photographed tickets natively — this one is
      // the reason an environment without an API key cannot.
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

    const read = readTicketText(text, todayAtServicedAirports(this.now()));
    return assembleOutcome({
      extractor: this.name,
      read,
      attempts: [],
      // Never "high", whatever the selection concluded. See the module note.
      confidence: "low",
    });
  }
}

/**
 * Pure text-layer parsing, exported for tests. Reads EVERY leg it can find and
 * leaves the choice to `selectSegment`, exactly like the Claude adapter.
 */
export function readTicketText(text: string, today: string): ReadItinerary {
  const lines = text.split(/\r?\n/);
  const upperLines = lines.map((l) => l.toUpperCase());

  const dropped: DroppedField[] = [];
  const anchors = findRoutes(upperLines);

  const raw = anchors.map((anchor, index) => {
    // A leg's window never reaches back past the previous leg's row, or the
    // second leg of a round trip reads the first leg's flight number: both
    // legs of the JFK/LAX fixture came back as DL411.
    const previous = anchors[index - 1]?.line ?? -1;
    const next = anchors[index + 1]?.line ?? upperLines.length;
    const from = Math.max(0, previous + 1, anchor.line - WINDOW_BEFORE);
    const to = Math.min(
      next <= anchor.line ? upperLines.length : next,
      anchor.line + WINDOW_AFTER + 1,
    );
    const window = upperLines
      .slice(from, Math.max(to, anchor.line + 1))
      .map((l, i) => ({ text: l, line: from + i }));

    return {
      originAirport: anchor.origin,
      destinationAirport: anchor.destination,
      ...flightFor(window),
      ...departureFor(window),
    };
  });

  const segments: ExtractedSegment[] = [];
  for (const [index, entry] of raw.entries()) {
    const normalized = normalizeSegment(entry, index);
    dropped.push(...normalized.dropped);
    segments.push(normalized.segment);
  }

  const selection = selectSegment(segments, { today });
  const scope = scopeFor(upperLines.join("\n"));
  const paxName = paxNameFor(lines);
  const documentKind = documentKindFor(segments);
  const readingNotes = notesFor(segments, anchors.length);

  return {
    segments,
    dropped,
    selection,
    ...(scope ? { scope } : {}),
    ...(paxName ? { paxName } : {}),
    ...(documentKind ? { documentKind } : {}),
    ...(readingNotes ? { readingNotes } : {}),
  };
}

/* ------------------------------------------------------------------ */
/* Pure helpers                                                        */
/* ------------------------------------------------------------------ */

/**
 * Every route printed on the document, in print order, each pinned to the row
 * it was found on so its own flight number and time can be looked for nearby.
 *
 * Two forms: `JFK - LHR` on one row, and a `From: … (JFK)` row followed within
 * three rows by a `To: … (LHR)`. Duplicates are collapsed on origin +
 * destination — a baggage table repeating "EWR - DEL" is the same leg.
 */
function findRoutes(upperLines: string[]): RouteAnchor[] {
  const found: RouteAnchor[] = [];
  const seen = new Set<string>();

  const add = (origin: string, destination: string, line: number) => {
    if (origin === destination) return;
    const key = `${origin}-${destination}`;
    if (seen.has(key)) return;
    seen.add(key);
    found.push({ origin, destination, line });
  };

  upperLines.forEach((line, index) => {
    const from = FROM_RE.exec(line);
    if (from?.[1]) {
      for (
        let ahead = index;
        ahead <= index + 3 && ahead < upperLines.length;
        ahead += 1
      ) {
        const to = TO_RE.exec(upperLines[ahead]!);
        if (to?.[1] && !(ahead === index && to.index < from.index)) {
          add(from[1], to[1], index);
          break;
        }
      }
    }
    ROUTE_RE.lastIndex = 0;
    for (const match of line.matchAll(ROUTE_RE)) {
      if (match[1] && match[2]) add(match[1], match[2], index);
    }
  });

  return found;
}

/** The flight number printed beside THIS leg, or nothing. */
function flightFor(window: Array<{ text: string; line: number }>): {
  flightNumber?: string;
  airlineIata?: string;
} {
  const airlineFromName = Object.entries(AIRLINE_NAMES).find(([name]) =>
    window.some((row) => row.text.includes(name)),
  )?.[1];

  for (const row of window) {
    const labelled = FLIGHT_LABELED_RE.exec(row.text);
    if (labelled?.[1] && labelled[2]) {
      return { flightNumber: `${labelled[1]}${labelled[2]}`, airlineIata: labelled[1] };
    }
  }

  // Unlabelled. Two guards, both from fixtures that got this wrong: the
  // designator must agree with any airline the document spells out inside
  // this leg's own window, and the number must not be a quantity.
  for (const row of window) {
    FLIGHT_LOOSE_RE.lastIndex = 0;
    for (const match of row.text.matchAll(FLIGHT_LOOSE_RE)) {
      const [, code, digits] = match;
      if (!code || !digits) continue;
      if (airlineFromName && code !== airlineFromName) continue;
      const after = row.text.slice((match.index ?? 0) + match[0].length);
      if (UNIT_SUFFIX_RE.test(after)) continue;
      return { flightNumber: `${code}${digits}`, airlineIata: code };
    }
  }

  return airlineFromName ? { airlineIata: airlineFromName } : {};
}

/**
 * `YYYY-MM-DDTHH:mm` for THIS leg, and only when a date and a clock time were
 * printed on the SAME row.
 *
 * Splitting them is how the old parser produced `2026-08-12T07:45` for a
 * flight departing September 14: August 12 was the date of issue, printed at
 * the top of the document, and 07:45 was the first clock time anywhere below
 * it. A row carrying both is the only evidence that they describe one event.
 */
function departureFor(window: Array<{ text: string; line: number }>): {
  departureAtLocal?: string;
} {
  for (const [index, row] of window.entries()) {
    if (NON_DEPARTURE_DATE_RE.test(row.text)) continue;
    const date = dateOn(row.text);
    if (!date) continue;

    const sameRow = timeOn(row.text, date.endsAt);
    if (sameRow) return { departureAtLocal: `${date.value}T${sameRow}` };

    // A date row with no time of its own, followed by a row the document
    // LABELS as the departure ("Date: Aug 4, 2026" / "Departs: 5:45 PM"),
    // is one leg's data split across two printed rows. Only an explicit
    // departure label earns this — an unlabelled clock time on the next row
    // is exactly the pairing that produced a date of issue at 07:45.
    for (const next of window.slice(index + 1, index + 3)) {
      if (!DEPART_LABEL_RE.test(next.text)) continue;
      if (dateOn(next.text)) break;
      const time = timeOn(next.text, 0);
      if (time) return { departureAtLocal: `${date.value}T${time}` };
      break;
    }
  }
  return {};
}

function dateOn(row: string): { value: string; endsAt: number } | undefined {
  const pad = (n: number) => String(n).padStart(2, "0");

  const us = DATE_US_RE.exec(row);
  if (us?.[1] && us[2] && us[3]) {
    const month = MONTHS[us[1]];
    if (month) {
      return {
        value: `${us[3]}-${pad(month)}-${pad(Number(us[2]))}`,
        endsAt: us.index + us[0].length,
      };
    }
  }
  const eu = DATE_EU_RE.exec(row);
  if (eu?.[1] && eu[2] && eu[3]) {
    const month = MONTHS[eu[2]];
    if (month) {
      return {
        value: `${eu[3]}-${pad(month)}-${pad(Number(eu[1]))}`,
        endsAt: eu.index + eu[0].length,
      };
    }
  }
  const iso = DATE_ISO_RE.exec(row);
  if (iso?.[1] && iso[2] && iso[3]) {
    return { value: `${iso[1]}-${iso[2]}-${iso[3]}`, endsAt: iso.index + iso[0].length };
  }
  return undefined;
}

/**
 * The clock time on this row that belongs to the departure.
 *
 * A row like "Depart: Fri 18 Dec 2026 09:40 Hrs Arrive 21:55 Hrs" carries two;
 * the departure is the one printed BEFORE any arrival label, and after the
 * date when the date comes first. A row the document labels as a duration
 * yields nothing at all.
 */
function timeOn(row: string, dateEndsAt: number): string | undefined {
  // Cut at the label, do not refuse the row. "Depart Sep 14, 2026 07:45
  // Arrive 11:10 Duration 06:25 Hrs" is one printed row carrying a real
  // departure time AND two values that are not one; refusing the whole row
  // over the word "Duration" loses the departure along with them.
  const arrivalAt = Math.min(
    ARRIVAL_ROW_RE.exec(row)?.index ?? Number.POSITIVE_INFINITY,
    DURATION_NEAR_RE.exec(row)?.index ?? Number.POSITIVE_INFINITY,
  );

  TIME_RE.lastIndex = 0;
  for (const match of row.matchAll(TIME_RE)) {
    const index = match.index ?? 0;
    if (index >= arrivalAt) break;
    // A time printed before the date on the same row belongs to something
    // else — a header, a previous column — unless the date leads the row.
    if (dateEndsAt > 0 && index < dateEndsAt - match[0].length && index < 4) continue;
    let hour = Number(match[1]);
    const minute = Number(match[2]);
    if (Number.isNaN(hour) || Number.isNaN(minute) || minute > 59) continue;
    if (match[3] === "PM" && hour < 12) hour += 12;
    if (match[3] === "AM" && hour === 12) hour = 0;
    if (hour > 23) continue;
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }
  return undefined;
}

/** The passenger, from a labelled row, or nothing. */
function paxNameFor(lines: string[]): string | undefined {
  for (const [index, line] of lines.entries()) {
    const match = PAX_LABEL_RE.exec(line);
    if (!match) continue;
    // The label sometimes ends its own row and the name is on the next one.
    const rest = match[1]?.trim() || lines[index + 1]?.trim() || "";
    const name = cleanPaxName(takeNameWords(rest));
    if (name && name.split(/\s+/).length >= 2) return name;
  }
  return undefined;
}

/**
 * The word the document prints about itself. A whole-document signal, applied
 * only when the chosen leg has no destination country of its own — see
 * `ReadItinerary.scope`. "INTERNATIONAL" wins a tie because the
 * international bag-drop cutoff is the earlier of the two, and a deadline
 * that runs early costs the customer nothing.
 */
function scopeFor(upper: string): TicketExtractionScope | undefined {
  if (upper.includes("INTERNATIONAL")) return "international";
  if (upper.includes("DOMESTIC")) return "domestic";
  return undefined;
}

/** What the shape of the itinerary says about the document. */
function documentKindFor(segments: ExtractedSegment[]): TicketDocumentKind | undefined {
  if (segments.length === 0) return undefined;
  if (segments.length === 1) return "one_way";
  const first = segments[0]!;
  const last = segments[segments.length - 1]!;
  if (first.originAirport && first.originAirport === last.destinationAirport) {
    return "round_trip";
  }
  return "multi_city";
}

/** What was hard to read, in the same field the model fills in. */
function notesFor(segments: ExtractedSegment[], routeCount: number): string | undefined {
  const undated = segments.filter((s) => s.departureAtLocal === undefined).length;
  const notes: string[] = [];
  if (routeCount === 0) notes.push("no route (AAA - BBB) was found in the text layer");
  if (undated > 0) {
    notes.push(
      `${undated} of ${segments.length} legs had no departure date and time printed on the same row, so none was recorded for them`,
    );
  }
  return notes.length > 0
    ? `Read from the PDF text layer. ${notes.join("; ")}.`
    : undefined;
}
