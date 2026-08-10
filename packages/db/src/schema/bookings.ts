import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { createdAt, primaryId, timestamptz, updatedAt } from "./columns";
import { bookingStatusEnum, type AirportCode } from "./enums";
import { airports } from "./airports";
import { addresses, users } from "./identity";
import { slots } from "./slots";

/**
 * Snapshot of the pricing engine's output at booking time. Mirrors
 * `PriceBreakdown` in @koolee/core, which owns the authoritative shape —
 * this type exists so the column is not `unknown` (same pattern as
 * `DiscountRuleJson` in billing.ts).
 */
export interface PriceBreakdownJson {
  baseFeeCents: number;
  bagsCents: number;
  distanceCents: number;
  subtotalCents: number;
  leadTimeMultiplier: number;
  leadTimeAdjustmentCents: number;
  discounts: { label: string; amountCents: number }[];
  discountCents: number;
  totalCents: number;
}

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
    /**
     * Legacy pointer into the retired `slots` inventory table. Bookings made
     * since pickup windows became virtual store their window in the two
     * columns below and leave this NULL. Kept for pre-cutover rows.
     */
    slotId: uuid("slot_id").references(() => slots.id, { onDelete: "restrict" }),
    /**
     * The pickup window the customer bought: a clock-aligned one-hour span
     * inside the bookable band (departure − 30h → departure − 6h). Nullable
     * only because legacy rows carry `slot_id` instead — enforced by the
     * window/slot CHECK below.
     */
    pickupWindowStart: timestamptz("pickup_window_start"),
    pickupWindowEnd: timestamptz("pickup_window_end"),
    /**
     * The IANA zone every human-facing time on this booking is rendered in —
     * the departure airport's, snapshotted at creation.
     *
     * Denormalized from `airports.tz` on purpose, and never updated. It makes a
     * booking row SELF-DESCRIBING: any app, in any language, can read the row
     * and render the window correctly with no join, no config, and no
     * institutional knowledge. That property is what stops a new consumer from
     * defaulting to the viewer's or the server's zone, which is the bug this
     * column exists to make impossible.
     *
     * Snapshotting also means a receipt renders in 2030 exactly as it did the
     * day it was bought, even if IANA renames a zone underneath us.
     *
     * See packages/core/src/services/display-tz.ts for the rule and why it is
     * the airport rather than the pickup address.
     */
    displayTz: text("display_tz").notNull(),
    /**
     * The customer's OWN zone when they booked, best-effort from the browser.
     *
     * METADATA ONLY — this must never reach a formatter. Rendering in the
     * viewer's zone is precisely the confusion `display_tz` prevents; the two
     * columns are named as a pair so that misuse reads as wrong at the call
     * site. Nullable and unvalidated beyond a sanity check: VPNs and hardened
     * browsers report odd values, and a booking must never fail over one.
     *
     * What it is legitimately for: support triage ("did they think 10 AM was
     * their time?"), sane notification send-times, and showing the
     * "all times are local to JFK" banner only to customers who aren't local.
     */
    bookedFromTz: text("booked_from_tz"),
    /**
     * Pickup-day contact number for email-only customers (no verified phone on
     * the user). Plain text, never OTP-verified — the driver just needs a
     * number to call at the door.
     */
    contactPhone: varchar("contact_phone", { length: 20 }),

    // --- Money ----------------------------------------------------------
    priceCents: integer("price_cents").notNull(),
    currency: varchar("currency", { length: 3 }).notNull().default("usd"),
    /**
     * Full price breakdown as computed at booking time (see `PriceBreakdown`
     * in @koolee/core). `price_cents` is the authoritative charge; this is
     * the receipt — which lead-time step, distance, and discounts produced
     * it. Feeds the future dynamic-pricing work with real per-window data.
     */
    priceBreakdown: jsonb("price_breakdown").$type<PriceBreakdownJson>(),

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
    // Both window bounds travel together, and end follows start.
    check(
      "bookings_pickup_window_pair_check",
      sql`(${t.pickupWindowStart} is null) = (${t.pickupWindowEnd} is null)`,
    ),
    check(
      "bookings_pickup_window_order_check",
      sql`${t.pickupWindowEnd} is null or ${t.pickupWindowEnd} > ${t.pickupWindowStart}`,
    ),
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
    /**
     * The bag's number within its booking, `1..bagCount` — assigned once at
     * creation, never reused and never reordered.
     *
     * This is the identity a HUMAN uses: what the agent reads off the tag,
     * what the customer sees on their trip page, what ops cites in a dispute.
     * It exists because position in a result set is not an identity — a
     * booking's bags are inserted in one statement and so share `created_at`
     * to the millisecond, which made `order by created_at` a non-deterministic
     * tie. A sealed bag was observed moving from "Bag 1" to "Bag 3" between
     * two renders of the same page.
     *
     * Order by this column and label from this column. Never from array index.
     */
    ordinal: integer("ordinal").notNull(),
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
    // Makes "two bags both called Bag 2" impossible rather than merely
    // unlikely, and gives the ordered reads an index to walk.
    uniqueIndex("bags_booking_ordinal_key").on(t.bookingId, t.ordinal),
  ],
);

export type Booking = typeof bookings.$inferSelect;
export type NewBooking = typeof bookings.$inferInsert;
export type Bag = typeof bags.$inferSelect;
export type NewBag = typeof bags.$inferInsert;
