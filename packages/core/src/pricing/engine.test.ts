import { describe, expect, it } from "vitest";
import type { PricingRule } from "@koolee/db";

import { PricingRuleInvalidError } from "../errors";
import {
  price,
  priceCents,
  resolveLeadTimeMultiplier,
  toPricingRuleInput,
  type PriceInput,
  type PricingRuleInput,
} from "./engine";

/** The launch curve: ≤10h ×1.4, ≤16h ×1.2, ≤24h ×1.1, further out ×1. */
const CURVE = [
  { maxLeadMinutes: 10 * 60, multiplier: 1.4 },
  { maxLeadMinutes: 16 * 60, multiplier: 1.2 },
  { maxLeadMinutes: 24 * 60, multiplier: 1.1 },
];

const RULE: PricingRuleInput = {
  baseFeeCents: 2900,
  perBagCents: 1500,
  distanceMultiplier: 45, // cents per km
  leadTimeMultipliers: CURVE,
  discountRules: [],
};

/** Default lead: 27h out — past every curve step, so multiplier ×1. */
const input = (over: Partial<PriceInput> = {}): PriceInput => ({
  rule: RULE,
  bagCount: 2,
  distanceKm: 20,
  pickupLeadMinutes: 27 * 60,
  ...over,
});

describe("price", () => {
  it("adds base, per-bag and distance", () => {
    // 2900 + 2×1500 + round(45×20) = 2900 + 3000 + 900 = 6800
    const result = price(input());
    expect(result.baseFeeCents).toBe(2900);
    expect(result.bagsCents).toBe(3000);
    expect(result.distanceCents).toBe(900);
    expect(result.subtotalCents).toBe(6800);
    expect(result.totalCents).toBe(6800);
  });

  it("scales linearly with bag count", () => {
    for (const bags of [1, 2, 3, 5, 10]) {
      expect(price(input({ bagCount: bags })).bagsCents).toBe(1500 * bags);
    }
  });

  it("scales linearly with distance", () => {
    expect(price(input({ distanceKm: 0 })).distanceCents).toBe(0);
    expect(price(input({ distanceKm: 10 })).distanceCents).toBe(450);
    expect(price(input({ distanceKm: 33.5 })).distanceCents).toBe(1508); // round(1507.5)
  });

  it("applies the lead-time multiplier to the whole subtotal", () => {
    const farOut = price(input({ pickupLeadMinutes: 27 * 60 }));
    const closer = price(input({ pickupLeadMinutes: 13 * 60 }));
    const closest = price(input({ pickupLeadMinutes: 8 * 60 }));

    expect(farOut.totalCents).toBe(6800);
    expect(closer.totalCents).toBe(Math.round(6800 * 1.2)); // 8160
    expect(closest.totalCents).toBe(Math.round(6800 * 1.4)); // 9520

    expect(closer.leadTimeMultiplier).toBe(1.2);
    expect(closer.leadTimeAdjustmentCents).toBe(8160 - 6800);
  });

  it("prices monotonically: a window closer to departure never costs less", () => {
    let previous = Number.POSITIVE_INFINITY;
    for (const lead of [6 * 60, 10 * 60, 12 * 60, 16 * 60, 20 * 60, 24 * 60, 30 * 60]) {
      const total = price(input({ pickupLeadMinutes: lead })).totalCents;
      expect(total).toBeLessThanOrEqual(previous);
      previous = total;
    }
  });

  it("treats an empty curve as no adjustment rather than free", () => {
    const result = price(
      input({ rule: { ...RULE, leadTimeMultipliers: [] }, pickupLeadMinutes: 8 * 60 }),
    );
    expect(result.leadTimeMultiplier).toBe(1);
    expect(result.totalCents).toBe(6800);
  });

  it("resolveLeadTimeMultiplier picks the smallest covering step, unsorted input included", () => {
    const shuffled = [CURVE[2]!, CURVE[0]!, CURVE[1]!];
    expect(resolveLeadTimeMultiplier(shuffled, 6 * 60)).toBe(1.4);
    expect(resolveLeadTimeMultiplier(shuffled, 10 * 60)).toBe(1.4); // boundary inclusive
    expect(resolveLeadTimeMultiplier(shuffled, 10 * 60 + 1)).toBe(1.2);
    expect(resolveLeadTimeMultiplier(shuffled, 24 * 60 + 1)).toBe(1);
  });

  it("always returns whole cents", () => {
    for (const distanceKm of [1.3, 7.77, 12.345, 99.999]) {
      for (const lead of [8 * 60, 13 * 60, 20 * 60, 27 * 60]) {
        const result = price(input({ distanceKm, pickupLeadMinutes: lead }));
        expect(Number.isInteger(result.totalCents)).toBe(true);
        expect(Number.isInteger(result.subtotalCents)).toBe(true);
        expect(Number.isInteger(result.distanceCents)).toBe(true);
      }
    }
  });

  it("is pure — repeated calls agree and the input is untouched", () => {
    const args = input();
    const snapshot = JSON.parse(JSON.stringify(args));
    const a = price(args);
    const b = price(args);

    expect(a).toEqual(b);
    expect(JSON.parse(JSON.stringify(args))).toEqual(snapshot);
  });

  it("priceCents matches the breakdown total", () => {
    expect(priceCents(input({ pickupLeadMinutes: 13 * 60 }))).toBe(
      price(input({ pickupLeadMinutes: 13 * 60 })).totalCents,
    );
  });
});

