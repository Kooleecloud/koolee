import { desc, eq } from "drizzle-orm";
import {
  pricingRules,
  type Database,
  type DiscountRuleJson,
  type LeadTimeMultiplierJson,
  type PricingRule,
} from "@koolee/db";

import { InvalidInputError, NotFoundError } from "../errors";
import { discountRuleSchema, leadTimeMultiplierSchema } from "../pricing/engine";

/**
 * The pricing rule, as ops edits it.
 *
 * Until Tier 5 there were exactly two ways to change a price: edit `seed.ts`
 * and re-run the seed, or write SQL. The seed is worse than it sounds — it
 * does not merge, it CONVERGES, rewriting the active rule field by field back
 * to the hardcoded launch numbers (which is why `pnpm seed` now refuses a
 * hosted database).
 *
 * PUBLISHING, NOT EDITING. A change writes a NEW row and deactivates the old
 * one, in one transaction. That is what the schema was built for — rows carry
 * `effective_from`, are only ever deactivated, and a partial unique index
 * makes a second active row impossible — and it is the same model agreements
 * use, for the same reason: what a price WAS is a question somebody will ask.
 *
 * Bookings are unaffected either way: `bookings.price_cents` is the
 * authoritative charge and the breakdown is snapshotted onto the row, so no
 * booking is repriced by a publish.
 */

export interface PricingRuleInputValues {
  name: string;
  baseFeeCents: number;
  perBagCents: number;
  /** Cents per kilometre. Stored as numeric(8,4). */
  distanceMultiplier: number;
  leadTimeMultipliers: LeadTimeMultiplierJson[];
  discountRules: DiscountRuleJson[];
}

/** The one rule the funnel prices from. Null on a database nobody has seeded. */
export async function getActivePricingRule(db: Database): Promise<PricingRule | null> {
  const rule = await db.query.pricingRules.findFirst({
    where: eq(pricingRules.active, true),
    orderBy: (t, { desc: d }) => [d(t.effectiveFrom)],
  });
  return rule ?? null;
}

/** Newest first. The history the console shows under the editor. */
export async function listPricingRules(db: Database, limit = 20): Promise<PricingRule[]> {
  return db
    .select()
    .from(pricingRules)
    .orderBy(desc(pricingRules.effectiveFrom), desc(pricingRules.createdAt))
    .limit(limit);
}

/**
 * Validates the shape money is computed from.
 *
 * The engine's own schemas are reused rather than restated — the lead-time
 * curve and the discount rules have one definition, and a console that could
 * write a shape the engine rejects would break pricing for every customer at
 * once.
 */
function assertValid(input: PricingRuleInputValues): void {
  if (input.name.trim().length === 0) {
    throw new InvalidInputError(
      "Give the rule a name — it is how you tell versions apart.",
    );
  }
  if (!Number.isInteger(input.baseFeeCents) || input.baseFeeCents < 0) {
    throw new InvalidInputError(
      "The base fee must be a whole number of cents, at least zero.",
    );
  }
  if (!Number.isInteger(input.perBagCents) || input.perBagCents < 0) {
    throw new InvalidInputError(
      "The per-bag fee must be a whole number of cents, at least zero.",
    );
  }
  if (!Number.isFinite(input.distanceMultiplier) || input.distanceMultiplier < 0) {
    throw new InvalidInputError("The per-kilometre rate must be zero or more.");
  }

  for (const step of input.leadTimeMultipliers) {
    if (!leadTimeMultiplierSchema.safeParse(step).success) {
      throw new InvalidInputError(
        "Each lead-time step needs a positive number of minutes and a multiplier of zero or more.",
      );
    }
  }
  // The engine takes the SMALLEST matching step, so an out-of-order curve is
  // not wrong to it — but it is unreadable to a person, and a curve nobody can
  // read is one nobody can check.
  const minutes = input.leadTimeMultipliers.map((s) => s.maxLeadMinutes);
  if (minutes.some((m, i) => i > 0 && m <= minutes[i - 1]!)) {
    throw new InvalidInputError(
      "Lead-time steps must be in increasing order of minutes, tightest first.",
    );
  }

  for (const discount of input.discountRules) {
    if (!discountRuleSchema.safeParse(discount).success) {
      throw new InvalidInputError(
        "One of the discount rules is not a shape the engine accepts.",
      );
    }
  }
}

/**
 * Deactivates the current rule and inserts a new active one.
 *
 * One transaction, because the partial unique index means two active rows
 * cannot coexist even for an instant: the deactivate MUST land before the
 * insert, and a failure between them would leave the product with no active
 * rule and every quote refusing.
 */
export async function publishPricingRule(
  db: Database,
  input: PricingRuleInputValues,
): Promise<PricingRule> {
  assertValid(input);

  return db.transaction(async (tx) => {
    await tx
      .update(pricingRules)
      .set({ active: false, updatedAt: new Date() })
      .where(eq(pricingRules.active, true));

    const [created] = await tx
      .insert(pricingRules)
      .values({
        name: input.name.trim(),
        baseFeeCents: input.baseFeeCents,
        perBagCents: input.perBagCents,
        distanceMultiplier: input.distanceMultiplier.toFixed(4),
        leadTimeMultipliers: input.leadTimeMultipliers,
        discountRules: input.discountRules,
        active: true,
        effectiveFrom: new Date(),
      })
      .returning();

    if (!created) throw new Error("Insert of pricing rule returned no row");
    return created;
  });
}

/**
 * Makes a previously published rule active again — the undo.
 *
 * Nothing is edited and nothing is deleted: the old row becomes the active one
 * and the one that replaced it is deactivated. A price that turned out wrong
 * is reverted in one click rather than retyped from memory.
 */
export async function reactivatePricingRule(
  db: Database,
  ruleId: string,
): Promise<PricingRule> {
  return db.transaction(async (tx) => {
    const target = await tx.query.pricingRules.findFirst({
      where: eq(pricingRules.id, ruleId),
    });
    if (!target) throw new NotFoundError("Pricing rule", ruleId);
    if (target.active) return target;

    await tx
      .update(pricingRules)
      .set({ active: false, updatedAt: new Date() })
      .where(eq(pricingRules.active, true));

    const [updated] = await tx
      .update(pricingRules)
      .set({ active: true, effectiveFrom: new Date(), updatedAt: new Date() })
      .where(eq(pricingRules.id, ruleId))
      .returning();

    if (!updated) throw new NotFoundError("Pricing rule", ruleId);
    return updated;
  });
}
