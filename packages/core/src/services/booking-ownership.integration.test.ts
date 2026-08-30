import { fileURLToPath } from "node:url";
import path from "node:path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  airlineCutoffs,
  airports,
  bookings,
  createDb,
  pricingRules,
  users,
  type Database,
} from "@koolee/db";
import { TEST_AIRPORTS } from "../test-utils/airport-fixtures";

import { guardUpgradeOtpSend } from "../auth/upgrade-guard";
import type { CustomerSession } from "../auth/types";
import { createCoreConfig, fixedClock, type CoreConfig } from "../config";
import { NotAuthorizedError, NotFoundError } from "../errors";
import { FakePaymentProvider } from "../payments/fake";
import {
  getBookingForSession,
  listBookingsForSession,
} from "./bookings";
import { createBooking } from "./create-booking";
import {
  attachVerifiedPhone,
  deleteAnonymousCustomer,
  ensureAddress,
  ensureCustomerFromAuth,
} from "./customers";

/**
 * Phase 1 acceptance — the verified customer session threaded through the
 * booking flow.
 *
 *  1. A booking created under an ANONYMOUS session survives the anonymous →
 *     permanent upgrade and ends up owned by the verified identity. This also
 *     pins down what GoTrue actually does in the local stack: `updateUser`
 *     upgrades the SAME auth row in place, so the uid never changes — the
 *     booking needs no re-parenting. (The other case — a colliding anonymous
 *     row whose draft is deleted — is pinned by acceptance test 15 in
 *     upgrade-guard.integration.test.ts and deliberately not duplicated here.)
 *  2. Customer A cannot read customer B's booking through the core read path
 *     (`getBookingForSession` 404s; `listBookingsForSession` pins a customer
 *     session to its own userId).
 *
 * Skips without GOTRUE_TEST_DATABASE_URL, and fails loudly (not skip) when the
 * GoTrue stack is missing, because test 1 would otherwise pass vacuously.
 * It also requires ALLOW_DEV_DB_WIPE — see the note on that constant.
 */

const GOTRUE_TEST_DATABASE_URL = process.env.GOTRUE_TEST_DATABASE_URL;
/**
 * This suite is the one that cannot be made non-destructive.
 *
 * It needs BOTH a GoTrue-served database (only `postgres`, for the in-place
 * upgrade and the `auth.users` reads) AND an empty world: it seeds its own
 * `airports`, `airline_cutoffs`, and `pricing_rules`, which collide with the
 * dev seed on insert, and forcing its values over them would leave the dev
 * reference data quietly rewritten. The other eleven suites either run in the
 * disposable `koolee_test` database or preserve pre-existing rows.
 *
 * So it wipes, and wiping is opt-in. Default is skip — a run that would
 * delete real bookings must be asked for by name.
 */
const ALLOW_DEV_DB_WIPE = process.env.ALLOW_DEV_DB_WIPE === "1";
const AUTH_SCHEMA_AVAILABLE = process.env.AUTH_SCHEMA_AVAILABLE === "true";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const describeIntegration =
  GOTRUE_TEST_DATABASE_URL && ALLOW_DEV_DB_WIPE ? describe : describe.skip;

if (!GOTRUE_TEST_DATABASE_URL) {
  console.log(
    "[integration] GOTRUE_TEST_DATABASE_URL not set — skipping booking-ownership tests.\n" +
      "  pnpm test:env:up && pnpm --filter @koolee/core test:integration",
  );
} else if (!ALLOW_DEV_DB_WIPE) {
  console.log(
    "[integration] SKIPPING booking-ownership: it EMPTIES the dev database (bookings,\n" +
      "  users, addresses, airports, pricing rules) and cannot be scoped — it needs GoTrue,\n" +
      "  which only serves `postgres`, plus its own reference data.\n" +
      "  Run it deliberately, when losing local data is fine:\n" +
      "    ALLOW_DEV_DB_WIPE=1 pnpm --filter @koolee/core test:integration",
  );
}

const migrationsFolder = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../db/drizzle",
);

/** Local-only number wired to a fixed OTP in supabase/config.toml. */
const UPGRADE_PHONE = { phone: "+15555550102", code: "111111" } as const;

function customerSession(userId: string): CustomerSession {
  return { kind: "customer", role: "customer", userId, phone: "", email: null };
}

