/**
 * The zone every ops screen reads times in.
 *
 * All three airports Koolee serves (JFK / LGA / EWR) are Eastern, so the
 * console can hold one zone rather than resolving it per booking. It must be
 * stated explicitly and never fall back to the server's: production runs in
 * UTC, and a dispatcher reading a 6 PM window as 22:00 — or a "today" bucket
 * that starts at 8 PM the previous evening — would mis-plan the whole shift.
 *
 * When a non-Eastern airport is added, this constant is the thing that has to
 * become a per-airport lookup (`airports.tz` already carries the value).
 */
export const AIRPORT_TZ = "America/New_York";
