"use server";

import { z } from "zod";
import { price, type PricingRuleInput, type SlotTier } from "@koolee/core";
import type { PriceEstimateResult } from "@koolee/ui";

/**
 * Public price estimate, computed by the same core engine that prices real
 * bookings.
 *
 * The rule mirrors the seeded "launch-v1" pricing row (packages/db seed). The
 * marketing site cannot read the database (apps go through core services and
 * this page must render statically), so the launch numbers are pinned here —
 * keep in sync with the seed until a `getActivePricingRule` core service
 * exists. The booking flow always prices from the live rule.
 */
const LAUNCH_RULE: PricingRuleInput = {
  baseFeeCents: 2900,
  perBagCents: 1500,
  distanceMultiplier: 45, // cents per km
  slotTierMultiplier: { standard_4h: 1, express_2h: 1.35, priority_1h: 1.8 },
  discountRules: [{ kind: "family", minBags: 3, percent: 10 }],
};

/** Typical drive distance from the service area, per airport (km). */
const TYPICAL_DISTANCE_KM: Record<string, number> = {
  JFK: 26,
  LGA: 13,
  EWR: 19,
};

const TIER_LABEL: Record<SlotTier, string> = {
  standard_4h: "Standard window",
  express_2h: "Express window",
  priority_1h: "Priority window",
};

const inputSchema = z.object({
  bagCount: z.number().int().min(1).max(8),
  tierId: z.enum(["standard_4h", "express_2h", "priority_1h"]),
  airportCode: z.enum(["JFK", "LGA", "EWR"]),
});

export async function estimatePrice(input: {
  bagCount: number;
  tierId: string;
  airportCode: string;
}): Promise<PriceEstimateResult> {
  const parsed = inputSchema.parse(input);
  const distanceKm = TYPICAL_DISTANCE_KM[parsed.airportCode] ?? 20;

  const breakdown = price({
    rule: LAUNCH_RULE,
    bagCount: parsed.bagCount,
    distanceKm,
    slotTier: parsed.tierId,
  });

  const lines = [
    { label: "Base fee", amountCents: breakdown.baseFeeCents },
    {
      label: `${parsed.bagCount} ${parsed.bagCount === 1 ? "bag" : "bags"}`,
      amountCents: breakdown.bagsCents,
    },
    {
      label: `Travel to ${parsed.airportCode} (typical)`,
      amountCents: breakdown.distanceCents,
    },
  ];

  if (breakdown.tierAdjustmentCents !== 0) {
    lines.push({
      label: TIER_LABEL[parsed.tierId],
      amountCents: breakdown.tierAdjustmentCents,
    });
  }

  for (const discount of breakdown.discounts) {
    lines.push({ label: discount.label, amountCents: -discount.amountCents });
  }

  return { totalCents: breakdown.totalCents, currency: "usd", lines };
}
