import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { createdAt, primaryId, timestamptz, updatedAt } from "./columns";
import { users } from "./identity";

/**
 * The fleet, and who is out in it.
 *
 * This file used to hold `routes` — a driver's planned run for one day to one
 * airport, which never got a route↔booking link, never got a row, and never
 * got a call site. It is dropped in migration 0029 along with the `drivers`
 * and `agents` tables it depended on. What replaces it is deliberately
 * smaller: a truck, a shift, and a last known position. There is no route
 * entity, because Koolee does not plan routes — a customer picks a driver and
 * that driver drives.
 */

/**
 * A vehicle, identified by whatever ops writes on the side of it.
 *
 * `name` is free text and UNIQUE rather than a plate or a size class: the
 * plate changes when the van does, and a size enum ("van" / "box truck")
 * would encode a capacity that `bag_capacity` already states exactly. The
 * name is what a driver and a dispatcher say out loud to each other.
 *
 * Rows are DEACTIVATED, never deleted — `driver_shifts` references them and
 * a finished shift has to stay readable.
 */
export const trucks = pgTable(
  "trucks",
  {
    id: primaryId(),
    name: text("name").notNull(),
    /** How many bags fit. The denominator of every capacity check. */
    bagCapacity: integer("bag_capacity").notNull(),
    /**
     * Spaces held back from customer selection — for a same-day walk-up, a
     * return leg, an oversize item.
     *
     * ENFORCED (slice F4). Every capacity answer in the product comes from
     * `bookableSpaces()` in `services/driver-selection.ts`:
     *
     *     bag_capacity − reserved_spaces − bags already on board
     *
     * Four readers share it — the shortlist filter, the candidate it renders,
     * the transactional recheck under the advisory lock, and the console's
     * reassign picker — because each of them used to compute the subtraction
     * itself, and a reserve honoured in three of four would be a race no test
     * could see.
     *
     * `reserved_spaces < bag_capacity` is enforced in `createTruck` /
     * `updateTruck` rather than as a CHECK: the two columns are edited by one
     * form and the message has to name both numbers. A van with nothing
     * bookable belongs out of service, where the console says so.
     */
    reservedSpaces: integer("reserved_spaces").notNull().default(0),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // Two trucks called "Van 3" is how a dispatcher sends bags to the wrong
    // vehicle. Case-sensitive on purpose — normalising names is the app's job
    // and a silent lowercase here would surprise whoever typed the name.
    uniqueIndex("trucks_name_key").on(t.name),
    index("trucks_active_idx").on(t.active),
    check("trucks_bag_capacity_positive_check", sql`${t.bagCapacity} > 0`),
    check("trucks_reserved_spaces_nonneg_check", sql`${t.reservedSpaces} >= 0`),
  ],
);

/**
 * One person, in one truck, for one stretch of time.
 *
 * The first temporal-availability entity in the schema — `zones.ts:14`
 * deferred it explicitly ("if territories ever get names and shifts of their
 * own, that is the migration to write then") and this is that migration.
 *
 * A shift is the ASSIGNMENT TARGET for a pickup task, not the person: a truck
 * with bags in it is the thing that has to finish the run, and tying the task
 * to the shift is what makes "this person cannot clock off, there are bags in
 * their van" a query rather than a convention.
 *
 * `staff_user_id` points at `users`, matching every other staff-shaped column
 * in the schema (`agent_zones.agent_user_id`, both tasks' `assignee_user_id`).
 * There is no drivers table to point at, by design — a driver is a `users` row
 * with an active `staff_members` row carrying `can_drive`.
 */
export const driverShifts = pgTable(
  "driver_shifts",
  {
    id: primaryId(),
    staffUserId: uuid("staff_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    truckId: uuid("truck_id")
      .notNull()
      .references(() => trucks.id, { onDelete: "restrict" }),
    startedAt: timestamptz("started_at").notNull().defaultNow(),
    /**
     * The ADMIN who opened this shift on the driver's behalf, or null when
     * the driver started it themselves. Null is the ordinary case.
     *
     * WHY A COLUMN AND NOT A CUSTODY EVENT. `custody_events.booking_id` is
     * NOT NULL and a shift belongs to no booking — there is nothing to hang
     * the record on. `adminForceEndShift` gets away with writing custody
     * events because it always touches bookings (it releases their pickups);
     * a start touches none. `admin_audit_log` is the general answer and is
     * still deferred (LAUNCH-CHECKLIST P19), so rather than build half of it
     * for one action, the fact lives on the row it is a fact about.
     *
     * `ON DELETE set null`, not `restrict`: an admin leaving the company must
     * not be undeletable because they once started somebody's shift, and the
     * shift is still a true record of itself without their id.
     */
    startedByUserId: uuid("started_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    /** Null while the shift is open. Set once, never cleared. */
    endedAt: timestamptz("ended_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // The two invariants, enforced by the database rather than by a racing
    // SELECT — the `pricing_rules_one_active_key` idiom. `startShift` catches
    // 23505 and turns it into a domain error; that is the house pattern
    // (dispatch.ts) and it is what makes two dispatchers pressing "start" at
    // the same instant produce one shift instead of two.
    uniqueIndex("driver_shifts_active_staff_key")
      .on(t.staffUserId)
      .where(sql`${t.endedAt} is null`),
    uniqueIndex("driver_shifts_active_truck_key")
      .on(t.truckId)
      .where(sql`${t.endedAt} is null`),
    index("driver_shifts_started_at_idx").on(t.startedAt),
    check(
      "driver_shifts_time_order_check",
      sql`${t.endedAt} is null or ${t.endedAt} >= ${t.startedAt}`,
    ),
  ],
);

/**
 * Where a driver was, last time their phone said anything.
 *
 * ⚠️ HIGH-WRITE, MUTABLE, NON-EVIDENTIARY. This table is explicitly **NOT**
 * part of the chain of custody, and the distinction matters because it looks
 * like it could be.
 *
 * `custody_events.lat/lng` are the evidence: append-only, guarded by a trigger
 * that RAISEs on UPDATE and DELETE, written once at a door with a photo and a
 * seal beside them. THIS table holds exactly one row per driver, overwritten
 * every ~45 seconds by a browser geolocation ping, with no history at all. It
 * exists to answer "how far away is my driver right now" and nothing else.
 * Never cite it in a dispute, never build a timeline from it, and never
 * migrate it into `custody_events`.
 *
 * One row per driver — a latest-position table, not a track. Deleting the row
 * (or never inserting one) is a supported state: selection then shows the
 * "Locating…" fallback rather than inventing a position.
 */
export const driverPositions = pgTable(
  "driver_positions",
  {
    staffUserId: uuid("staff_user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    lat: doublePrecision("lat").notNull(),
    lng: doublePrecision("lng").notNull(),
    /** When the DEVICE fixed the position, not when the row was written. */
    recordedAt: timestamptz("recorded_at").notNull().defaultNow(),
  },
  (t) => [
    index("driver_positions_recorded_at_idx").on(t.recordedAt),
    check("driver_positions_lat_range_check", sql`${t.lat} between -90 and 90`),
    check("driver_positions_lng_range_check", sql`${t.lng} between -180 and 180`),
  ],
);

export type Truck = typeof trucks.$inferSelect;
export type NewTruck = typeof trucks.$inferInsert;
export type DriverShift = typeof driverShifts.$inferSelect;
export type NewDriverShift = typeof driverShifts.$inferInsert;
export type DriverPosition = typeof driverPositions.$inferSelect;
export type NewDriverPosition = typeof driverPositions.$inferInsert;
