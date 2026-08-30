import { fileURLToPath } from "node:url";
import path from "node:path";

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  airlineCutoffs,
  airports,
  createDb,
  pricingRules,
  type Database,
} from "@koolee/db";
import { TEST_AIRPORTS } from "../test-utils/airport-fixtures";

import { InvalidInputError } from "../errors";
import {
  createAirlineCutoff,
  listAirlineCutoffs,
  updateAirlineCutoff,
} from "./airline-cutoffs";
import {
  getActivePricingRule,
  listPricingRules,
  publishPricingRule,
  reactivatePricingRule,
} from "./pricing-rules";

/**
 * The two launch-data surfaces Tier 5 gave the console, against a real
 * database — because both of their interesting properties are enforced BY the
 * database (a partial unique index on the active pricing rule, a unique key on
 * airline+airport+scope) and neither can be proved with a fake.
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIntegration = TEST_DATABASE_URL ? describe : describe.skip;

if (!TEST_DATABASE_URL) {
  console.log("[integration] TEST_DATABASE_URL not set — skipping launch-data tests.");
}

const migrationsFolder = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../db/drizzle",
);

const RULE = {
  name: "launch-v1",
  baseFeeCents: 2900,
  perBagCents: 1500,
  distanceMultiplier: 45,
  leadTimeMultipliers: [
    { maxLeadMinutes: 600, multiplier: 1.4 },
    { maxLeadMinutes: 960, multiplier: 1.2 },
  ],
  discountRules: [{ kind: "family" as const, minBags: 3, percent: 10 }],
};

describeIntegration("launch data: pricing rules + airline cutoffs (integration)", () => {
  let sqlClient: ReturnType<typeof postgres>;
  let db: Database;

  beforeAll(async () => {
    sqlClient = postgres(TEST_DATABASE_URL!, { max: 1, prepare: false });
    await migrate(drizzle(sqlClient), { migrationsFolder });
    db = createDb({ url: TEST_DATABASE_URL!, max: 5 });
  });

  afterAll(async () => {
    await sqlClient?.end();
  });

  beforeEach(async () => {
    await sqlClient.unsafe(`
      SET session_replication_role = replica;
      DELETE FROM airline_cutoffs;
      DELETE FROM pricing_rules;
      DELETE FROM airports;
      SET session_replication_role = DEFAULT;
    `);
    await db.insert(airports).values(TEST_AIRPORTS.JFK);
  });

  describe("pricing rules", () => {
    it("publishes a rule and makes it the only active one", async () => {
      await publishPricingRule(db, RULE);
      const second = await publishPricingRule(db, {
        ...RULE,
        name: "launch-v2",
        baseFeeCents: 3100,
      });

      const active = await getActivePricingRule(db);
      expect(active?.id).toBe(second.id);
      expect(active?.baseFeeCents).toBe(3100);

      // The old one is DEACTIVATED, not deleted: what a price was is a
      // question somebody will ask.
      const all = await db.select().from(pricingRules);
      expect(all).toHaveLength(2);
      expect(all.filter((r) => r.active)).toHaveLength(1);
    });

    it("stores the per-km rate at the numeric column's scale", async () => {
      const rule = await publishPricingRule(db, { ...RULE, distanceMultiplier: 45.5 });
      expect(Number(rule.distanceMultiplier)).toBe(45.5);
    });

    it("switches back to a previous rule without editing either", async () => {
      const first = await publishPricingRule(db, RULE);
      await publishPricingRule(db, { ...RULE, name: "oops", baseFeeCents: 9900 });

      const restored = await reactivatePricingRule(db, first.id);
      expect(restored.active).toBe(true);
      expect(restored.baseFeeCents).toBe(2900);

      const active = await getActivePricingRule(db);
      expect(active?.id).toBe(first.id);
      expect((await db.select().from(pricingRules)).filter((r) => r.active)).toHaveLength(
        1,
      );
    });

    it("lists newest first, so the history reads top-down", async () => {
      await publishPricingRule(db, { ...RULE, name: "older" });
      await publishPricingRule(db, { ...RULE, name: "newer" });
      const rules = await listPricingRules(db);
      expect(rules[0]?.name).toBe("newer");
    });

    it.each([
      ["a nameless rule", { name: "   " }],
      ["a negative base fee", { baseFeeCents: -1 }],
      ["fractional cents", { perBagCents: 12.5 }],
      ["a negative per-km rate", { distanceMultiplier: -1 }],
      [
        "an out-of-order lead-time curve",
        {
          leadTimeMultipliers: [
            { maxLeadMinutes: 960, multiplier: 1.2 },
            { maxLeadMinutes: 600, multiplier: 1.4 },
          ],
        },
      ],
      [
        "a discount shape the engine would reject",
        { discountRules: [{ kind: "mystery", percent: 10 }] as never },
      ],
    ])("refuses %s", async (_label, patch) => {
      await expect(publishPricingRule(db, { ...RULE, ...patch })).rejects.toBeInstanceOf(
        InvalidInputError,
      );
      // …and writes nothing.
      expect(await db.select().from(pricingRules)).toHaveLength(0);
    });
  });

  describe("airline cutoffs", () => {
    const seedRow = async (source: string | null) => {
      const [row] = await db
        .insert(airlineCutoffs)
        .values({
          airlineIata: "DL",
          airportCode: "JFK",
          scope: "domestic",
          cutoffMinutesBeforeDeparture: 45,
          source,
        })
        .returning();
      return row!;
    };

    it("counts how much of the matrix is still the seed's invention", async () => {
      await seedRow("seed: placeholder — VERIFY DL domestic bag-drop policy at JFK");
      await db.insert(airlineCutoffs).values({
        airlineIata: "AA",
        airportCode: "JFK",
        scope: "domestic",
        cutoffMinutesBeforeDeparture: 60,
        source: "aa.com/baggage, checked 2026-09-01",
      });

      const result = await listAirlineCutoffs(db);
      expect(result.total).toBe(2);
      expect(result.placeholders).toBe(1);
      expect(result.rows.find((r) => r.airlineIata === "DL")?.placeholder).toBe(true);
      expect(result.rows.find((r) => r.airlineIata === "AA")?.placeholder).toBe(false);
    });

    it("clears the placeholder flag when a real source replaces the seed's", async () => {
      const row = await seedRow("seed: placeholder — VERIFY DL domestic");
      const updated = await updateAirlineCutoff(db, {
        id: row.id,
        cutoffMinutesBeforeDeparture: 90,
        source: "delta.com/baggage, checked 2026-09-01",
      });

      expect(updated.cutoffMinutesBeforeDeparture).toBe(90);
      expect(updated.placeholder).toBe(false);
    });

    it("refuses to save the seed's own placeholder text back", async () => {
      // Otherwise "Save" on an untouched row would quietly mark 128 invented
      // numbers as verified.
      const row = await seedRow("seed: placeholder — VERIFY DL domestic");
      await expect(
        updateAirlineCutoff(db, {
          id: row.id,
          cutoffMinutesBeforeDeparture: 45,
          source: "seed: placeholder — VERIFY DL domestic",
        }),
      ).rejects.toBeInstanceOf(InvalidInputError);
    });

    it.each([
      ["no source at all", { source: "   " }],
      ["a cutoff of five minutes", { cutoffMinutesBeforeDeparture: 5 }],
      ["a cutoff of a whole day", { cutoffMinutesBeforeDeparture: 1440 }],
      ["fractional minutes", { cutoffMinutesBeforeDeparture: 45.5 }],
    ])("refuses %s", async (_label, patch) => {
      const row = await seedRow("delta.com, checked");
      await expect(
        updateAirlineCutoff(db, {
          id: row.id,
          cutoffMinutesBeforeDeparture: 60,
          source: "delta.com, checked",
          ...patch,
        }),
      ).rejects.toBeInstanceOf(InvalidInputError);

      const [unchanged] = await db
        .select()
        .from(airlineCutoffs)
        .where(eq(airlineCutoffs.id, row.id));
      expect(unchanged?.cutoffMinutesBeforeDeparture).toBe(45);
    });

    it("adds an airline the seed never knew about", async () => {
      const created = await createAirlineCutoff(db, {
        airlineIata: "b6",
        airportCode: "JFK",
        scope: "international",
        cutoffMinutesBeforeDeparture: 75,
        source: "jetblue.com/baggage, checked 2026-09-01",
      });
      // Upper-cased, because that is how every other row is keyed.
      expect(created.airlineIata).toBe("B6");
      expect(created.placeholder).toBe(false);
    });

    it("refuses a duplicate rather than letting the unique key throw raw SQL at an operator", async () => {
      await seedRow("delta.com, checked");
      await expect(
        createAirlineCutoff(db, {
          airlineIata: "DL",
          airportCode: "JFK",
          scope: "domestic",
          cutoffMinutesBeforeDeparture: 60,
          source: "delta.com, checked",
        }),
      ).rejects.toBeInstanceOf(InvalidInputError);
    });

    it("refuses a code that is not an airline code", async () => {
      await expect(
        createAirlineCutoff(db, {
          airlineIata: "DELTA",
          airportCode: "JFK",
          scope: "domestic",
          cutoffMinutesBeforeDeparture: 45,
          source: "delta.com",
        }),
      ).rejects.toBeInstanceOf(InvalidInputError);
    });
  });
});
