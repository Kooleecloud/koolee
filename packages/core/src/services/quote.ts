import { eq } from "drizzle-orm";
import { pricingRules, slots, type Slot } from "@koolee/db";

import type { CoreConfig } from "../config";
import { NotFoundError, PricingRuleInvalidError } from "../errors";
import { price, toPricingRuleInput, type PriceBreakdown } from "../pricing/engine";

/**
 * Read-only price quote for the funnel's price screen.
 *
 * Same rule + engine as `createBooking`, none of the writes. The quote is
 * informational — the authoritative price is computed again inside
 * `createBooking` at the payment step, so a rule change between the two
 * screens can never sell at a stale price.
 */

export interface QuoteBookingPriceInput {
  slotId: string;
  bagCount: number;
  /** Door-to-bag-drop distance. Maps is stubbed, so callers estimate. */
  distanceKm: number;
  promoCode?: string | null;
  isSenior?: boolean;
}

export interface QuoteBookingPriceResult {
  breakdown: PriceBreakdown;
  slot: Slot;
}

export async function quoteBookingPrice(
  config: CoreConfig,
  input: QuoteBookingPriceInput,
): Promise<QuoteBookingPriceResult> {
  const { db } = config;

  const slot = await db.query.slots.findFirst({ where: eq(slots.id, input.slotId) });
  if (!slot) throw new NotFoundError("Slot", input.slotId);

  const rule = await db.query.pricingRules.findFirst({
    where: eq(pricingRules.active, true),
    orderBy: (t, { desc }) => [desc(t.effectiveFrom)],
  });
  if (!rule) {
    throw new PricingRuleInvalidError(
      "No active pricing rule. Run `pnpm seed`, or activate one in the ops console.",
    );
  }

  const breakdown = price({
    rule: toPricingRuleInput(rule),
    bagCount: input.bagCount,
    distanceKm: input.distanceKm,
    slotTier: slot.tier,
    discountContext: {
      promoCode: input.promoCode ?? null,
      isSenior: input.isSenior ?? false,
    },
  });

  return { breakdown, slot };
}
