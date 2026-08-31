/**
 * How a flight is named to the person who booked it.
 *
 * THE PROBLEM THIS SOLVES. Trip cards led with the flight number — "AI144 ·
 * EWR" — which is the one detail nobody remembers. Ask somebody about a trip
 * they took in March and they will tell you they flew to Delhi from Newark;
 * they will not tell you the flight number, and a list of them is a list of
 * things that all look the same.
 *
 * So the ROUTE leads and the flight number becomes a detail. Where the
 * destination is known (read off the ticket, or typed on the flight form) it
 * is a real route; where it is not — which is ordinary, and always will be for
 * hand-entered bookings — it degrades to the departure airport alone rather
 * than to a placeholder.
 */

/** "EWR → DEL", or "Flight from EWR" when the destination is unknown. */
export function flightRouteLabel(booking: {
  departureAirport: string;
  destinationAirport?: string | null;
}): string {
  return booking.destinationAirport
    ? `${booking.departureAirport} → ${booking.destinationAirport}`
    : `Flight from ${booking.departureAirport}`;
}

/**
 * The same thing for a screen reader and a page title, where an arrow is
 * either read aloud as nothing or as "right arrow".
 */
export function flightRouteText(booking: {
  departureAirport: string;
  destinationAirport?: string | null;
}): string {
  return booking.destinationAirport
    ? `${booking.departureAirport} to ${booking.destinationAirport}`
    : `Flight from ${booking.departureAirport}`;
}
