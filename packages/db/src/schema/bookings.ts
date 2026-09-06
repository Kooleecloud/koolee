import { sql } from "drizzle-orm";
import {
  check,
  doublePrecision,
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
    /**
     * Human-quotable booking reference, `KOO-XXXXX`.
     *
     * The id a customer reads off an email to a support agent, and the one
     * ops types into a search box. It exists because a UUID is not something
     * a person can say out loud, and the two ad-hoc substitutes it replaces
     * (`KL-` + last six hex in apps/web, bare last-six-hex in apps/admin)
     * were DERIVED from the id — so the same booking had two different
     * "references" depending on which console you were looking at.
     *
     * The five payload characters are Crockford base32, which drops `I`,
     * `L`, `O` and `U`: no glyph pair a human can confuse survives, so a ref
     * read over a phone transcribes back to the same row.
     *
     * DISPLAY AND SUPPORT ONLY. Nothing authenticates or authorizes on this
     * value and no public route looks a booking up by it — 32^5 is ~33.5M,
     * fine for uniqueness and hopeless as a secret. The trip page stays
     * UUID-addressed.
     */
    ref: varchar("ref", { length: 9 }).notNull(),
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
    /**
     * Where the flight lands. IATA, uppercased, and DELIBERATELY NOT A
     * FOREIGN KEY: `airports` holds the three we collect from, and a
     * destination is anywhere on earth.
     *
     * Nullable, and null is ordinary — a hand-typed booking has no
     * destination unless the customer offers one, and an e-ticket we could
     * only half read has none either. Nothing operational depends on it.
     *
     * It exists for RECOGNITION. A customer scanning their history does not
     * remember "AI144"; they remember flying to Delhi. Every surface that
     * renders it falls back to the departure airport alone.
     */
    destinationAirport: varchar("destination_airport", { length: 3 }),
    /** Name on the ticket. Checked against photo ID at pickup. */
    paxName: text("pax_name").notNull(),

    // --- Pickup ---------------------------------------------------------
    /**
     * The saved address this booking was created FROM, when it still exists.
     *
     * Nullable and `ON DELETE SET NULL` since 0033. It used to be a NOT NULL
     * `ON DELETE RESTRICT` pointer that every reader joined through, which had
     * two consequences, both bugs:
     *
     *  1. A customer could never delete a saved address they had ever booked
     *     from — the account page could only answer "that address is part of a
     *     booking's record".
     *  2. EDITING a saved address silently rewrote history. `bookings` held no
     *     address of its own, so correcting a typo in "Home" changed the
     *     doorstep printed on a pickup that happened last March.
     *
     * The `pickup_*` columns below are the booking's OWN address, snapshotted
     * at creation and never updated — the same self-describing-row rule
     * `display_tz` follows. THIS COLUMN IS A PROVENANCE POINTER, NOT AN
     * ADDRESS: read the snapshot, always. Nothing may join through it to
     * render a doorstep.
     */
    pickupAddressId: uuid("pickup_address_id").references(() => addresses.id, {
      onDelete: "set null",
    }),
    /**
     * The doorstep, as it was when the booking was made.
     *
     * Snapshotted once and never updated. An agent standing at a door, a
     * confirmation email sent six weeks ago, and a dispute settled next year
     * must all read the same address — which is only true if the booking
     * carries it rather than pointing at a row the customer can edit or
     * delete. See `bookingPickupAddress` in @koolee/core, which is the one
     * reader every surface goes through.
     */
    pickupLine1: text("pickup_line1").notNull(),
    pickupLine2: text("pickup_line2"),
    pickupCity: text("pickup_city").notNull(),
    pickupState: varchar("pickup_state", { length: 2 }).notNull(),
    /**
     * The pickup ZIP, snapshotted.
     *
     * Also the column dispatch and the zone queries filter on — they used to
     * join `addresses` for exactly this value, which meant a booking's zone
     * could move when somebody edited their saved address.
     */
    pickupZip: varchar("pickup_zip", { length: 10 }).notNull(),
    /**
     * The precise point behind the address, when Places supplied one. Null is
     * a real and common state (hand-typed address); every consumer falls back
     * to the ZIP centroid, which is what they did before this column existed.
     */
    pickupLat: doublePrecision("pickup_lat"),
    pickupLng: doublePrecision("pickup_lng"),
    /** Google Place ID, when the address came from autocomplete. */
    pickupPlaceId: text("pickup_place_id"),
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
    // UNIQUE, not merely indexed: a collision would put two bookings behind
    // one thing a human says out loud, and the generator's retry loop needs
    // the database to be the arbiter rather than a racing SELECT.
    uniqueIndex("bookings_ref_key").on(t.ref),
    index("bookings_user_id_idx").on(t.userId),
    index("bookings_status_idx").on(t.status),
    index("bookings_departure_at_idx").on(t.departureAt),
    index("bookings_slot_id_idx").on(t.slotId),
    index("bookings_status_departure_idx").on(t.status, t.departureAt),
    // Dispatch and the zone sweeps filter on this; they used to reach it
    // through a join on `addresses`.
    index("bookings_pickup_zip_idx").on(t.pickupZip),
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
    // Partial UNIQUE, not a plain index: a tamper-evident seal is single-use,
    // so its printed id identifies exactly one bag across the whole operation.
    // Partial because unsealed bags all hold NULL and must not collide.
    // Enforced here rather than only in `recordBagSealed` because the app
    // check races and this one cannot.
    uniqueIndex("bags_seal_id_key")
      .on(t.sealId)
      .where(sql`${t.sealId} is not null`),
    // Makes "two bags both called Bag 2" impossible rather than merely
    // unlikely, and gives the ordered reads an index to walk.
    uniqueIndex("bags_booking_ordinal_key").on(t.bookingId, t.ordinal),
  ],
);

export type Booking = typeof bookings.$inferSelect;
export type NewBooking = typeof bookings.$inferInsert;
export type Bag = typeof bags.$inferSelect;
export type NewBag = typeof bags.$inferInsert;
