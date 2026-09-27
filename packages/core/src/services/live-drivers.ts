import { desc, eq, isNull, sql } from "drizzle-orm";
import {
  bookings,
  driverPositions,
  driverShifts,
  pickupTasks,
  trucks,
  users,
  type Database,
} from "@koolee/db";

import { positionHealthOf, type PositionHealth } from "./position-health";

/**
 * Everybody on the road right now, with where they are — the admin live map's
 * one read.
 *
 * WHY THIS IS NOT `listShifts` PLUS `listStalePositionShifts`. The shifts page
 * already loads both and joins them by shift id to badge a quiet driver. The
 * map needs the OPPOSITE join: every open shift, each with its position if it
 * has one, and a health verdict on every row rather than only on the flagged
 * ones. Stitching that from the two existing reads means a third query for the
 * positions anyway; one left join answers it in a single round trip and gives
 * the map a row shape it can seed a client from without reassembly.
 *
 * ONE ROW PER OPEN SHIFT, POSITION OR NOT. A driver who clocked on with
 * location denied has no `driver_positions` row and must still be on the
 * roster — that is the `silent` state, and it is the one a dispatcher most
 * needs to see before the van leaves. The `left join` keeps them; the map draws
 * no pin and the legend counts them.
 *
 * THE VERDICT IS COMPUTED ONCE, HERE, with the same `positionHealthOf` the
 * console row and the nudge job use, so the map cannot disagree with either
 * about what "stale" means. The browser then recomputes it on a timer from
 * `recordedAt` as the seconds pass — same rule, same gap — because a verdict
 * frozen at render time goes wrong within two minutes of the page being open.
 */
export interface LiveDriver {
  shiftId: string;
  staffUserId: string;
  fullName: string | null;
  truckName: string;
  /** Bags committed to this shift right now — what the popup says is aboard. */
  bagsOnBoard: number;
  /** Last known fix, or null when the phone has never reported this shift. */
  position: { lat: number; lng: number } | null;
  recordedAt: Date | null;
  health: PositionHealth;
}

/**
 * Open shifts with their driver's last known position and its health.
 *
 * Newest shift first, so a driver who just clocked on lands at the top of any
 * list rendered beside the map.
 */
export async function listLiveDrivers(
  db: Database,
  now: Date = new Date(),
): Promise<LiveDriver[]> {
  // The same subquery `listShifts` uses. Inlined rather than shared because a
  // drizzle `sql` fragment referencing `driverShifts.id` binds to the query it
  // sits in; lifting it into a helper is a refactor with no second caller yet.
  const bagsOnBoardSql = sql<number>`(
    select coalesce(sum(b.bag_count), 0)::int
      from ${pickupTasks} pt
      join ${bookings} b on b.id = pt.booking_id
     where pt.driver_shift_id = ${driverShifts.id}
       and pt.status in ('pending', 'assigned', 'in_progress')
  )`;

  const rows = await db
    .select({
      shiftId: driverShifts.id,
      staffUserId: driverShifts.staffUserId,
      fullName: users.fullName,
      truckName: trucks.name,
      bagsOnBoard: bagsOnBoardSql,
      lat: driverPositions.lat,
      lng: driverPositions.lng,
      recordedAt: driverPositions.recordedAt,
    })
    .from(driverShifts)
    .innerJoin(users, eq(users.id, driverShifts.staffUserId))
    .innerJoin(trucks, eq(trucks.id, driverShifts.truckId))
    .leftJoin(driverPositions, eq(driverPositions.staffUserId, driverShifts.staffUserId))
    .where(isNull(driverShifts.endedAt))
    .orderBy(desc(driverShifts.startedAt));

  return rows.map((row) => ({
    shiftId: row.shiftId,
    staffUserId: row.staffUserId,
    fullName: row.fullName,
    truckName: row.truckName,
    bagsOnBoard: row.bagsOnBoard ?? 0,
    // Both halves are NOT NULL on the row, so one null means the whole row
    // was absent from the left join — a driver who has never reported.
    position:
      row.lat === null || row.lng === null ? null : { lat: row.lat, lng: row.lng },
    recordedAt: row.recordedAt,
    health: positionHealthOf(row.recordedAt, now).health,
  }));
}
