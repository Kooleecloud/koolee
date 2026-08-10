import { eq } from "drizzle-orm";
import { pricingRules } from "@koolee/db";

import type { CoreConfig } from "../config";
import { PricingRuleInvalidError } from "../errors";
import { price, toPricingRuleInput, type PriceBreakdown } from "../pricing/engine";
import { pickupLeadMinutesFor } from "../slots/windows";

/**
 * Read-only price quote for the funnel.
 *
 * Same rule + engine as `createBooking`, none of the writes. The quote is
 * informational — the authoritative price is computed again inside
 * `createBooking` at the payment step. Both derive the lead-time input from
 * (window, flight) alone, so the two can only disagree if the pricing RULE
 * changed in between — a rule change between screens can never sell at a
 * stale price.
 */

export interface QuoteBookingPriceInput {
  pickupWindowEnd: Date;
  departureAt: Date;
  bagCount: number;
  /** Door-to-bag-drop distance. Maps is stubbed, so callers estimate. */
  distanceKm: number;
  promoCode?: string | null;
  isSenior?: boolean;
}

export interface QuoteBookingPriceResult {
  breakdown: PriceBreakdown;
}

export async function quoteBookingPrice(
  config: CoreConfig,
  input: QuoteBookingPriceInput,
): Promise<QuoteBookingPriceResult> {
  const { db } = config;

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
    pickupLeadMinutes: pickupLeadMinutesFor(input.pickupWindowEnd, input.departureAt),
    discountContext: {
      promoCode: input.promoCode ?? null,
      isSenior: input.isSenior ?? false,
    },
  });

  return { breakdown };
}
