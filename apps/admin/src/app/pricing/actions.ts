"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  InvalidInputError,
  NotFoundError,
  publishPricingRule,
  reactivatePricingRule,
  type DiscountRuleJson,
  type LeadTimeMultiplierJson,
} from "@koolee/core";

import { getCore } from "@/lib/core";
import { requireAdminSession } from "@/lib/session";

/**
 * Pricing, from the console.
 *
 * A publish writes a NEW active rule and deactivates the old one — see
 * `services/pricing-rules.ts` for why that rather than an in-place edit. No
 * booking is repriced by it: `bookings.price_cents` is the authoritative
 * charge and its breakdown is snapshotted on the row.
 *
 * Money is entered in DOLLARS on screen and stored in CENTS. The conversion
 * happens once, here, at the boundary — never in the form (where a rounding
 * slip is invisible) and never in core (which is integer cents end to end).
 */

export interface PricingActionState {
  error?: string;
  ok?: string;
}

function fail(error: unknown, fallback: string): PricingActionState {
  if (error instanceof InvalidInputError || error instanceof NotFoundError) {
    return { error: error.message };
  }
  console.error("[pricing]", fallback, error);
  return { error: fallback };
}

/** "29" / "29.00" / "$29" → 2900. Rejects anything else. */
function dollarsToCents(raw: string, label: string): number {
  const cleaned = raw.trim().replace(/^\$/, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
    throw new InvalidInputError(`${label} must be an amount like 29 or 29.50.`);
  }
  return Math.round(Number(cleaned) * 100);
}

const publishSchema = z.object({
  name: z.string().trim().min(1).max(120),
  baseFee: z.string().trim().min(1),
  perBag: z.string().trim().min(1),
  perKm: z.string().trim().min(1),
  leadTimeCurve: z.string(),
  discountRules: z.string(),
});

/**
 * The lead-time curve, as an operator types it: one step per line,
 * `<hours> <multiplier>`.
 *
 * A JSON textarea was the alternative and it is worse for the person who has
 * to change a price on a Tuesday: this is the shape of the thing being
 * described, and hours are the unit the curve is talked about in, while the
 * column stores minutes.
 */
function parseLeadTimeCurve(raw: string): LeadTimeMultiplierJson[] {
  const steps: LeadTimeMultiplierJson[] = [];
  for (const [index, line] of raw.split("\n").entries()) {
    const text = line.trim();
    if (text.length === 0 || text.startsWith("#")) continue;

    const match = /^(\d+(?:\.\d+)?)\s*h?\s*[, \t]\s*(?:x|×)?\s*(\d+(?:\.\d+)?)$/i.exec(
      text,
    );
    if (!match) {
      throw new InvalidInputError(
        `Line ${index + 1} of the lead-time curve should read like "10 1.4" — hours, then the multiplier.`,
      );
    }
    steps.push({
      maxLeadMinutes: Math.round(Number(match[1]) * 60),
      multiplier: Number(match[2]),
    });
  }
  return steps;
}

function parseDiscountRules(raw: string): DiscountRuleJson[] {
  const text = raw.trim();
  if (text.length === 0) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new InvalidInputError("The discount rules are not valid JSON.");
  }
  if (!Array.isArray(parsed)) {
    throw new InvalidInputError("The discount rules must be a JSON array.");
  }
  // Shape is validated in core against the engine's own schema — one
  // definition of what a discount is, so the console cannot write something
  // the engine would reject at quote time.
  return parsed as DiscountRuleJson[];
}

export async function publishPricingRuleAction(
  _prev: PricingActionState,
  form: FormData,
): Promise<PricingActionState> {
  try {
    await requireAdminSession();
  } catch {
    return { error: "Not signed in as an admin." };
  }

  const parsed = publishSchema.safeParse({
    name: String(form.get("name") ?? ""),
    baseFee: String(form.get("baseFee") ?? ""),
    perBag: String(form.get("perBag") ?? ""),
    perKm: String(form.get("perKm") ?? ""),
    leadTimeCurve: String(form.get("leadTimeCurve") ?? ""),
    discountRules: String(form.get("discountRules") ?? ""),
  });
  if (!parsed.success) {
    return {
      error: "Fill in the name, the base fee, the per-bag fee and the per-km rate.",
    };
  }

  try {
    const rule = await publishPricingRule(getCore().db, {
      name: parsed.data.name,
      baseFeeCents: dollarsToCents(parsed.data.baseFee, "The base fee"),
      perBagCents: dollarsToCents(parsed.data.perBag, "The per-bag fee"),
      // Cents per km, entered in cents because that is how it is talked about
      // — "45 cents a kilometre" — and it is not a dollar amount.
      distanceMultiplier: Number(parsed.data.perKm.trim()),
      leadTimeMultipliers: parseLeadTimeCurve(parsed.data.leadTimeCurve),
      discountRules: parseDiscountRules(parsed.data.discountRules),
    });
    revalidatePath("/pricing");
    return { ok: `${rule.name} is live. Every new quote uses it from now.` };
  } catch (error) {
    return fail(error, "Couldn't publish that rule.");
  }
}

export async function reactivatePricingRuleAction(
  _prev: PricingActionState,
  form: FormData,
): Promise<PricingActionState> {
  try {
    await requireAdminSession();
  } catch {
    return { error: "Not signed in as an admin." };
  }

  const id = String(form.get("id") ?? "");
  if (!id) return { error: "Something went wrong — reload the page." };

  try {
    const rule = await reactivatePricingRule(getCore().db, id);
    revalidatePath("/pricing");
    return { ok: `${rule.name} is live again.` };
  } catch (error) {
    return fail(error, "Couldn't switch back to that rule.");
  }
}
