import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, varchar } from "drizzle-orm/pg-core";

import { createdAt, primaryId, timestamptz } from "./columns";
import { slotTierEnum, type AirportCode } from "./enums";
import { airports } from "./airports";

/**
 * A sellable pickup window at an airport.
 *
 * HISTORICAL. DO NOT BUILD ON THIS TABLE.
 *
 * The product sells 24 VIRTUAL one-hour windows a day, computed per booking
 * from the flight's bag-drop cutoff and the lead-time price curve
 * (`services/windows.ts`, `slots/windows.ts`). No row is inserted here by any
 * code path that runs today, and `createBooking` claims no seat — the
 * transaction it used to claim one in is gone.
 *
 * `capacity` and `booked_count` are what is left of the model that preceded
 * that: a fixed grid of slots with a seat count, incremented inside
 * `createBooking` under a `WHERE booked_count < capacity` guard so two
 * concurrent bookings could not oversell one. Nothing increments either
 * column any more.
 *
 * ONE WRITER SURVIVES, and it is a decrement, not a read:
 * `services/payment-lifecycle.ts` releases a seat
 * (`booked_count = greatest(booked_count - 1, 0)`) when a booking that HAS a
 * `slot_id` is cancelled. Bookings made today have none, so it is a no-op on
 * anything current — it exists for rows that predate the change. Nothing
 * anywhere reads either column to make a decision.
 *
 * Kept rather than dropped because dropping it is a migration with no feature
 * behind it, and because the surviving decrement means historic rows would
 * lose accounting that is at least self-consistent. If the product ever wants
 * real per-window capacity, decide it fresh against the virtual-window model
 * rather than reviving this one.
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
    /** HISTORICAL — see the note above. Read by nothing. */
    capacity: integer("capacity").notNull(),
    /**
     * HISTORICAL — see the note above. Read by nothing; decremented only by
     * the cancellation path in `payment-lifecycle.ts`, for rows old enough to
     * carry a `slot_id`.
     */
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
