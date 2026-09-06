import {
  AIRPORT_CODES,
  type PrefillLeg,
  type TicketPrefill,
} from "@/lib/booking-draft-schema";

/**
 * The sentence the review form shows above a ticket-filled form.
 *
 * The point is to never leave a prefilled field unexplained. A round trip has
 * two legs and we picked one; a ticket out of SFO gets no airport at all.
 * Before this, both cases looked identical to the customer — a form that had
 * simply decided something, with the airport dropdown sitting on its "JFK"
 * default as though they had chosen it.
 *
 * Pure and string-only: `departureAtLocal` is a wall clock at its own airport
 * with no zone attached, so it is formatted from its own digits rather than
 * routed through a timezone-aware formatter that would have to invent one.
 */

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export interface PrefillNotice {
  tone: "info" | "error";
  text: string;
}

/** "2026-09-12T13:15" → "Sep 12, 1:15 PM". Undefined when unreadable. */
export function formatLocalStamp(value: string | undefined): string | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value ?? "");
  if (!match) return undefined;
  const month = MONTHS[Number(match[2]) - 1];
  if (!month) return undefined;
  const hour24 = Number(match[4]);
  const hour = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${month} ${Number(match[3])}, ${hour}:${match[5]} ${hour24 < 12 ? "AM" : "PM"}`;
}

/** "EWR → DEL on Sep 12, 1:15 PM", with each half omitted when unknown. */
function describeLeg(leg: {
  departureAirport?: string;
  destinationAirport?: string;
  departureAtLocal?: string;
}): string {
  const route = leg.destinationAirport
    ? `${leg.departureAirport} → ${leg.destinationAirport}`
    : `${leg.departureAirport}`;
  const stamp = formatLocalStamp(leg.departureAtLocal);
  return stamp ? `${route} on ${stamp}` : route;
}

export function describePrefill(
  prefill: TicketPrefill | undefined,
): PrefillNotice | null {
  if (!prefill) return null;
  const leg = describeLeg(prefill);

  switch (prefill.selectionReason) {
    case "no_serviced_origin":
      return {
        tone: "error",
        text: prefill.nonServicedOrigin
          ? `This ticket departs ${prefill.nonServicedOrigin}. Koolee collects bags for flights out of JFK, LGA and EWR only — pick the airport your bags are flying from, or check you uploaded the right ticket.`
          : "We couldn't tell which airport this ticket departs from. Please choose it below.",
      };

    case "no_segments":
      return {
        tone: "error",
        text: "We couldn't find any flight details on this file — please enter them below.",
      };

    case "all_serviced_departures_past":
      return {
        tone: "error",
        text: `The flight we found on this ticket (${leg}) has already departed. Check the details below, or enter the flight your bags are actually catching.`,
      };

    case "ambiguous_serviced_origins":
      return {
        tone: "error",
        text: `This ticket has more than one flight leaving New York. We filled in ${leg} — make sure that's the one your bags are catching.`,
      };

    case "earliest_upcoming_serviced_origin":
      return {
        tone: "info",
        text: `This is a ${prefill.documentKind === "round_trip" ? "round trip" : "multi-leg ticket"} — we used ${leg}, the next leg departing an airport we serve.`,
      };

    case "single_serviced_origin":
      return {
        tone: "info",
        text:
          prefill.documentKind === "round_trip"
            ? `Round trip — we used ${leg}, the only leg departing an airport we serve.`
            : `We read ${leg} off your ticket. Check every field before you continue.`,
      };

    default:
      return null;
  }
}

/**
 * The flights on this ticket WE CAN ACTUALLY COLLECT FOR, as something to
 * choose between.
 *
 * WHAT THIS REPLACES. The review form used to print every leg it had read,
 * eligible or not, each with a clause explaining itself:
 *
 *     We read 2 flights on this ticket:
 *     DEL → JFK · AI101 · Jan 6, 1:35 AM — not leaving New York, so we can't
 *       collect for it
 *     EWR → DEL · AI144 · Dec 12, 1:15 PM — filled in below
 *
 * That is a paragraph of reading to answer a question the customer did not
 * ask. They know their own itinerary; what they need to know is which leg this
 * form is about, and how to change it if we picked the wrong one. Legs we
 * cannot serve are not choices, and listing them with an apology each makes
 * the eligible one harder to find, not easier.
 *
 * So this returns only the collectable legs — the one prefilled plus every
 * alternative we could swap to — and the count of what was dropped, which the
 * page renders as ONE quiet line. Nothing is lost: `useTicketAlternativeLeg`
 * swaps the chosen leg for an alternative and puts the old one back in the
 * list, so every eligible leg stays reachable however many times somebody
 * changes their mind.
 */
export interface EligibleLeg {
  /** "EWR → DEL", or just "EWR" when the destination is unknown. */
  route: string;
  flightNumber?: string;
  stamp?: string;
  /** True for the leg currently filling the form. */
  chosen: boolean;
  /**
   * Index into `prefill.alternatives`, for the swap form. Absent on the chosen
   * leg, which is not something you can swap TO.
   */
  alternativeIndex?: number;
}

export interface EligibleLegs {
  legs: EligibleLeg[];
  /** Legs we read but cannot collect for — a count, never a list. */
  skipped: number;
}

function routeOf(leg: {
  departureAirport?: string;
  destinationAirport?: string;
}): string {
  return leg.destinationAirport
    ? `${leg.departureAirport} → ${leg.destinationAirport}`
    : `${leg.departureAirport}`;
}

function toEligible(
  leg: {
    departureAirport?: string;
    destinationAirport?: string;
    flightNumber?: string;
    departureAtLocal?: string;
  },
  extra: { chosen: boolean; alternativeIndex?: number },
): EligibleLeg {
  const stamp = formatLocalStamp(leg.departureAtLocal);
  return {
    route: routeOf(leg),
    ...(leg.flightNumber ? { flightNumber: leg.flightNumber } : {}),
    ...(stamp ? { stamp } : {}),
    ...extra,
  };
}

export function describeEligibleLegs(prefill: TicketPrefill | undefined): EligibleLegs {
  if (!prefill) return { legs: [], skipped: 0 };

  const alternatives = prefill.alternatives ?? [];
  const legs: EligibleLeg[] = [];

  // The chosen leg first and always — it is what the form below is showing.
  if (prefill.departureAirport) {
    legs.push(toEligible(prefill, { chosen: true }));
  }
  alternatives.forEach((leg, index) =>
    legs.push(toEligible(leg, { chosen: false, alternativeIndex: index })),
  );

  /*
   * How many legs we read and cannot serve.
   *
   * Derived from `legs` (every leg in print order) rather than from
   * `alternatives` (only the swappable ones), because that is the difference
   * between "we read three flights and can collect for one" and "we read one".
   * `legs` is absent on older draft cookies, in which case we say nothing —
   * silence is better than a wrong count.
   */
  const read = prefill.legs ?? [];
  const serviced = AIRPORT_CODES as readonly string[];
  const skipped = read.filter(
    (leg: PrefillLeg) => !serviced.includes(leg.departureAirport),
  ).length;

  return { legs, skipped };
}
