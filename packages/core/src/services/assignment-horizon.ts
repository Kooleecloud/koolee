/**
 * When an agent gets assigned to a booking — the one definition.
 *
 * Its own module rather than a helper inside `auto-assign.ts` because three
 * places have to agree on it and two of them would otherwise form an import
 * cycle: `auto-assign.ts` (the on-paid hook and the horizon sweep) already
 * imports `dispatch.ts` for `assignAgentToBooking`, and `dispatch.ts` needs
 * the same predicate for the board's at-risk flag.
 *
 * The agreement is the point. If the console's idea of "unassigned by design"
 * ever drifts from the sweep's, an operator is shown a red badge for work the
 * system is correctly not doing yet — which is worse than no badge, because
 * it teaches people to ignore the badge.
 */

const HOUR_MS = 3_600_000;

/**
 * Has this booking's pickup window come close enough to assign an agent to?
 *
 * A booking with NO window (legacy slot rows, backfilled by 0012 but the
 * column is still nullable) is treated as in-horizon: there is no future date
 * to wait for, so deferring it would defer it forever.
 */
export function withinAssignmentHorizon(
  windowStart: Date | null,
  now: Date,
  horizonHours: number,
): boolean {
  if (!windowStart) return true;
  return windowStart.getTime() - now.getTime() <= horizonHours * HOUR_MS;
}

/** The instant a booking's window must start at or before to be in horizon. */
export function assignmentHorizonEnd(now: Date, horizonHours: number): Date {
  return new Date(now.getTime() + horizonHours * HOUR_MS);
}
