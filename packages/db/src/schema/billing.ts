import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { createdAt, primaryId, timestamptz, updatedAt } from "./columns";
import { paymentStatusEnum, type SlotTier } from "./enums";
import { bookings } from "./bookings";

/**
 * One payment attempt against a booking.
 *
 * `(provider, provider_ref)` is unique: it is the idempotency key for webhook
 * processing. Stripe will redeliver the same event, and this constraint is
 * what makes "process it again" a no-op rather than a double capture.
 */
export const payments = pgTable(
  "payments",
  {
    id: primaryId(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "restrict" }),
    /** "stripe" | "fake" — matches the PaymentProvider implementation name. */
    provider: text("provider").notNull(),
    /** Provider-side id: a PaymentIntent id for Stripe. */
    providerRef: text("provider_ref").notNull(),
    status: paymentStatusEnum("status").notNull(),
    amountCents: integer("amount_cents").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("payments_provider_ref_key").on(t.provider, t.providerRef),
    index("payments_booking_id_idx").on(t.bookingId),
    index("payments_status_idx").on(t.status),
    check("payments_amount_nonneg_check", sql`${t.amountCents} >= 0`),
  ],
);

/** Per-tier multiplier applied on top of the base + per-bag + distance total. */
export type SlotTierMultiplier = Partial<Record<SlotTier, number>>;

/**
 * A discount rule. Shapes are stubbed — senior and family are placeholders
 * until the commercial policy is decided. `@koolee/core` validates this blob
 * with zod before applying it.
 */
export type DiscountRuleJson =
  | { kind: "percent_off"; code: string; percent: number }
  | { kind: "flat_off_cents"; code: string; amountCents: number }
  | { kind: "senior"; percent: number }
  | { kind: "family"; minBags: number; percent: number };

export const pricingRules = pgTable(
  "pricing_rules",
  {
    id: primaryId(),
    name: text("name").notNull(),
    baseFeeCents: integer("base_fee_cents").notNull(),
    perBagCents: integer("per_bag_cents").notNull(),
    /** Cents charged per km of drive distance, before the tier multiplier. */
    distanceMultiplier: numeric("distance_multiplier", {
      precision: 8,
      scale: 4,
    }).notNull(),
    slotTierMultiplier: jsonb("slot_tier_multiplier")
      .$type<SlotTierMultiplier>()
      .notNull()
      .default({}),
    discountRules: jsonb("discount_rules")
      .$type<DiscountRuleJson[]>()
      .notNull()
      .default([]),
    active: boolean("active").notNull().default(false),
    effectiveFrom: timestamptz("effective_from").notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("pricing_rules_active_effective_idx").on(t.active, t.effectiveFrom),
    check("pricing_rules_base_fee_nonneg_check", sql`${t.baseFeeCents} >= 0`),
    check("pricing_rules_per_bag_nonneg_check", sql`${t.perBagCents} >= 0`),
  ],
);

export type Payment = typeof payments.$inferSelect;
export type NewPayment = typeof payments.$inferInsert;
export type PricingRule = typeof pricingRules.$inferSelect;
export type NewPricingRule = typeof pricingRules.$inferInsert;
