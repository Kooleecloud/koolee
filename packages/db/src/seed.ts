import { config as loadEnv } from "dotenv";
import { addDays, addHours, startOfDay } from "date-fns";
import { and, gte, lt } from "drizzle-orm";

import { createDb } from "./client";
import {
  airlineCutoffs,
  airports,
  pricingRules,
  slots,
  type AirportCode,
  type NewAirlineCutoff,
  type NewSlot,
  type SlotTier,
} from "./schema";

loadEnv({ path: [".env.local", ".env", "../../.env.local", "../../.env"], quiet: true });

/**
 * Idempotent development seed. Safe to re-run: every insert is
 * `onConflictDoNothing` or `onConflictDoUpdate` against a natural key.
 *
 * Seeds reference data only — no users, bookings, or custody events. Those are
 * created through `@koolee/core` services so the state machine and custody log
 * stay consistent.
 */

const AIRPORTS = [
  {
    code: "JFK" as AirportCode,
    name: "John F. Kennedy International",
    tz: "America/New_York",
  },
  { code: "LGA" as AirportCode, name: "LaGuardia", tz: "America/New_York" },
  {
    code: "EWR" as AirportCode,
    name: "Newark Liberty International",
    tz: "America/New_York",
  },
];

/**
 * Airline bag-drop cutoffs, minutes before scheduled departure.
 *
 * These are realistic starting values taken from published airline policy, but
 * they are NOT authoritative — every row carries its `source`, and ops must
 * verify against the airline before these drive real sales. The cutoff is the
 * single input that decides whether a pickup can physically make the flight.
 */
const CUTOFFS: NewAirlineCutoff[] = [
  {
    airlineIata: "DL",
    airportCode: "JFK",
    scope: "domestic",
    cutoffMinutesBeforeDeparture: 45,
    source:
      "seed: Delta published domestic bag-drop policy — VERIFY before production use",
  },
  {
    airlineIata: "DL",
    airportCode: "JFK",
    scope: "international",
    cutoffMinutesBeforeDeparture: 60,
    source:
      "seed: Delta published international bag-drop policy — VERIFY before production use",
  },
  {
    airlineIata: "AA",
    airportCode: "JFK",
    scope: "domestic",
    cutoffMinutesBeforeDeparture: 45,
    source:
      "seed: American published domestic bag-drop policy — VERIFY before production use",
  },
  {
    airlineIata: "AA",
    airportCode: "JFK",
    scope: "international",
    cutoffMinutesBeforeDeparture: 60,
    source:
      "seed: American published international bag-drop policy — VERIFY before production use",
  },
  {
    airlineIata: "UA",
    airportCode: "JFK",
    scope: "domestic",
    cutoffMinutesBeforeDeparture: 45,
    source:
      "seed: United published domestic bag-drop policy — VERIFY before production use",
  },
  {
    airlineIata: "UA",
    airportCode: "JFK",
    scope: "international",
    cutoffMinutesBeforeDeparture: 60,
    source:
      "seed: United published international bag-drop policy — VERIFY before production use",
  },
];

/** Pickup windows offered per day, as hour offsets from local midnight. */
const DAILY_WINDOWS: {
  tier: SlotTier;
  startHour: number;
  hours: number;
  capacity: number;
}[] = [
  { tier: "standard_4h", startHour: 6, hours: 4, capacity: 12 },
  { tier: "standard_4h", startHour: 10, hours: 4, capacity: 12 },
  { tier: "standard_4h", startHour: 14, hours: 4, capacity: 12 },
  { tier: "express_2h", startHour: 8, hours: 2, capacity: 6 },
  { tier: "express_2h", startHour: 16, hours: 2, capacity: 6 },
  { tier: "priority_1h", startHour: 9, hours: 1, capacity: 3 },
  { tier: "priority_1h", startHour: 17, hours: 1, capacity: 3 },
];

async function main(): Promise<void> {
  const db = createDb();

  console.log("Seeding airports…");
  for (const airport of AIRPORTS) {
    await db
      .insert(airports)
      .values(airport)
      .onConflictDoUpdate({
        target: airports.code,
        set: { name: airport.name, tz: airport.tz },
      });
  }

  console.log("Seeding airline cutoffs…");
  for (const cutoff of CUTOFFS) {
    await db
      .insert(airlineCutoffs)
      .values(cutoff)
      .onConflictDoUpdate({
        target: [
          airlineCutoffs.airlineIata,
          airlineCutoffs.airportCode,
          airlineCutoffs.scope,
        ],
        set: {
          cutoffMinutesBeforeDeparture: cutoff.cutoffMinutesBeforeDeparture,
          source: cutoff.source ?? null,
        },
      });
  }

  console.log("Seeding pricing rule…");
  const [existingRule] = await db.select().from(pricingRules).limit(1);
  if (!existingRule) {
    await db.insert(pricingRules).values({
      name: "launch-v1",
      baseFeeCents: 2900,
      perBagCents: 1500,
      distanceMultiplier: "45.0000",
      slotTierMultiplier: {
        standard_4h: 1,
        express_2h: 1.35,
        priority_1h: 1.8,
      },
      discountRules: [{ kind: "family", minBags: 3, percent: 10 }],
      active: true,
    });
  } else {
    console.log("  pricing rule already present — leaving it alone");
  }

  console.log("Seeding slots for the next 3 days…");
  const today = startOfDay(new Date());

  // No natural key on slots, so blind re-runs would duplicate. Seed one day at
  // a time and skip any day that already has slots — re-running tops up the
  // horizon instead of duplicating it or (worse) leaving it stale.
  let inserted = 0;
  for (let dayOffset = 0; dayOffset < 3; dayOffset += 1) {
    const day = addDays(today, dayOffset);
    const nextDay = addDays(day, 1);

    const existing = await db
      .select({ id: slots.id })
      .from(slots)
      .where(and(gte(slots.windowStart, day), lt(slots.windowStart, nextDay)))
      .limit(1);
    if (existing.length > 0) {
      console.log(`  ${day.toISOString().slice(0, 10)} already has slots — skipping`);
      continue;
    }

    const rows: NewSlot[] = [];
    for (const airport of AIRPORTS) {
      for (const window of DAILY_WINDOWS) {
        const windowStart = addHours(day, window.startHour);
        rows.push({
          airportCode: airport.code,
          tier: window.tier,
          windowStart,
          windowEnd: addHours(windowStart, window.hours),
          capacity: window.capacity,
          bookedCount: 0,
        });
      }
    }
    await db.insert(slots).values(rows);
    inserted += rows.length;
  }
  console.log(`  inserted ${inserted} slots`);

  console.log("Seed complete.");
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error("Seed failed:", error);
  process.exit(1);
});
