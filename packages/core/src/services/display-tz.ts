import { eq } from "drizzle-orm";
import { airports, type AirportCode, type Database } from "@koolee/db";

/**
 * The display zone of a booking — the single answer to "what time is this?"
 *
 * THE RULE: every human-facing time belonging to a booking is rendered in the
 * zone of its DEPARTURE AIRPORT. Not the viewer's zone, not the server's, not
 * the pickup address's. One booking, one zone, read identically by the
 * customer who bought the window, the agent who shows up for it, and the
 * dispatcher who plans around it.
 *
 * Why the airport and not the pickup address:
 *
 *  - the airline bag-drop cutoff is the only hard deadline in the system and
 *    it is expressed in airport time; every window is derived from it;
 *  - the airport zone is the one zone all three actors share. The pickup
 *    address's zone is shared by nobody but the customer;
 *  - two zones on one booking means two numbers on the same screen in
 *    different units, which no amount of labelling survives at 5 AM.
 *
 * The airports Koolee serves today are all Eastern, so this resolves to one
 * value in practice. It is a lookup rather than a constant because the ops
 * console shows bookings from every airport at once: the day a non-Eastern
 * airport is added, a hardcoded zone silently mislabels half the board, and
 * nothing about the code would look wrong.
 *
 * Deliberately NOT here: the customer's own zone. That is captured elsewhere
 * as metadata and must never reach a formatter — rendering in the viewer's
 * zone is the exact confusion this module exists to prevent.
 */

/**
 * Used only when an airport row is missing, which the `bookings.departure_airport`
 * foreign key makes near-impossible. A wrong-but-plausible Eastern time beats
 * throwing on a booking page, and every airport Koolee serves is Eastern.
 */
export const FALLBACK_DISPLAY_TZ = "America/New_York";

/** The display zone for one booking's airport. */
export async function resolveDisplayTz(
  db: Database,
  airportCode: AirportCode | string,
): Promise<string> {
  const row = await db.query.airports.findFirst({
    where: eq(airports.code, airportCode as AirportCode),
    columns: { tz: true },
  });
  return row?.tz ?? FALLBACK_DISPLAY_TZ;
}

/**
 * Every airport's zone, keyed by code — one query for a whole list.
 *
 * The ops board renders up to 200 rows spanning every airport; resolving per
 * row would be 200 queries for a table with a handful of rows in it.
 */
export async function getDisplayZones(db: Database): Promise<Record<string, string>> {
  const rows = await db.select({ code: airports.code, tz: airports.tz }).from(airports);
  return Object.fromEntries(rows.map((r) => [r.code, r.tz]));
}

/**
 * Zone lookup for a row already carrying an airport code, with the fallback
 * applied — so call sites read `zoneFor(zones, booking.departureAirport)`
 * instead of repeating `?? FALLBACK` at every render.
 */
export function zoneFor(
  zones: Record<string, string>,
  airportCode: AirportCode | string,
): string {
  return zones[airportCode] ?? FALLBACK_DISPLAY_TZ;
}
