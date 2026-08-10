import { config as loadEnv } from "dotenv";
import { eq } from "drizzle-orm";

import { createDb } from "./client";
import {
  airlineCutoffs,
  airports,
  pricingRules,
  staffMembers,
  users,
  type AirportCode,
  type LeadTimeMultiplierJson,
  type NewAirlineCutoff,
} from "./schema";

loadEnv({ path: [".env.local", ".env", "../../.env.local", "../../.env"], quiet: true });

/**
 * Launch lead-time price curve: a window ending within `maxLeadMinutes` of
 * departure gets `multiplier` on the subtotal; the far end of the 30h→6h
 * band (24h+ out) is the base price. Placeholder numbers — tune in the DB or
 * replace with the real dynamic-pricing algorithm at the engine seam.
 * Mirrored in apps/web/src/app/(marketing)/pricing/actions.ts — keep in sync.
 */
const LEAD_TIME_CURVE: LeadTimeMultiplierJson[] = [
  { maxLeadMinutes: 10 * 60, multiplier: 1.4 },
  { maxLeadMinutes: 16 * 60, multiplier: 1.2 },
  { maxLeadMinutes: 24 * 60, multiplier: 1.1 },
];

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
      leadTimeMultipliers: LEAD_TIME_CURVE,
      discountRules: [{ kind: "family", minBags: 3, percent: 10 }],
      active: true,
    });
  } else if ((existingRule.leadTimeMultipliers ?? []).length === 0) {
    // Pre-cutover rule row: give it the launch lead-time curve so windows
    // price by proximity to departure. Everything else is left alone.
    await db
      .update(pricingRules)
      .set({ leadTimeMultipliers: LEAD_TIME_CURVE })
      .where(eq(pricingRules.id, existingRule.id));
    console.log("  added launch lead-time curve to the existing pricing rule");
  } else {
    console.log("  pricing rule already present — leaving it alone");
  }

  // Pickup windows are virtual (computed per flight from the pricing rule and
  // slot_blocks) — there is no slot inventory to seed anymore.

  await seedLocalStaff(db);

  console.log("Seed complete.");
  process.exit(0);
}

/**
 * Development accounts — LOCAL STACK ONLY.
 *
 * The full dev/test roster, so local work never needs the invite flow and
 * every app has ready-made identities:
 *
 *   admins:    admin@koolee.local  / koolee-admin-dev-1   (Alex Morgan)
 *              admin2@koolee.local / koolee-admin-dev-2   (Priya Rao)
 *   agents:    agent@koolee.local  / koolee-agent-dev-1   (Leo Vargas)
 *              agent2@koolee.local / koolee-agent-dev-2   (Nina Petrov)
 *              agent3@koolee.local / koolee-agent-dev-3   (Sam Okafor)
 *              agent4@koolee.local / koolee-agent-dev-4   (Tara Lin)
 *              agent5@koolee.local / koolee-agent-dev-5   (Jonas Weber)
 *   customers: +1 332 260 2830 / OTP 123456               (Casey Rivera)
 *              +1 332 260 2831 / OTP 123456               (Morgan Lee)
 *
 * Customer phones + OTPs come from `[auth.sms.test_otp]` in
 * supabase/config.toml — valid-format numbers, so the web UI's phone gate
 * accepts them; no SMS is ever sent.
 *
 * Runs only when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are present AND the
 * Supabase host is 127.0.0.1/localhost — seeding known passwords into a
 * hosted project would be a standing backdoor, so a non-local host is a hard
 * skip, not a warning. (Locally: `pnpm test:env:up` writes both values into
 * .env.test; `pnpm seed:local` loads them itself.)
 */