const HOUR = 3_600_000;
/** A clock-aligned one-hour pickup window, mid-band and notice-safe. */
function windowFor(departureAt: Date, leadHours = 20) {
  const end = new Date(
    Math.floor((departureAt.getTime() - leadHours * HOUR) / HOUR) * HOUR,
  );
  return { pickupWindowStart: new Date(end.getTime() - HOUR), pickupWindowEnd: end };
}

describeIntegration("booking ownership through the customer session (integration)", () => {
  let sqlClient: ReturnType<typeof postgres>;
  let db: Database;
  let config: CoreConfig;
  let admin: SupabaseClient;
  let createdAuthUserIds: string[];

  // A fixed "now" keeps window bookability deterministic.
  const now = new Date("2025-06-10T10:00:00Z");
  const departureAt = new Date("2025-06-12T22:00:00Z");

  beforeAll(async () => {
    if (!AUTH_SCHEMA_AVAILABLE) {
      throw new Error(
        'AUTH_SCHEMA_AVAILABLE must be "true" to run this suite — the upgrade test ' +
          "exercises real GoTrue in-place upgrade behavior. Run `pnpm test:env:up`.",
      );
    }
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error(
        "SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY must be set. " +
          "Run `pnpm test:env:up`.",
      );
    }

    sqlClient = postgres(GOTRUE_TEST_DATABASE_URL!, { max: 1, prepare: false });
    await migrate(drizzle(sqlClient), { migrationsFolder });
    db = createDb({ url: GOTRUE_TEST_DATABASE_URL!, max: 5 });
    config = createCoreConfig({
      db,
      payments: new FakePaymentProvider(),
      clock: fixedClock(now),
    });
    admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  });

  afterAll(async () => {
    await sqlClient?.end();
  });

  beforeEach(async () => {
    createdAuthUserIds = [];
    // Blanket wipe, guarded by ALLOW_DEV_DB_WIPE above. Deliberate: this suite
    // asserts against an empty world and seeds its own reference data.
    await sqlClient.unsafe(`
      SET session_replication_role = replica;
      DELETE FROM custody_events;
      DELETE FROM payments;
      DELETE FROM bags;
      DELETE FROM bookings;
      DELETE FROM slot_blocks;
      DELETE FROM slots;
      DELETE FROM airline_cutoffs;
      DELETE FROM pricing_rules;
      DELETE FROM addresses;
      DELETE FROM booking_drafts;
      DELETE FROM otp_send_log;
      DELETE FROM users;
      DELETE FROM airports;
      SET session_replication_role = DEFAULT;
    `);

    // Best-effort: remove GoTrue users left at the fixed test number by a
    // previous crashed run.
    const bare = UPGRADE_PHONE.phone.replace(/^\+/, "");
    const rows = (await db.execute(
      sql`select id::text as id from auth.users
          where phone in (${UPGRADE_PHONE.phone}, ${bare})
             or phone_change in (${UPGRADE_PHONE.phone}, ${bare})`,
    )) as unknown as Array<{ id: string }>;
    for (const row of rows) await deleteAuthUser(row.id);

    await db.insert(airports).values(TEST_AIRPORTS.JFK);
    await db.insert(airlineCutoffs).values({
      airlineIata: "DL",
      airportCode: "JFK",
      scope: "domestic",
      cutoffMinutesBeforeDeparture: 45,
      effectiveFrom: new Date("2024-01-01T00:00:00Z"),
    });
    await db.insert(pricingRules).values({
      name: "test",
      baseFeeCents: 2900,
      perBagCents: 1500,
      distanceMultiplier: "45.0000",
      leadTimeMultipliers: [],
      discountRules: [],
      active: true,
    });
  });

  afterEach(async () => {
    for (const id of createdAuthUserIds) await deleteAuthUser(id);
  });

  async function deleteAuthUser(userId: string): Promise<void> {
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error && error.status !== 404 && !/not.?found/i.test(error.message)) {
      throw new Error(`admin.deleteUser(${userId}): ${error.message}`);
    }
  }

  async function signInAnon(): Promise<{ client: SupabaseClient; userId: string }> {
    const client = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await client.auth.signInAnonymously();
    if (error || !data.user) throw new Error(`signInAnonymously failed: ${error?.message}`);
    createdAuthUserIds.push(data.user.id);
    return { client, userId: data.user.id };
  }

  async function bookFor(userId: string) {
    const address = await ensureAddress(db, userId, {
      line1: "1 Test St",
      city: "New York",
      state: "NY",
      zip: "10001",
    });
    return createBooking(config, {
      userId,
      pickupAddressId: address.id,
      quotedZip: address.zip,
      ...windowFor(departureAt),
      flightNumber: "DL123",
      airlineIata: "DL",
      departureAirport: "JFK",
      departureAt,
      scope: "domestic",
      paxName: "Test Customer",
      bagCount: 1,
      distanceKm: 20,
    });
  }

  it("a booking created under an anonymous session ends up owned by the verified identity after the guarded in-place upgrade", async () => {
    const { phone: PHONE, code: CODE } = UPGRADE_PHONE;

    // 1. Anonymous funnel user — a valid customer at draft time.
    const anon = await signInAnon();
    await ensureCustomerFromAuth(db, { authUserId: anon.userId, isAnonymous: true });

    // 2. Booking created while the session is still anonymous (core-level:
    //    the app's pay gate normally forces verification first, but the row
    //    must survive either way).
    const { booking } = await bookFor(anon.userId);
    expect(booking.userId).toBe(anon.userId);

    // 3. Upgrade via the production guard sequence: guarded send → updateUser
    //    → verifyOtp(phone_change).
    const guard = await guardUpgradeOtpSend(db, {
      userId: anon.userId,
      destination: PHONE,
      kind: "phone",
      deleteAuthUser,
      log: () => {},
    });
    expect(guard.allowed).toBe(true);
    expect(guard.conflict).toBe(false);

    const { error: updateErr } = await anon.client.auth.updateUser({ phone: PHONE });
    expect(updateErr).toBeNull();

    const { data: verified, error: verifyErr } = await anon.client.auth.verifyOtp({
      phone: PHONE,
      token: CODE,
      type: "phone_change",
    });
    expect(verifyErr).toBeNull();

    // THE in-place fact this suite pins: GoTrue upgraded the same auth row —
    // the uid did not change.
    expect(verified?.user?.id).toBe(anon.userId);
    expect(verified?.user?.is_anonymous ?? false).toBe(false);

    await attachVerifiedPhone(db, { authUserId: anon.userId, phone: PHONE });

    // 4. The booking's customer resolves to the verified user...
    const [row] = await db.select().from(bookings).where(eq(bookings.id, booking.id));
    expect(row!.userId).toBe(anon.userId);
    const owner = await db.query.users.findFirst({ where: eq(users.id, anon.userId) });
    expect(owner?.isAnonymous).toBe(false);
    expect(owner?.phone).toBe(PHONE);

    // ...and the /trips query (session-scoped list) returns it.
    const trips = await listBookingsForSession(db, customerSession(anon.userId), {
      limit: 50,
    });
    expect(trips.map((b) => b.id)).toEqual([booking.id]);
  });

  it("customer A cannot fetch customer B's booking through the core read path", async () => {
    const [a] = await db
      .insert(users)
      .values({ phone: "+15551110001", role: "customer" })
      .returning();
    const [b] = await db
      .insert(users)
      .values({ phone: "+15551110002", role: "customer" })
      .returning();

    const { booking: bBooking } = await bookFor(b!.id);

    // Single read: 404-shaped, never a disclosure.
    await expect(
      getBookingForSession(db, customerSession(a!.id), bBooking.id),
    ).rejects.toThrow(NotFoundError);

    // The owner still reads it fine.
    await expect(
      getBookingForSession(db, customerSession(b!.id), bBooking.id),
    ).resolves.toMatchObject({ booking: { id: bBooking.id } });

    // List: a customer session is pinned to its own userId...
    const asA = await listBookingsForSession(db, customerSession(a!.id));
    expect(asA).toEqual([]);

    // ...and asking for someone else's id throws rather than narrowing.
    await expect(
      listBookingsForSession(db, customerSession(a!.id), { userId: b!.id }),
    ).rejects.toThrow(NotAuthorizedError);
  });

  it("deleteAnonymousCustomer refuses a row that owns bookings", async () => {
    const [anonRow] = await db
      .insert(users)
      .values({ isAnonymous: true, role: "customer" })
      .returning();
    await bookFor(anonRow!.id);

    await expect(deleteAnonymousCustomer(db, anonRow!.id)).resolves.toBe(false);
    expect(
      await db.query.users.findFirst({ where: eq(users.id, anonRow!.id) }),
    ).toBeDefined();
  });
});
