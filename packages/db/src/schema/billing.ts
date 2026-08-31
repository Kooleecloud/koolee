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
    /**
     * Provider-side capture id, set when the authorization is captured at
     * pickup. Stripe reuses the PaymentIntent id; the fake provider mints a
     * distinct one — refunds go against this when present.
     */
    captureRef: text("capture_ref"),
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

/**
 * DEPRECATED — the tiered-window product is retired; pickup windows are all
 * one hour and priced by lead time (`LeadTimeMultiplierJson`). The column
 * stays so pre-cutover rule rows keep their history; the engine no longer
 * reads it.
 */
export type SlotTierMultiplier = Partial<Record<SlotTier, number>>;

/**
 * One step of the lead-time price curve. A window whose END is within
 * `maxLeadMinutes` of departure gets `multiplier` applied to the subtotal;
 * the smallest matching step wins, and no match means ×1. This is the seam
 * the real dynamic-pricing algorithm will replace — @koolee/core validates
 * the blob with zod before applying it.
 */
export interface LeadTimeMultiplierJson {
  maxLeadMinutes: number;
  multiplier: number;
}

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
    /** Lead-time price curve — see `LeadTimeMultiplierJson`. */
    leadTimeMultipliers: jsonb("lead_time_multipliers")
      .$type<LeadTimeMultiplierJson[]>()
      .notNull()
      .default([]),
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
    // At most ONE active rule, enforced by the database: every active row has
    // the same index key (true), so a second `active = true` violates
    // uniqueness. The pricing engine reads "the" active rule; two of them is
    // the #41/#51 fixture-leakage class this closes for good.
    uniqueIndex("pricing_rules_one_active_key")
      .on(t.active)
      .where(sql`${t.active}`),
    check("pricing_rules_base_fee_nonneg_check", sql`${t.baseFeeCents} >= 0`),
    check("pricing_rules_per_bag_nonneg_check", sql`${t.perBagCents} >= 0`),
  ],
);

/**
 * Processed payment-webhook event ids — the replay guard.
 *
 * Providers redeliver webhooks (that is the contract), so the handler
 * records each event id it fully processed and no-ops on a repeat. Rows are
 * tiny and append-only; prune with the daily cleanup if volume ever matters.
 */
export const paymentWebhookEvents = pgTable(
  "payment_webhook_events",
  {
    id: primaryId(),
    /** "stripe" | "fake". */
    provider: text("provider").notNull(),
    /** Provider-side event id (`evt_…` for Stripe). */
    eventId: text("event_id").notNull(),
    /** Normalised event type, for debugging redeliveries. */
    eventType: text("event_type").notNull(),
    receivedAt: createdAt(),
  },
  (t) => [
    uniqueIndex("payment_webhook_events_provider_event_key").on(t.provider, t.eventId),
  ],
);

export type Payment = typeof payments.$inferSelect;
export type NewPayment = typeof payments.$inferInsert;
export type PaymentWebhookEvent = typeof paymentWebhookEvents.$inferSelect;
export type PricingRule = typeof pricingRules.$inferSelect;
export type NewPricingRule = typeof pricingRules.$inferInsert;
