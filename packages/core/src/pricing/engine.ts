import { z } from "zod";
import type { PricingRule, SlotTier } from "@koolee/db";

import { PricingRuleInvalidError } from "../errors";

/**
 * Pricing engine.
 *
 * Pure and total: same inputs, same cents, no I/O, no clock, no env. Money is
 * integer cents end to end — the only floating point is the intermediate
 * multiplier arithmetic, which is rounded once per stage at a defined point.
 *
 *   subtotal = base + (perBag × bags) + round(centsPerKm × distanceKm)
 *   tiered   = round(subtotal × tierMultiplier)
 *   total    = max(0, tiered − discounts)
 */

/* ------------------------------------------------------------------ */
/* Discounts                                                           */
/* ------------------------------------------------------------------ */

/**
 * Discount rules are stubs. Senior and family are placeholders standing in for
 * a commercial policy that has not been decided; they exist so the shape of
 * the seam is fixed and callers can be written against it.
 */
export const discountRuleSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("percent_off"),
    code: z.string().min(1),
    percent: z.number().min(0).max(100),
  }),
  z.object({
    kind: z.literal("flat_off_cents"),
    code: z.string().min(1),
    amountCents: z.number().int().min(0),
  }),
  z.object({
    kind: z.literal("senior"),
    percent: z.number().min(0).max(100),
  }),
  z.object({
    kind: z.literal("family"),
    minBags: z.number().int().min(1),
    percent: z.number().min(0).max(100),
  }),
]);

export type DiscountRule = z.infer<typeof discountRuleSchema>;

/** Facts about the customer that decide whether a discount applies. */
export interface DiscountContext {
  /** Promo code the customer entered, if any. */
  promoCode?: string | null;
  /** TODO: wire to a verified attribute; self-declared is not sufficient. */
  isSenior?: boolean;
}

/* ------------------------------------------------------------------ */
/* Inputs and outputs                                                  */
/* ------------------------------------------------------------------ */

export const pricingRuleInputSchema = z.object({
  baseFeeCents: z.number().int().min(0),
  perBagCents: z.number().int().min(0),
  /** Cents per kilometre of drive distance. */
  distanceMultiplier: z.number().min(0),
  slotTierMultiplier: z.record(z.string(), z.number().min(0)).default({}),
  discountRules: z.array(discountRuleSchema).default([]),
});

export type PricingRuleInput = z.input<typeof pricingRuleInputSchema>;
export type ResolvedPricingRule = z.output<typeof pricingRuleInputSchema>;

export interface PriceInput {
  rule: PricingRuleInput;
  bagCount: number;
  distanceKm: number;
  slotTier: SlotTier;
  discountContext?: DiscountContext;
}

export interface AppliedDiscount {
  label: string;
  amountCents: number;
}

export interface PriceBreakdown {
  baseFeeCents: number;
  bagsCents: number;
  distanceCents: number;
  subtotalCents: number;
  tierMultiplier: number;
  tierAdjustmentCents: number;
  discounts: AppliedDiscount[];
  discountCents: number;
  /** What the customer is charged. */
  totalCents: number;
}

/* ------------------------------------------------------------------ */
/* price()                                                             */
/* ------------------------------------------------------------------ */

/**
 * Computes the price for a booking.
 *
 * Returns the full breakdown rather than a bare number: the UI has to show the
 * customer where the figure came from, and ops needs it when a charge is
 * disputed. `totalCents` is the amount to authorize.
 */
