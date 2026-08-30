"use server";

import { z } from "zod";
import {
  getActivePricingRule,
  price,
  toPricingRuleInput,
  TYPICAL_AIRPORT_DISTANCE_KM,
  type PricingRuleInput,
} from "@koolee/core";
import type { PriceEstimateResult } from "@koolee/ui";

import { tryGetCore } from "@/lib/core";

/**
 * Public price estimate, computed by the same core engine — and now from the
 * same RULE — that prices real bookings.
 *
 * This is a server action, so it can read the database even though the page
 * around it renders statically. It did not, and that was a real hazard rather
 * than a tidiness one: the numbers below were a hand-kept mirror of the seed,
 * and Tier 5 gave ops a console at `/pricing` that changes the live rule. A
 * mirror that nobody remembers to update becomes a public quote that no longer
 * matches what the funnel charges.
 *
 * The pinned rule stays as the FALLBACK, for the two cases where reading is
 * not possible or not meaningful: a build or preview with no database, and a
 * database with no active rule (where the funnel refuses to quote at all — the
 * public page saying "about $59" is better than a stack trace on a marketing
 * page).
 */
const LAUNCH_RULE: PricingRuleInput = {
  baseFeeCents: 2900,
  perBagCents: 1500,
  distanceMultiplier: 45, // cents per km
  leadTimeMultipliers: [
    { maxLeadMinutes: 10 * 60, multiplier: 1.4 },
    { maxLeadMinutes: 16 * 60, multiplier: 1.2 },
    { maxLeadMinutes: 24 * 60, multiplier: 1.1 },
  ],
  discountRules: [{ kind: "family", minBags: 3, percent: 10 }],
};

/**
 * Representative lead (minutes from window end to departure) per timing
 * choice — the midpoint of each band of the launch lead-time curve.
 */
const TIMING_LEAD_MINUTES: Record<string, number> = {
  lead_24h_plus: 27 * 60,
  lead_16_24h: 20 * 60,
  lead_10_16h: 13 * 60,
  lead_6_10h: 8 * 60,
};

const TIMING_LABEL: Record<string, string> = {
  lead_24h_plus: "Window 24+ hours before departure",
  lead_16_24h: "Window 16–24 hours before departure",
  lead_10_16h: "Window 10–16 hours before departure",
  lead_6_10h: "Window 6–10 hours before departure",
};

const inputSchema = z.object({
  bagCount: z.number().int().min(1).max(8),
  tierId: z.enum(["lead_24h_plus", "lead_16_24h", "lead_10_16h", "lead_6_10h"]),
  airportCode: z.enum(["JFK", "LGA", "EWR"]),
});

/** The live rule, or the pinned one. Never throws — this is a marketing page. */
async function resolveRule(): Promise<PricingRuleInput> {
  try {
    const core = tryGetCore();
    if (!core) return LAUNCH_RULE;
    const active = await getActivePricingRule(core.db);
    return active ? toPricingRuleInput(active) : LAUNCH_RULE;
  } catch (error) {
    console.error("[pricing] falling back to the pinned launch rule", error);
    return LAUNCH_RULE;
  }
}

export async function estimatePrice(input: {
  bagCount: number;
  tierId: string;
  airportCode: string;
}): Promise<PriceEstimateResult> {
  const parsed = inputSchema.parse(input);
  const rule = await resolveRule();
  // The same table the funnel falls back to when an address has no
  // coordinates — imported, not copied. This page used to hold its own copy
  // while four funnel call sites passed a flat 20 km, which is how a public
  // quote and the price of the same trip came to differ by $2.70.
  const distanceKm = TYPICAL_AIRPORT_DISTANCE_KM[parsed.airportCode] ?? 20;

  const breakdown = price({
    rule,
    bagCount: parsed.bagCount,
    distanceKm,
    pickupLeadMinutes: TIMING_LEAD_MINUTES[parsed.tierId] ?? 27 * 60,
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

  if (breakdown.leadTimeAdjustmentCents !== 0) {
    lines.push({
      label: TIMING_LABEL[parsed.tierId] ?? "Pickup timing",
      amountCents: breakdown.leadTimeAdjustmentCents,
    });
  }

  for (const discount of breakdown.discounts) {
    lines.push({ label: discount.label, amountCents: -discount.amountCents });
  }

  return { totalCents: breakdown.totalCents, currency: "usd", lines };
}
