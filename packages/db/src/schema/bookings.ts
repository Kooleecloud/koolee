import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  numeric,
  pgTable,
  text,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { createdAt, primaryId, timestamptz, updatedAt } from "./columns";
import { bookingStatusEnum, type AirportCode } from "./enums";
import { airports } from "./airports";
import { addresses, users } from "./identity";
import { slots } from "./slots";

export const bookings = pgTable(
  "bookings",
  {
    id: primaryId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    status: bookingStatusEnum("status").notNull().default("draft"),

    // --- Flight ---------------------------------------------------------
    flightNumber: varchar("flight_number", { length: 10 }).notNull(),
    airlineIata: varchar("airline_iata", { length: 3 }).notNull(),
    departureAirport: varchar("departure_airport", { length: 3 })
      .$type<AirportCode>()
      .notNull()
      .references(() => airports.code, { onDelete: "restrict" }),
    departureAt: timestamptz("departure_at").notNull(),
    /** Name on the ticket. Checked against photo ID at pickup. */
    paxName: text("pax_name").notNull(),

    // --- Pickup ---------------------------------------------------------
    pickupAddressId: uuid("pickup_address_id")
      .notNull()
      .references(() => addresses.id, { onDelete: "restrict" }),
    bagCount: integer("bag_count").notNull(),
    slotId: uuid("slot_id").references(() => slots.id, { onDelete: "restrict" }),
    /**
     * Pickup-day contact number for email-only customers (no verified phone on
     * the user). Plain text, never OTP-verified — the driver just needs a
     * number to call at the door.
     */
    contactPhone: varchar("contact_phone", { length: 20 }),

    // --- Money ----------------------------------------------------------
    priceCents: integer("price_cents").notNull(),
    currency: varchar("currency", { length: 3 }).notNull().default("usd"),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("bookings_user_id_idx").on(t.userId),
    index("bookings_status_idx").on(t.status),
    index("bookings_departure_at_idx").on(t.departureAt),
    index("bookings_slot_id_idx").on(t.slotId),
    index("bookings_status_departure_idx").on(t.status, t.departureAt),
    check("bookings_bag_count_positive_check", sql`${t.bagCount} > 0`),
    check("bookings_price_nonneg_check", sql`${t.priceCents} >= 0`),
  ],
);

/**
 * One physical bag.
 *
 * `seal_id` is deliberately an opaque string: the seal technology (RFID tag vs
 * printed QR) is still undecided, and both produce a scannable identifier. No
 * code should parse or infer structure from this value.
 */
export const bags = pgTable(
  "bags",
  {
    id: primaryId(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
    sealId: text("seal_id"),
    weightKg: numeric("weight_kg", { precision: 6, scale: 2 }),
    photoUrls: text("photo_urls")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("bags_booking_id_idx").on(t.bookingId),
    index("bags_seal_id_idx").on(t.sealId),
  ],
);

export type Booking = typeof bookings.$inferSelect;
export type NewBooking = typeof bookings.$inferInsert;
export type Bag = typeof bags.$inferSelect;
export type NewBag = typeof bags.$inferInsert;
