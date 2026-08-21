import { config as loadEnv } from "dotenv";

import { createDb } from "./client";
import { airlineCutoffs, airports, pricingRules } from "./schema";

/**
 * Read-only: reports whether the database DATABASE_URL points at (hosted,
 * per packages/db/.env) carries the reference data the booking funnel needs.
 * Run with: pnpm exec tsx src/check-seed-data.ts
 */
loadEnv({ path: [".env.local", ".env"], quiet: true });

async function main(): Promise<void> {
  const db = createDb();
  const a = await db.select().from(airports);
  const c = await db.select().from(airlineCutoffs);
  const p = await db.select().from(pricingRules);
  console.log("airports:", a.length, a.map((r) => r.code).join(" "));
  console.log("cutoffs:", c.length);
  console.log(
    "pricing rules:",
    p.length,
    p.map((r) => ({
      name: r.name,
      active: r.active,
      curve: (r.leadTimeMultipliers ?? []).length,
      baseFeeCents: r.baseFeeCents,
      perBagCents: r.perBagCents,
      distanceMultiplier: r.distanceMultiplier,
      discounts: r.discountRules ?? [],
    })),
  );
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
