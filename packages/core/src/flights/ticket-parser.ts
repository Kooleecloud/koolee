import { AIRPORT_CODES, type AirportCode, type CutoffScope } from "@koolee/db";

/**
 * Heuristic e-ticket text parser.
 *
 * Input is the raw text layer of an uploaded ticket PDF; output is a PARTIAL
 * prefill for the flight review form. Hard rule: extracted data ALWAYS routes
 * through the editable review form before it touches a booking — this module
 * must never feed `createBooking` directly, and nothing here is trusted.
 *
 * TODO(anthropic): swap the regex heuristics for a Claude extraction call when
 * ANTHROPIC_API_KEY is wired. The return shape is the seam; the review-form
 * rule does not change.
 */

export interface ParsedTicket {
  flightNumber?: string;
  airlineIata?: string;
  departureAirport?: AirportCode;
  /** Local wall-clock time at the departure airport, `YYYY-MM-DDTHH:mm`. */
  departureAtLocal?: string;
  paxName?: string;
  scope?: CutoffScope;
}

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

/** e.g. "UA 1189", "UA1189", "Flight: DL123" */
const FLIGHT_RE = /\b([A-Z]{2}|[A-Z]\d|\d[A-Z])\s?(\d{1,4})\b/;
const FLIGHT_LABELED_RE = /FLIGHT\s*(?:NO\.?|NUMBER|#|:)?\s*([A-Z]{2}|[A-Z]\d|\d[A-Z])\s?(\d{1,4})\b/;
const PAX_RE = /(?:PASSENGER|TRAVELLER|TRAVELER|NAME OF PASSENGER|PASSENGER NAME)\s*[:#]?\s*([A-Z][A-Za-z'.-]+(?:[ /][A-Z][A-Za-z'.-]+){1,3})/;
/** "Mar 14, 2026 5:45 PM" / "14 Mar 2026 17:45" / "2026-03-14 17:45" */
const DATE_US_RE = /\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\.?\s+(\d{1,2}),?\s+(\d{4})/;
const DATE_EU_RE = /\b(\d{1,2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\.?\s+(\d{4})/;
const DATE_ISO_RE = /\b(\d{4})-(\d{2})-(\d{2})/;
const TIME_RE = /\b(\d{1,2}):(\d{2})\s*(AM|PM)?\b/;

export function parseTicketText(text: string): ParsedTicket {
  const upper = text.toUpperCase();
  const result: ParsedTicket = {};

  /* --- flight number ------------------------------------------------ */
  const flightMatch = FLIGHT_LABELED_RE.exec(upper) ?? FLIGHT_RE.exec(upper);
  if (flightMatch?.[1] !== undefined && flightMatch[2] !== undefined) {
    result.airlineIata = flightMatch[1];
    result.flightNumber = `${flightMatch[1]}${flightMatch[2]}`;
  }
  // An airline name beats a bare two-letter guess when both are present.
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

  /* --- departure airport --------------------------------------------- */
  // The first serviced airport mentioned is treated as the departure; the
  // review form is where a wrong guess gets fixed.
  let firstIdx = Number.POSITIVE_INFINITY;
  for (const code of AIRPORT_CODES) {
    const idx = upper.indexOf(code);
    if (idx !== -1 && idx < firstIdx) {
      firstIdx = idx;
      result.departureAirport = code;
    }
  }

  /* --- departure date + time ----------------------------------------- */
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

  // Prefer a time labelled as departure; fall back to the first time found.
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

  if (y && mo && d) {
    const pad = (n: number) => String(n).padStart(2, "0");
    result.departureAtLocal = `${y}-${pad(mo)}-${pad(d)}T${pad(hh ?? 12)}:${pad(mm ?? 0)}`;
  }

  /* --- passenger name ------------------------------------------------- */
  const pax = PAX_RE.exec(text.toUpperCase());
  if (pax?.[1] !== undefined) {
    // "ALVAREZ/JORDAN" (ticket convention) → "Jordan Alvarez"
    const raw = pax[1].trim();
    const parts = raw.includes("/")
      ? raw.split("/").reverse().join(" ")
      : raw;
    result.paxName = parts
      .toLowerCase()
      .split(/\s+/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  }

  /* --- scope ----------------------------------------------------------- */
  if (upper.includes("INTERNATIONAL")) result.scope = "international";
  else if (upper.includes("DOMESTIC")) result.scope = "domestic";

  return result;
}