export function price(input: PriceInput): PriceBreakdown {
  const rule = parseRule(input.rule);

  if (!Number.isInteger(input.bagCount) || input.bagCount < 1) {
    throw new PricingRuleInvalidError(
      `bagCount must be a positive integer, got ${input.bagCount}`,
    );
  }
  if (!Number.isFinite(input.distanceKm) || input.distanceKm < 0) {
    throw new PricingRuleInvalidError(
      `distanceKm must be a non-negative number, got ${input.distanceKm}`,
    );
  }

  const baseFeeCents = rule.baseFeeCents;
  const bagsCents = rule.perBagCents * input.bagCount;
  const distanceCents = Math.round(rule.distanceMultiplier * input.distanceKm);
  const subtotalCents = baseFeeCents + bagsCents + distanceCents;

  // An unlisted tier means "no adjustment", not "free".
  const tierMultiplier = rule.slotTierMultiplier[input.slotTier] ?? 1;
  const tieredCents = Math.round(subtotalCents * tierMultiplier);
  const tierAdjustmentCents = tieredCents - subtotalCents;

  const discounts = applyDiscounts({
    rules: rule.discountRules,
    amountCents: tieredCents,
    bagCount: input.bagCount,
    context: input.discountContext ?? {},
  });
  const discountCents = discounts.reduce((sum, d) => sum + d.amountCents, 0);

  return {
    baseFeeCents,
    bagsCents,
    distanceCents,
    subtotalCents,
    tierMultiplier,
    tierAdjustmentCents,
    discounts,
    discountCents,
    totalCents: Math.max(0, tieredCents - discountCents),
  };
}

/** Just the number, for callers that only need the charge amount. */
export function priceCents(input: PriceInput): number {
  return price(input).totalCents;
}

/**
 * Discounts stack additively against the post-tier amount, and the total is
 * floored at zero. Percentages are taken from the same base rather than
 * compounding, so ordering cannot change the result.
 */
function applyDiscounts(args: {
  rules: readonly DiscountRule[];
  amountCents: number;
  bagCount: number;
  context: DiscountContext;
}): AppliedDiscount[] {
  const { rules, amountCents, bagCount, context } = args;
  const applied: AppliedDiscount[] = [];

  for (const rule of rules) {
    switch (rule.kind) {
      case "percent_off": {
        if (!matchesCode(context.promoCode, rule.code)) break;
        applied.push({
          label: `Promo ${rule.code} (${rule.percent}% off)`,
          amountCents: Math.round((amountCents * rule.percent) / 100),
        });
        break;
      }
      case "flat_off_cents": {
        if (!matchesCode(context.promoCode, rule.code)) break;
        applied.push({
          label: `Promo ${rule.code}`,
          amountCents: Math.min(rule.amountCents, amountCents),
        });
        break;
      }
      case "senior": {
        if (!context.isSenior) break;
        applied.push({
          label: `Senior discount (${rule.percent}% off)`,
          amountCents: Math.round((amountCents * rule.percent) / 100),
        });
        break;
      }
      case "family": {
        if (bagCount < rule.minBags) break;
        applied.push({
          label: `Family rate (${rule.percent}% off ${rule.minBags}+ bags)`,
          amountCents: Math.round((amountCents * rule.percent) / 100),
        });
        break;
      }
    }
  }

  return applied;
}

function matchesCode(entered: string | null | undefined, ruleCode: string): boolean {
  if (!entered) return false;
  return entered.trim().toUpperCase() === ruleCode.trim().toUpperCase();
}

function parseRule(rule: PricingRuleInput): ResolvedPricingRule {
  const parsed = pricingRuleInputSchema.safeParse(rule);
  if (!parsed.success) {
    throw new PricingRuleInvalidError(
      parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    );
  }
  return parsed.data;
}

/**
 * Adapts a `pricing_rules` row to the engine's input.
 *
 * `distance_multiplier` is `numeric` in Postgres, which postgres-js returns as
 * a string to avoid precision loss. Parsing it here keeps the engine's
 * signature free of database concerns.
 */
export function toPricingRuleInput(row: PricingRule): PricingRuleInput {
  const distanceMultiplier = Number(row.distanceMultiplier);
  if (!Number.isFinite(distanceMultiplier)) {
    throw new PricingRuleInvalidError(
      `distance_multiplier "${row.distanceMultiplier}" is not a number`,
    );
  }

  return {
    baseFeeCents: row.baseFeeCents,
    perBagCents: row.perBagCents,
    distanceMultiplier,
    slotTierMultiplier: row.slotTierMultiplier ?? {},
    discountRules: (row.discountRules ?? []) as DiscountRule[],
  };
}