async function seedLocalStaff(db: ReturnType<typeof createDb>): Promise<void> {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.log("Staff seed skipped (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set).");
    return;
  }
  const host = new URL(supabaseUrl).hostname;
  if (host !== "127.0.0.1" && host !== "localhost") {
    console.log(`Staff seed REFUSED: Supabase host '${host}' is not local.`);
    return;
  }

  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
  };

  /** Create-or-find a GoTrue user; returns its auth id. */
  async function ensureAuthUser(payload: {
    email?: string;
    password?: string;
    email_confirm?: boolean;
    phone?: string;
    phone_confirm?: boolean;
  }): Promise<string | undefined> {
    const createRes = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    if (createRes.ok) {
      return ((await createRes.json()) as { id?: string }).id;
    }
    const body = (await createRes.json().catch(() => ({}))) as {
      error_code?: string;
      msg?: string;
    };
    const exists =
      body.error_code === "email_exists" ||
      body.error_code === "phone_exists" ||
      /already.*registered/i.test(body.msg ?? "");
    if (!exists) {
      console.warn(
        `  ${payload.email ?? payload.phone}: create failed — ${body.msg ?? createRes.status}`,
      );
      return undefined;
    }
    // Idempotent re-run: find the existing auth user.
    const listRes = await fetch(`${supabaseUrl}/auth/v1/admin/users?page=1&per_page=1000`, {
      headers,
    });
    const list = (await listRes.json()) as {
      users?: Array<{ id: string; email?: string; phone?: string }>;
    };
    return list.users?.find(
      (u) =>
        (payload.email && u.email === payload.email) ||
        (payload.phone && u.phone === payload.phone.replace(/^\+/, "")),
    )?.id;
  }

  console.log("Seeding local staff accounts…");
  const staffAccounts = [
    { email: "admin@koolee.local", password: "koolee-admin-dev-1", role: "admin" as const, fullName: "Alex Morgan" },
    { email: "admin2@koolee.local", password: "koolee-admin-dev-2", role: "admin" as const, fullName: "Priya Rao" },
    { email: "agent@koolee.local", password: "koolee-agent-dev-1", role: "agent" as const, fullName: "Leo Vargas" },
    { email: "agent2@koolee.local", password: "koolee-agent-dev-2", role: "agent" as const, fullName: "Nina Petrov" },
    { email: "agent3@koolee.local", password: "koolee-agent-dev-3", role: "agent" as const, fullName: "Sam Okafor" },
    { email: "agent4@koolee.local", password: "koolee-agent-dev-4", role: "agent" as const, fullName: "Tara Lin" },
    { email: "agent5@koolee.local", password: "koolee-agent-dev-5", role: "agent" as const, fullName: "Jonas Weber" },
  ];

  for (const account of staffAccounts) {
    // GoTrue admin REST API directly — this package carries no supabase-js.
    const userId = await ensureAuthUser({
      email: account.email,
      password: account.password,
      email_confirm: true,
    });
    if (!userId) {
      console.warn(`  ${account.email}: could not resolve auth user id`);
      continue;
    }

    await db
      .insert(users)
      .values({
        id: userId,
        email: account.email,
        fullName: account.fullName,
        role: account.role,
        isAnonymous: false,
      })
      .onConflictDoUpdate({
        target: users.id,
        set: {
          email: account.email,
          fullName: account.fullName,
          role: account.role,
          isAnonymous: false,
        },
      });
    await db
      .insert(staffMembers)
      .values({ userId, role: account.role, active: true })
      .onConflictDoUpdate({
        target: staffMembers.userId,
        set: { role: account.role, active: true },
      });
    console.log(`  ${account.email} → ${account.role} (password documented in seed.ts)`);
  }

  console.log("Seeding local customer test accounts…");
  const customerAccounts = [
    { phone: "+13322602830", fullName: "Casey Rivera" },
    { phone: "+13322602831", fullName: "Morgan Lee" },
  ];
  for (const account of customerAccounts) {
    const userId = await ensureAuthUser({ phone: account.phone, phone_confirm: true });
    if (!userId) {
      console.warn(`  ${account.phone}: could not resolve auth user id`);
      continue;
    }
    await db
      .insert(users)
      .values({
        id: userId,
        phone: account.phone,
        fullName: account.fullName,
        role: "customer",
        isAnonymous: false,
        phoneVerifiedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: users.id,
        set: { phone: account.phone, fullName: account.fullName, isAnonymous: false },
      });
    console.log(`  ${account.phone} → customer (OTP in supabase/config.toml)`);
  }
}

main().catch((error: unknown) => {
  console.error("Seed failed:", error);
  process.exit(1);
});