describe("discounts", () => {
  it("applies a matching promo code, case- and whitespace-insensitively", () => {
    const rule: PricingRuleInput = {
      ...RULE,
      discountRules: [{ kind: "percent_off", code: "LAUNCH20", percent: 20 }],
    };

    const applied = price(input({ rule, discountContext: { promoCode: "  launch20 " } }));
    expect(applied.discountCents).toBe(1360); // 20% of 6800
    expect(applied.totalCents).toBe(5440);
    expect(applied.discounts[0]?.label).toContain("LAUNCH20");
  });

  it("ignores a promo code that does not match", () => {
    const rule: PricingRuleInput = {
      ...RULE,
      discountRules: [{ kind: "percent_off", code: "LAUNCH20", percent: 20 }],
    };
    expect(
      price(input({ rule, discountContext: { promoCode: "NOPE" } })).discountCents,
    ).toBe(0);
    expect(price(input({ rule })).discountCents).toBe(0);
  });

  it("caps a flat discount at the amount owed and never goes negative", () => {
    const rule: PricingRuleInput = {
      ...RULE,
      discountRules: [{ kind: "flat_off_cents", code: "BIG", amountCents: 999_999 }],
    };
    const result = price(input({ rule, discountContext: { promoCode: "BIG" } }));
    expect(result.discountCents).toBe(6800);
    expect(result.totalCents).toBe(0);
  });

  it("applies the family rate only at or above the bag threshold", () => {
    const rule: PricingRuleInput = {
      ...RULE,
      discountRules: [{ kind: "family", minBags: 3, percent: 10 }],
    };

    expect(price(input({ rule, bagCount: 2 })).discountCents).toBe(0);

    const three = price(input({ rule, bagCount: 3 }));
    // 2900 + 4500 + 900 = 8300; 10% = 830
    expect(three.subtotalCents).toBe(8300);
    expect(three.discountCents).toBe(830);
    expect(three.totalCents).toBe(7470);
  });

  it("applies the senior rate only when the context says so", () => {
    const rule: PricingRuleInput = {
      ...RULE,
      discountRules: [{ kind: "senior", percent: 15 }],
    };
    expect(price(input({ rule })).discountCents).toBe(0);
    expect(
      price(input({ rule, discountContext: { isSenior: true } })).discountCents,
    ).toBe(1020); // 15% of 6800
  });

  it("stacks additively from the same base, so order cannot matter", () => {
    const forward: PricingRuleInput = {
      ...RULE,
      discountRules: [
        { kind: "senior", percent: 10 },
        { kind: "family", minBags: 2, percent: 10 },
      ],
    };
    const reversed: PricingRuleInput = {
      ...RULE,
      discountRules: [...forward.discountRules!].reverse() as never,
    };

    const context = { isSenior: true };
    const a = price(input({ rule: forward, discountContext: context }));
    const b = price(input({ rule: reversed, discountContext: context }));

    expect(a.discountCents).toBe(1360); // 680 + 680, not compounded
    expect(a.totalCents).toBe(b.totalCents);
  });

  it("takes discounts after the lead-time multiplier", () => {
    const rule: PricingRuleInput = {
      ...RULE,
      discountRules: [{ kind: "family", minBags: 2, percent: 10 }],
    };
    const result = price(input({ rule, pickupLeadMinutes: 13 * 60 }));
    // 6800 × 1.2 = 8160; 10% of 8160 = 816
    expect(result.discountCents).toBe(816);
    expect(result.totalCents).toBe(7344);
  });
});

