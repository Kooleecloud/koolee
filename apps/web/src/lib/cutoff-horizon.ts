/**
 * How long until the airline's bag drop closes, said the way a person would.
 *
 * WHY THIS EXISTS. The countdown rendered raw hours, always. A booking made
 * six months ahead read:
 *
 *     4499h 3m until AI's bag-drop cutoff at EWR.
 *
 * Nobody converts that. It is not a deadline anybody is acting on, it is
 * arithmetic homework at the top of a page whose real content is below it —
 * and it made an urgent-looking banner permanently non-urgent, which is the
 * fastest way to teach somebody to skip it.
 *
 * TWO RULES:
 *
 *  1. **Beyond the horizon, say nothing.** A cutoff more than a week out is
 *     not a thing to do today. The page already shows the departure and the
 *     pickup window; a countdown adds no information and costs the banner its
 *     meaning. It appears when it starts to matter.
 *  2. **Below it, scale the unit to the distance.** Days when it is days,
 *     hours and minutes inside a day, minutes inside an hour. Precision that
 *     nobody can act on is noise; precision in the last hour is the point.
 *
 * A PASSED cutoff is ALWAYS shown, however long ago. "The bag drop has closed"
 * is not a countdown — it is the state of the booking, and hiding it because
 * the flight was last month would be hiding the only thing on the page that
 * explains why nothing works.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * How far ahead the countdown is worth showing.
 *
 * A week: the point at which a trip stops being an abstraction and starts
 * being something a person packs for. One constant, so moving the line is one
 * edit rather than a hunt.
 */
export const CUTOFF_HORIZON_MS = 7 * DAY;

/**
 * Should the trip page render the countdown at all?
 *
 * Decided on the SERVER and passed down, not re-derived in the browser: the
 * two clocks differ, and a boundary case where the server renders the banner
 * and the client does not is a hydration mismatch on the whole subtree.
 * Remaining time only ever shrinks, so a server "yes" is still a yes by the
 * time the client hydrates.
 */
export function withinCutoffHorizon(cutoffAt: Date, now: Date): boolean {
  return cutoffAt.getTime() - now.getTime() <= CUTOFF_HORIZON_MS;
}

/**
 * A duration in the largest unit that still says something useful.
 *
 * Takes an ABSOLUTE span, so the same ladder reads both directions — "3 days"
 * until, and "3 days" since.
 *
 * | span            | reads as        |
 * | --------------- | --------------- |
 * | under a minute  | `less than a minute` |
 * | under an hour   | `42 min`        |
 * | under a day     | `7h 12m`        |
 * | a day or more   | `3 days`        |
 *
 * Days lose the hours on purpose. Between one and two days there is nothing a
 * customer does differently at 25 hours versus 47, and "1 day 23h" is a
 * sentence people re-read.
 */
export function formatCutoffDistance(spanMs: number): string {
  const ms = Math.abs(spanMs);

  if (ms < MINUTE) return "less than a minute";
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)} min`;
  if (ms < DAY) {
    const hours = Math.floor(ms / HOUR);
    const minutes = Math.floor((ms % HOUR) / MINUTE);
    return `${hours}h ${minutes}m`;
  }

  const days = Math.floor(ms / DAY);
  return `${days} ${days === 1 ? "day" : "days"}`;
}
