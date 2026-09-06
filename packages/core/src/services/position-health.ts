import { and, desc, eq, isNull, lt, sql } from "drizzle-orm";
import {
  driverPositionPings,
  driverPositions,
  driverShifts,
  trucks,
  users,
  type Database,
} from "@koolee/db";

/**
 * Is Koolee actually seeing its drivers?
 *
 * THE QUESTION NOTHING COULD ANSWER. A shift is open, so the app believes the
 * driver is reporting; `driver_positions` holds one row that says where they
 * were, with no way to tell a fix from four seconds ago from one from four
 * hours ago without reading the timestamp and doing the arithmetic — and
 * nothing did. The failure mode was silent by construction: a customer noticed
 * a pin had stopped, and by then nobody could reconstruct when it stopped or
 * why.
 *
 * The web cannot make the gaps impossible — a locked phone with a
 * backgrounded PWA reports nothing, and no service worker has geolocation.
 * What it CAN do is make them short, visible and recoverable. This module is
 * the visible half: it turns "the driver's location is missing" from something
 * a customer discovers into something the system says first.
 *
 * TWO READERS, ONE RULE. The ops console renders `staleness` on a shift row,
 * and the nudge job pushes to the drivers it flags. They must agree about what
 * "stale" means or dispatch will be chasing drivers the app thinks are fine.
 */

/**
 * How long a shift may go unheard before it is worth saying something.
 *
 * DELIBERATELY LONGER THAN `POSITION_FRESH_MS` (90 s), and the difference is
 * the point. Ninety seconds is "do not draw this pin as current" — a bar the
 * ordinary rhythm of a phone crosses constantly, at a red light in a tunnel or
 * during a lock-screen glance. Alerting on that would page ops several times
 * an hour per driver and be ignored inside a day.
 *
 * Four minutes is roughly five missed sends at the slowest cadence: past the
 * point where an ordinary hiccup explains it, well short of a customer
 * wondering why nothing has moved.
 */
export const POSITION_GAP_MS = 240_000;

/**
 * How long a shift may be unheard before nudging the driver AGAIN.
 *
 * A driver whose phone is genuinely asleep will stay flagged for as long as it
 * is asleep, and a notification per sweep would be a notification every few
 * minutes for the rest of their shift — which teaches them to dismiss the one
 * that matters. One nudge per gap, then silence until they come back.
 */
export const POSITION_NUDGE_COOLDOWN_MS = 1_800_000;

export interface StaleShift {
  shiftId: string;
  staffUserId: string;
  fullName: string | null;
  truckName: string;
  shiftStartedAt: Date;
  /** Last fix on record, or null when the phone has never reported at all. */
  lastSeenAt: Date | null;
  /** How long we have been blind, in ms. Null when there was never a fix. */
  silentForMs: number | null;
}

/**
 * Open shifts whose driver has gone quiet.
 *
 * A SHIFT THAT HAS NEVER REPORTED COUNTS, and is arguably the worse case: a
 * driver who clocked on with location denied looks identical to one who is
 * simply not moving, and produces no row in `driver_positions` at all. The
 * `left join` is what keeps them in the result; the clock-on gate is what
 * should stop it happening, and this is the net under it.
 *
 * A shift is given a grace period equal to the gap window before it can be
 * flagged, so clocking on does not immediately raise an alarm about a phone
 * that has simply not produced its first fix yet.
 */
export async function listStalePositionShifts(
  db: Database,
  now: Date = new Date(),
  gapMs: number = POSITION_GAP_MS,
): Promise<StaleShift[]> {
  const cutoff = new Date(now.getTime() - gapMs);

  const rows = await db
    .select({
      shiftId: driverShifts.id,
      staffUserId: driverShifts.staffUserId,
      fullName: users.fullName,
      truckName: trucks.name,
      shiftStartedAt: driverShifts.startedAt,
      lastSeenAt: driverPositions.recordedAt,
    })
    .from(driverShifts)
    .innerJoin(users, eq(users.id, driverShifts.staffUserId))
    .innerJoin(trucks, eq(trucks.id, driverShifts.truckId))
    .leftJoin(driverPositions, eq(driverPositions.staffUserId, driverShifts.staffUserId))
    .where(
      and(
        isNull(driverShifts.endedAt),
        // The grace period: a shift younger than the gap window has not had
        // time to be late yet.
        lt(driverShifts.startedAt, cutoff),
        sql`(${driverPositions.recordedAt} is null or ${driverPositions.recordedAt} < ${cutoff})`,
      ),
    )
    .orderBy(desc(driverShifts.startedAt));

  return rows.map((row) => ({
    ...row,
    silentForMs: row.lastSeenAt ? now.getTime() - row.lastSeenAt.getTime() : null,
  }));
}

export type PositionHealth = "live" | "stale" | "silent";

export interface ShiftPositionHealth {
  health: PositionHealth;
  lastSeenAt: Date | null;
  silentForMs: number | null;
}

/**
 * One shift's position health, for a console row.
 *
 * THREE STATES, NOT TWO, because "we have never heard from this phone" and
 * "we have stopped hearing from this phone" want different responses from a
 * dispatcher: the first is a permissions or device problem to solve before the
 * driver leaves, the second is a driver to call.
 */
export function positionHealthOf(
  lastSeenAt: Date | null,
  now: Date = new Date(),
  gapMs: number = POSITION_GAP_MS,
): ShiftPositionHealth {
  if (!lastSeenAt) return { health: "silent", lastSeenAt: null, silentForMs: null };
  const silentForMs = now.getTime() - lastSeenAt.getTime();
  return {
    health: silentForMs > gapMs ? "stale" : "live",
    lastSeenAt,
    silentForMs,
  };
}

export interface PrunePositionPingsResult {
  deleted: number;
}

/**
 * Delete ping rows past the retention window.
 *
 * THIS IS NOT HOUSEKEEPING, IT IS PART OF THE FEATURE. `driver_position_pings`
 * takes a row per driver per 20-45 seconds of every shift — roughly 1,500 per
 * driver-day, and the highest-volume write in the system by a wide margin.
 * Shipping the table without the sweep is how a disk fills up, and the table's
 * own migration says so.
 *
 * SEVEN DAYS. A gap nobody investigated inside a week is a gap nobody is going
 * to; the diagnostic value of a ping falls off a cliff long before its storage
 * cost does. It is a parameter rather than a constant because the right answer
 * is an operational one and will be argued about.
 *
 * BATCHED, because a single unbounded `DELETE` over a week of rows takes a
 * long lock on the table the pinger is actively writing to. Each pass deletes
 * at most `batchSize` and returns; the cron runs often enough to catch up, and
 * a sweep that falls behind is visible in the count rather than as a stalled
 * job holding a lock.
 */
export async function prunePositionPings(
  db: Database,
  options: { olderThanDays?: number; now?: Date; batchSize?: number } = {},
): Promise<PrunePositionPingsResult> {
  const { olderThanDays = 7, now = new Date(), batchSize = 5_000 } = options;
  const cutoff = new Date(now.getTime() - olderThanDays * 24 * 60 * 60 * 1000);

  const deleted = await db
    .delete(driverPositionPings)
    .where(
      sql`${driverPositionPings.id} in (
        select id from ${driverPositionPings}
         where ${driverPositionPings.recordedAt} < ${cutoff}
         limit ${batchSize}
      )`,
    )
    .returning({ id: driverPositionPings.id });

  return { deleted: deleted.length };
}
