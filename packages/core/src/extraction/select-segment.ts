import { AIRPORT_CODES, type AirportCode } from "@koolee/db";

import type {
  ExtractedSegment,
  ExtractionConfidence,
  SegmentSelectionReason,
  TicketExtractionScope,
} from "./types";

/**
 * Which leg of an itinerary this pickup is for — the decision that used to be
 * delegated to the model, and got it wrong.
 *
 * The old prompt asked for one pre-filtered answer ("use the segment departing
 * JFK/LGA/EWR"), which makes a small model do reading AND selection in one
 * pass. On a Yatra round-trip whose PDF text layer prints the return leg
 * first, it confidently returned the leg that ARRIVES at JFK. Extraction now
 * asks for every segment on the document and the choice is made here: pure,
 * deterministic, and unit-testable without a network call.
 *
 * Dates are compared as `YYYY-MM-DD` strings, never parsed into `Date`. The
 * values are wall-clock times at their own airports with no zone attached, so
 * parsing them would invent an offset; a lexicographic compare answers the
 * only question this module asks ("has this leg already flown?") and a day of
 * slop at the boundary changes nothing.
 */

/** True only for the NYC airports the product actually operates out of. */
function isServicedOrigin(code: string | undefined): code is AirportCode {
  return code !== undefined && (AIRPORT_CODES as readonly string[]).includes(code);
}

/**
 * The `YYYY-MM-DDTHH:mm` we ask for, matched as a PREFIX so the shapes a model
 * reaches for around it coerce instead of being thrown away: trailing seconds,
 * a "Z" or an offset it should not have added, a space instead of the T.
 * Anything past the minutes is deliberately ignored — these are wall-clock
 * times at their own airport, and a zone on one of them is noise.
 */
const LOCAL_DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/;

/** IATA 3-letter airport code. */
const AIRPORT_RE = /^[A-Z]{3}$/;

/** IATA flight number: designator (UA, B6, 9W) + 1-4 digits. */
const FLIGHT_RE = /^([A-Z]{2}|[A-Z]\d|\d[A-Z])(\d{1,4})$/;

/**
 * US and its territories share the domestic bag-drop cutoff. A flight to
 * anywhere else is international for our purposes, which is the only thing
 * `scope` feeds.
 */
const DOMESTIC_COUNTRIES = new Set(["US", "PR", "VI", "GU", "AS", "MP"]);

/** One field the model returned that we refused to use, and why. */
export interface DroppedField {
  field: string;
  value: unknown;
  reason: string;
}

export interface SegmentSelection {
  /** The leg this pickup is for, or undefined when none qualifies. */
  chosen?: ExtractedSegment;
  /**
   * The chosen leg's origin, narrowed to an airport we actually serve. This
   * is the ONLY value allowed to reach the form's airport dropdown — the type
   * carries the guarantee that `chosen.originAirport` (any IATA code) cannot.
   */
  chosenOrigin?: AirportCode;
  /** Index into the segments array as given, for diagnostics. */
  chosenIndex: number | null;
  reason: SegmentSelectionReason;
  confidence: ExtractionConfidence;
  /**
   * Other legs that ALSO depart a serviced airport — the "did you mean the
   * other leg?" offer on the review form. Never includes the chosen one.
   */
  alternatives: ExtractedSegment[];
  /**
   * Set when the ticket departs a real airport we simply do not serve, so the
   * form can say "this ticket departs SFO" instead of showing a blank.
   */
  nonServicedOrigin?: string;
}

/**
 * Coerce one raw segment into our shapes, dropping anything that does not
 * parse rather than failing the whole extraction.
 *
 * This is the per-field trust boundary. The previous implementation ran one
 * `safeParse` over the entire result, so a single malformed value — seconds on
 * a timestamp, a lowercase code — discarded every correctly-read field and
 * showed the customer "we couldn't read this".
 */
