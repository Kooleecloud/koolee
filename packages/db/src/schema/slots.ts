import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, varchar } from "drizzle-orm/pg-core";

import { createdAt, primaryId, timestamptz } from "./columns";
import { slotTierEnum, type AirportCode } from "./enums";
import { airports } from "./airports";

/**
 * A sellable pickup window at an airport.
 *
 * `booked_count` is denormalised capacity accounting. It is only ever
 * incremented inside the `createBooking` transaction with a
 * `WHERE booked_count < capacity` guard, so two concurrent bookings cannot
 * oversell the same slot. The CHECK below is the belt to that braces.
 */
export const slots = pgTable(
  "slots",
  {
    id: primaryId(),
    airportCode: varchar("airport_code", { length: 3 })
      .$type<AirportCode>()
      .notNull()
      .references(() => airports.code, { onDelete: "restrict" }),
    tier: slotTierEnum("tier").notNull(),
    windowStart: timestamptz("window_start").notNull(),
    windowEnd: timestamptz("window_end").notNull(),
    capacity: integer("capacity").notNull(),
    bookedCount: integer("booked_count").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    index("slots_airport_window_idx").on(t.airportCode, t.windowStart),
    index("slots_window_start_idx").on(t.windowStart),
    check("slots_capacity_nonneg_check", sql`${t.capacity} >= 0`),
    check(
      "slots_booked_within_capacity_check",
      sql`${t.bookedCount} >= 0 and ${t.bookedCount} <= ${t.capacity}`,
    ),
    check("slots_window_order_check", sql`${t.windowEnd} > ${t.windowStart}`),
  ],
);

export type Slot = typeof slots.$inferSelect;
export type NewSlot = typeof slots.$inferInsert;
