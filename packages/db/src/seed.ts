import { config as loadEnv } from "dotenv";
import { eq, inArray } from "drizzle-orm";

// Shell-first, same rule as migrate.ts/status.ts. dotenv never overrides an
// exported variable, but capturing before loadEnv keeps the three db tools
// on one identical resolution path — and makes the Target-host print below
// honest about what actually won.
const shellDatabaseUrl = process.env.DATABASE_URL;

import { createDb } from "./client";
import { ALL_COVERAGE_ZIPS } from "./coverage-zips";
import {
  agentZones,
  agreementVersions,
  airlineCutoffs,
  airports,
  pricingRules,
  staffMembers,
  users,
  type AirportCode,
  type DiscountRuleJson,
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
const DOMESTIC_CUTOFF_MINUTES = 45;
const INTERNATIONAL_CUTOFF_MINUTES = 60;

/**
 * Carriers with a published schedule at each airport (rosters researched
 * 2026-08; see the airports' own airline directories). Every carrier gets a
 * row in BOTH scopes at the standard placeholder cutoffs above, so a demo
 * flight never dead-ends on a missing row. Ops must verify each airline's
 * actual bag-drop policy before real sales — every row's `source` says so.
 */
const AIRLINES_BY_AIRPORT: Record<AirportCode, readonly string[]> = {
  // Hubs: Delta, JetBlue, American. Heavy international presence.
  JFK: [
    "AA",
    "AS",
    "B6",
    "DL",
    "F9",
    "UA",
    "AC",
    "AF",
    "AY",
    "AZ",
    "BA",
    "CX",
    "EI",
    "EK",
    "EY",
    "IB",
    "JL",
    "KE",
    "KL",
    "LH",
    "LX",
    "LY",
    "NH",
    "OS",
    "QF",
    "QR",
    "SQ",
    "TK",
    "TP",
    "VS",
  ],
  // Domestic-focused (perimeter rule); Delta and American hubs.
  LGA: ["AA", "AC", "B6", "DL", "F9", "NK", "PD", "UA", "WN"],
  // United's hub; Star Alliance internationals concentrate here.
  EWR: [
    "AA",
    "AC",
    "AS",
    "B6",
    "DL",
    "F9",
    "G4",
    "NK",
    "PD",
    "SY",
    "UA",
    "AI",
    "BA",
    "EI",
    "ET",
    "FI",
    "LH",
    "LX",
    "LY",
    "OS",
    "SK",
    "SN",
    "SQ",
    "TK",
    "TP",
  ],
};

const CUTOFFS: NewAirlineCutoff[] = (
  Object.entries(AIRLINES_BY_AIRPORT) as [AirportCode, readonly string[]][]
).flatMap(([airportCode, airlines]) =>
  airlines.flatMap((airlineIata): NewAirlineCutoff[] => [
    {
      airlineIata,
      airportCode,
      scope: "domestic",
      cutoffMinutesBeforeDeparture: DOMESTIC_CUTOFF_MINUTES,
      source: `seed: placeholder — VERIFY ${airlineIata} domestic bag-drop policy at ${airportCode} before production use`,
    },
    {
      airlineIata,
      airportCode,
      scope: "international",
      cutoffMinutesBeforeDeparture: INTERNATIONAL_CUTOFF_MINUTES,
      source: `seed: placeholder — VERIFY ${airlineIata} international bag-drop policy at ${airportCode} before production use`,
    },
  ]),
);

async function main(): Promise<void> {
  const connectionString = shellDatabaseUrl ?? process.env.DATABASE_URL;
  const db = createDb(connectionString ? { url: connectionString } : {});

  // Host only — never the credentials. Same first line as migrate/status:
  // a seed silently landing on the wrong database happened twice on
  // 2026-08-23 (DIRECT_DATABASE_URL set, DATABASE_URL falling back to
  // packages/db/.env) before this print existed. Read it every time.
  console.log(`Target host: ${new URL(connectionString!).hostname}`);

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
  // Exactly ONE active rule, always the canonical launch rule. The old heal
  // ("patch whatever limit(1) found") let stale fixture rules stay active —
  // the #41/#51 leakage class. Migration 0020's partial unique index enforces
  // the invariant at the database; this block converges the data on it:
  // deactivate everything, then upsert launch-v1 (full launch config: the
  // lead-time curve AND the family discount) as the single active rule.
  // Rows are only deactivated, never deleted — pricing history stays intact.
  const LAUNCH_RULE = {
    name: "launch-v1",
    baseFeeCents: 2900,
    perBagCents: 1500,
    distanceMultiplier: "45.0000",
    leadTimeMultipliers: LEAD_TIME_CURVE,
    discountRules: [{ kind: "family", minBags: 3, percent: 10 }] as DiscountRuleJson[],
  };
  await db
    .update(pricingRules)
    .set({ active: false })
    .where(eq(pricingRules.active, true));
  const [launchRule] = await db
    .select()
    .from(pricingRules)
    .where(eq(pricingRules.name, LAUNCH_RULE.name))
    .limit(1);
  if (launchRule) {
    await db
      .update(pricingRules)
      .set({ ...LAUNCH_RULE, active: true })
      .where(eq(pricingRules.id, launchRule.id));
    console.log("  launch-v1 refreshed — the single active rule");
  } else {
    await db.insert(pricingRules).values({ ...LAUNCH_RULE, active: true });
    console.log("  launch-v1 inserted — the single active rule");
  }

  // Pickup windows are virtual (computed per flight from the pricing rule and
  // slot_blocks) — there is no slot inventory to seed anymore.

  await seedAgreementV1(db);

  await seedLocalStaff(db);

  console.log("Seed complete.");
  process.exit(0);
}

/**
 * The canonical v1 booking agreement.
 *
 * Exactly one version is seeded so dev and CI have something for the trip
 * page's accept card and the visit gate to resolve — without it, every local
 * booking is permanently blocked at the agent's identity step, which reads as
 * a bug rather than as missing data.
 *
 * IDEMPOTENT BY DOING NOTHING when v1 already exists — not by refreshing it.
 *
 * Two rules meet here and both point the same way. A version in effect is
 * FROZEN (migration 0024): the seed physically cannot update it, because
 * `agreement_acceptances` references it by id and rewriting `body_md` would
 * change what past acceptors agreed to. And inserting a NEW version on every
 * run would publish a v2, v3, v4… on each seed, which under the current gate
 * un-accepts every booking in the local database and makes accepted bookings
 * appear to un-accept themselves for no visible reason.
 *
 * So: insert once, then leave it alone. A developer who wants different terms
 * publishes a new version at admin `/agreements`, exactly as production would.
 * Changing the text below therefore only affects databases that have never
 * been seeded — which is the same immutability guarantee customers get.
 *
 * `effective_from` is a fixed past date so the derivation
 * (`max(version) WHERE effective_from <= now()`) resolves it immediately.
 * A fixed date rather than `now()` keeps the seed deterministic, and a
 * readable one rather than the Unix epoch because the customer SEES this
 * value — "in effect from Wed 31 Dec, 7:00 PM EST" is what epoch-in-EST
 * renders as on the trip page, and it reads like a bug.
 *
 * Backdating here is a SEED-only shortcut: `publishAgreementVersion` refuses
 * a retroactive date, because backdating a real version would invalidate
 * in-flight acceptances mid-visit.
 *
 * COPY: placeholder launch text under the standing copy rules — the service
 * is "delivered to your airline's bag drop", never any claim of checking a
 * traveler in, and there are no numbers here we cannot stand behind. This is
 * NOT legal-reviewed terms; publishing the real ones is an admin action at
 * /agreements, and it is the operator who owns that.
 */
const AGREEMENT_V1_TITLE = "Koolee booking agreement";

/**
 * Fixed, past, and readable. See the note above.
 *
 * 05:00Z is midnight in New York, which is the zone every seeded booking
 * renders in — a bare `00:00Z` displayed to a customer as "in effect from Wed
 * 31 Dec, 7:00 PM EST", which reads like an off-by-one bug on a version
 * labelled v1.
 */
const AGREEMENT_V1_EFFECTIVE_FROM = new Date("2026-01-01T05:00:00Z");

const AGREEMENT_V1_BODY_MD = `## What you are booking

Koolee collects your bags from your door and delivers them to your airline's
bag drop. We do not check you in, issue boarding passes, or act on your behalf
with the airline. You remain responsible for your own check-in and for arriving
at the airport for your flight.

## Identity

The traveler named on the booking must be present at pickup, and our agent
verifies the traveler's passport before taking custody of any bag. If we cannot
verify identity, the agent cannot collect the bags and we will contact you to
sort it out.

## Your bags

Pack your bags as you would for the airport, and follow your airline's rules on
what may travel in checked luggage. Do not give us anything you are not
permitted to check, anything prohibited by law, or anything you would not
entrust to an airline's baggage system.

We photograph and seal each bag in front of you with a serialized tamper-evident
seal, and we record every hand-off. That record is yours to see on your trip
page.

## Money

Your card is authorized when you book and charged once your bags have been
collected and sealed. Cancellation terms are shown when you cancel.

## If something goes wrong

Tell us as soon as you can. Our custody record — the seals, the photos, and the
timestamps — is what we investigate against, and it is what we will share with
you.

---

_Placeholder terms for launch. Replace this version at the admin console's
agreements page with the legally reviewed text before taking real bookings._
`;

async function seedAgreementV1(db: ReturnType<typeof createDb>): Promise<void> {
  console.log("Seeding booking agreement v1…");
  const inserted = await db
    .insert(agreementVersions)
    .values({
      version: 1,
      title: AGREEMENT_V1_TITLE,
      bodyMd: AGREEMENT_V1_BODY_MD,
      effectiveFrom: AGREEMENT_V1_EFFECTIVE_FROM,
    })
    .onConflictDoNothing({ target: agreementVersions.version })
    .returning({ id: agreementVersions.id });
  console.log(
    inserted.length > 0
      ? "  agreement v1 inserted"
      : "  agreement v1 already present — left untouched (published versions are frozen)",
  );
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
    const listRes = await fetch(
      `${supabaseUrl}/auth/v1/admin/users?page=1&per_page=1000`,
      {
        headers,
      },
    );
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
  const agentUserIds: string[] = [];
  const staffAccounts = [
    {
      email: "admin@koolee.local",
      password: "koolee-admin-dev-1",
      role: "admin" as const,
      fullName: "Alex Morgan",
    },
    {
      email: "admin2@koolee.local",
      password: "koolee-admin-dev-2",
      role: "admin" as const,
      fullName: "Priya Rao",
    },
    {
      email: "agent@koolee.local",
      password: "koolee-agent-dev-1",
      role: "agent" as const,
      fullName: "Leo Vargas",
    },
    {
      email: "agent2@koolee.local",
      password: "koolee-agent-dev-2",
      role: "agent" as const,
      fullName: "Nina Petrov",
    },
    {
      email: "agent3@koolee.local",
      password: "koolee-agent-dev-3",
      role: "agent" as const,
      fullName: "Sam Okafor",
    },
    {
      email: "agent4@koolee.local",
      password: "koolee-agent-dev-4",
      role: "agent" as const,
      fullName: "Tara Lin",
    },
    {
      email: "agent5@koolee.local",
      password: "koolee-agent-dev-5",
      role: "agent" as const,
      fullName: "Jonas Weber",
    },
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
    if (account.role === "agent") agentUserIds.push(userId);
    console.log(`  ${account.email} → ${account.role} (password documented in seed.ts)`);
  }

  // Dev zone coverage: every covered ZIP gets exactly one of the seeded
  // agents, so auto-assign can ALWAYS pick someone locally. Deterministic on
  // purpose — the sorted ZIP list round-robins across the agents in roster
  // order (agent → agent5), so the same ZIP always lands on the same agent
  // and a re-run converges instead of reshuffling: the seeded agents' zones
  // are replaced wholesale (other agents' zones are untouched).
  if (agentUserIds.length > 0) {
    const zips = [...ALL_COVERAGE_ZIPS].sort();
    await db.delete(agentZones).where(inArray(agentZones.agentUserId, agentUserIds));
    await db
      .insert(agentZones)
      .values(
        zips.map((zip, i) => ({
          agentUserId: agentUserIds[i % agentUserIds.length]!,
          zip,
        })),
      )
      .onConflictDoNothing();
    console.log(
      `  agent zones: ${zips.length} covered ZIPs round-robined across ${agentUserIds.length} agents`,
    );
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