describe("validation", () => {
  it("rejects a non-positive or fractional bag count", () => {
    for (const bagCount of [0, -1, 1.5]) {
      expect(() => price(input({ bagCount }))).toThrow(PricingRuleInvalidError);
    }
  });

  it("rejects a negative or non-finite distance", () => {
    for (const distanceKm of [-1, NaN, Infinity]) {
      expect(() => price(input({ distanceKm }))).toThrow(PricingRuleInvalidError);
    }
  });

  it("rejects a negative or non-finite lead", () => {
    for (const pickupLeadMinutes of [-1, NaN, Infinity]) {
      expect(() => price(input({ pickupLeadMinutes }))).toThrow(PricingRuleInvalidError);
    }
  });

  it("rejects a malformed rule", () => {
    expect(() => price(input({ rule: { ...RULE, baseFeeCents: -100 } }))).toThrow(
      PricingRuleInvalidError,
    );
    expect(() => price(input({ rule: { ...RULE, perBagCents: 12.5 } }))).toThrow(
      PricingRuleInvalidError,
    );
    expect(() => price(input({ rule: { ...RULE, distanceMultiplier: -1 } }))).toThrow(
      PricingRuleInvalidError,
    );
  });

  it("names the offending field in the error", () => {
    expect(() => price(input({ rule: { ...RULE, baseFeeCents: -1 } }))).toThrow(
      /baseFeeCents/,
    );
  });
});

describe("toPricingRuleInput", () => {
  const row = (over: Partial<PricingRule> = {}): PricingRule =>
    ({
      id: "pr-1",
      name: "launch-v1",
      baseFeeCents: 2900,
      perBagCents: 1500,
      // numeric comes back from postgres-js as a string.
      distanceMultiplier: "45.0000",
      slotTierMultiplier: {},
      leadTimeMultipliers: CURVE,
      discountRules: [{ kind: "family", minBags: 3, percent: 10 }],
      active: true,
      effectiveFrom: new Date("2025-01-01T00:00:00Z"),
      createdAt: new Date("2025-01-01T00:00:00Z"),
      updatedAt: new Date("2025-01-01T00:00:00Z"),
      ...over,
    }) as PricingRule;

  it("parses the numeric distance multiplier out of its string form", () => {
    expect(toPricingRuleInput(row()).distanceMultiplier).toBe(45);
  });

  it("round-trips into a usable price", () => {
    expect(price({ ...input(), rule: toPricingRuleInput(row()) }).totalCents).toBe(6800);
  });

  it("throws when the numeric column is not parseable", () => {
    expect(() => toPricingRuleInput(row({ distanceMultiplier: "not-a-number" }))).toThrow(
      PricingRuleInvalidError,
    );
  });

  it("tolerates null jsonb columns", () => {
    const parsed = toPricingRuleInput(
      row({ leadTimeMultipliers: null as never, discountRules: null as never }),
    );
    expect(parsed.leadTimeMultipliers).toEqual([]);
    expect(parsed.discountRules).toEqual([]);
  });
});