export function normalizeSegment(
  raw: unknown,
  index: number,
): { segment: ExtractedSegment; dropped: DroppedField[] } {
  const dropped: DroppedField[] = [];
  const segment: ExtractedSegment = {};
  if (typeof raw !== "object" || raw === null) {
    return { segment, dropped };
  }
  const record = raw as Record<string, unknown>;
  const at = (field: string) => `segments[${index}].${field}`;

  const text = (field: string): string | undefined => {
    const value = record[field];
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    return trimmed === "" ? undefined : trimmed;
  };

  for (const field of ["originAirport", "destinationAirport"] as const) {
    const value = text(field);
    if (value === undefined) continue;
    const code = value.toUpperCase();
    if (AIRPORT_RE.test(code)) segment[field] = code;
    else dropped.push({ field: at(field), value, reason: "not an IATA airport code" });
  }

  const flight = text("flightNumber");
  if (flight !== undefined) {
    // Airlines print "AI - 101" and "UA 1189"; the code is the same flight.
    const compact = flight.toUpperCase().replace(/[\s-]/g, "");
    const match = FLIGHT_RE.exec(compact);
    if (match) {
      segment.flightNumber = compact;
      segment.airlineIata = match[1];
    } else {
      dropped.push({
        field: at("flightNumber"),
        value: flight,
        reason: "not an IATA flight number",
      });
    }
  }

  // Only trust a standalone airline code when the flight number did not
  // already supply one — they disagree on codeshares, and the flight number
  // is the field the cutoff table is keyed by.
  const airline = text("airlineIata");
  if (airline !== undefined && segment.airlineIata === undefined) {
    const code = airline.toUpperCase();
    if (/^([A-Z]{2}|[A-Z]\d|\d[A-Z])$/.test(code)) segment.airlineIata = code;
    else
      dropped.push({
        field: at("airlineIata"),
        value: airline,
        reason: "not an IATA airline code",
      });
  }

  const departure = text("departureAtLocal");
  if (departure !== undefined) {
    const match = LOCAL_DATETIME_RE.exec(departure);
    const month = Number(match?.[2]);
    const day = Number(match?.[3]);
    const hour = Number(match?.[4]);
    const minute = Number(match?.[5]);
    if (match && month >= 1 && month <= 12 && day >= 1 && day <= 31 && hour <= 23 && minute <= 59) {
      segment.departureAtLocal = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}`;
    } else {
      dropped.push({
        field: at("departureAtLocal"),
        value: departure,
        reason: "not a YYYY-MM-DDTHH:mm local date-time",
      });
    }
  }

  for (const field of ["originCountry", "destinationCountry"] as const) {
    const value = text(field);
    if (value === undefined) continue;
    const code = value.toUpperCase();
    if (/^[A-Z]{2}$/.test(code)) segment[field] = code;
    else
      dropped.push({
        field: at(field),
        value,
        reason: "not an ISO-3166 alpha-2 country",
      });
  }

  const notes = text("notes");
  if (notes !== undefined) segment.notes = notes.slice(0, 500);

  return { segment, dropped };
}

/**
 * Pick the leg whose bags we are collecting.
 *
 * The policy, in order:
 *  1. no segments at all — nothing to choose from;
 *  2. no segment departs a serviced airport — report the origin we DID read,
 *     so the form can explain itself instead of defaulting to JFK;
 *  3. exactly one serviced departure — take it, high confidence;
 *  4. several — take the earliest that has not already flown. Only one still
 *     upcoming is an ordinary round trip and stays high confidence; two on
 *     the same trip (an open-jaw JFK-out/EWR-back) is a genuine ambiguity and
 *     drops to low with the other leg offered as a one-click swap;
 *  5. every serviced departure is in the past — take the earliest and say so
 *     at low confidence. `submitFlight` refuses a past departure anyway; the
 *     point is to show the customer what we read, not to pretend.
 */
export function selectSegment(
  segments: readonly ExtractedSegment[],
  options: { today: string },
): SegmentSelection {
  const candidates = segments
    .map((segment, index) => ({ segment, index, origin: segment.originAirport }))
    .filter(
      (
        entry,
      ): entry is { segment: ExtractedSegment; index: number; origin: AirportCode } =>
        isServicedOrigin(entry.origin),
    );

  if (candidates.length === 0) {
    const withOrigin = segments.find((s) => s.originAirport !== undefined);
    if (segments.length === 0) {
      return {
        chosenIndex: null,
        reason: "no_segments",
        confidence: "low",
        alternatives: [],
      };
    }
    return {
      chosenIndex: null,
      reason: "no_serviced_origin",
      confidence: "low",
      alternatives: [],
      ...(withOrigin?.originAirport
        ? { nonServicedOrigin: withOrigin.originAirport }
        : {}),
    };
  }

  if (candidates.length === 1) {
    const only = candidates[0]!;
    return {
      chosen: only.segment,
      chosenOrigin: only.origin,
      chosenIndex: only.index,
      reason: "single_serviced_origin",
      confidence: "high",
      alternatives: [],
    };
  }

  // A leg with no readable date cannot be shown to be upcoming, so it sorts
  // last and never wins on a tie — but it stays a candidate, because a
  // one-segment-dated itinerary is still better than nothing.
  const byDeparture = [...candidates].sort((a, b) =>
    (a.segment.departureAtLocal ?? "9999").localeCompare(
      b.segment.departureAtLocal ?? "9999",
    ),
  );
  const upcoming = byDeparture.filter(
    (entry) =>
      entry.segment.departureAtLocal !== undefined &&
      entry.segment.departureAtLocal.slice(0, 10) >= options.today,
  );

  const pick = upcoming[0] ?? byDeparture[0]!;
  const alternatives = byDeparture
    .filter((entry) => entry.index !== pick.index)
    .map((entry) => entry.segment)
    .slice(0, 3);

  if (upcoming.length === 1) {
    return {
      chosen: pick.segment,
      chosenOrigin: pick.origin,
      chosenIndex: pick.index,
      reason: "earliest_upcoming_serviced_origin",
      confidence: "high",
      alternatives,
    };
  }
  return {
    chosen: pick.segment,
    chosenOrigin: pick.origin,
    chosenIndex: pick.index,
    reason:
      upcoming.length === 0
        ? "all_serviced_departures_past"
        : "ambiguous_serviced_origins",
    confidence: "low",
    alternatives,
  };
}

/**
 * Domestic or international, derived from the destination COUNTRY the model
 * read off the document rather than from a label it was asked to invent.
 *
 * Undefined when the country is unknown: the review form's own default is
 * "domestic", and silently confirming that guess as an extracted fact is how
 * a customer ends up with an international cutoff they never checked.
 */
export function deriveScope(
  segment: ExtractedSegment | undefined,
): TicketExtractionScope | undefined {
  const country = segment?.destinationCountry;
  if (country === undefined) return undefined;
  return DOMESTIC_COUNTRIES.has(country) ? "domestic" : "international";
}

/** UTC `YYYY-MM-DD` — the "has this leg flown?" reference date. */
export function todayUtc(now: Date): string {
  return now.toISOString().slice(0, 10);
}
