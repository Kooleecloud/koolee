import { AIRPORT_CODES, type PrefillLeg, type TicketPrefill } from "@/lib/booking-draft-schema";

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
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
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

export function describePrefill(prefill: TicketPrefill | undefined): PrefillNotice | null {
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
 * One row of the read-back list: the route, the flight, and whether this is a
 * leg we can collect bags for.
 *
 * `collectable` is not "is this the chosen leg" — a round trip has two New
 * York departures and only one of them is prefilled, and both are collectable.
 * The list has to say which legs the product can serve so that "we only filled
 * in one of your three legs" reads as a boundary rather than a failure.
 */
export interface ReadBackLeg {
  route: string;
  flightNumber?: string;
  stamp?: string;
  chosen: boolean;
  collectable: boolean;
}

export function describeItinerary(
  prefill: TicketPrefill | undefined,
): ReadBackLeg[] {
  const legs = prefill?.legs ?? [];
  if (legs.length < 2) return [];
  const serviced = AIRPORT_CODES as readonly string[];
  return legs.map((leg: PrefillLeg, index: number) => ({
    route: leg.destinationAirport
      ? `${leg.departureAirport} → ${leg.destinationAirport}`
      : leg.departureAirport,
    ...(leg.flightNumber ? { flightNumber: leg.flightNumber } : {}),
    ...(formatLocalStamp(leg.departureAtLocal)
      ? { stamp: formatLocalStamp(leg.departureAtLocal)! }
      : {}),
    chosen: index === prefill?.chosenLegIndex,
    collectable: serviced.includes(leg.departureAirport),
  }));
}

/** "the EWR → DEL leg on Sep 12, 1:15 PM" — the swap button's label. */
export function describeAlternative(leg: {
  departureAirport?: string;
  destinationAirport?: string;
  departureAtLocal?: string;
}): string {
  return describeLeg(leg);
}
