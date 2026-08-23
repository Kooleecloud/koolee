import { sql } from "drizzle-orm";
import { check, index, pgTable, text, uuid, varchar } from "drizzle-orm/pg-core";

import { createdAt, primaryId, timestamptz } from "./columns";
import type { AirportCode } from "./enums";
import { airports } from "./airports";
import { users } from "./identity";

/**
 * An ops-declared blackout over the virtual pickup-window calendar.
 *
 * Pickup windows are not stored — they are enumerated on demand as
 * clock-aligned one-hour spans inside the flight's bookable band. A row here
 * removes every window that OVERLAPS `[block_start, block_end)` at the given
 * airport from what customers can see and book. Existing bookings inside a
 * blocked span are untouched; a block only stops new sales.
 */
export const slotBlocks = pgTable(
  "slot_blocks",
  {
    id: primaryId(),
    airportCode: varchar("airport_code", { length: 3 })
      .$type<AirportCode>()
      .notNull()
      .references(() => airports.code, { onDelete: "restrict" }),
    blockStart: timestamptz("block_start").notNull(),
    blockEnd: timestamptz("block_end").notNull(),
    /** Free-text ops note ("no drivers", "weather"), shown only in admin. */
    reason: text("reason"),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
  },
  (t) => [
    index("slot_blocks_airport_start_idx").on(t.airportCode, t.blockStart),
    check("slot_blocks_order_check", sql`${t.blockEnd} > ${t.blockStart}`),
  ],
);

export type SlotBlock = typeof slotBlocks.$inferSelect;
export type NewSlotBlock = typeof slotBlocks.$inferInsert;
