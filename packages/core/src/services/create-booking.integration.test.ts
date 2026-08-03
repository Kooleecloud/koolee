import { fileURLToPath } from "node:url";
import path from "node:path";

import { addDays, addHours, startOfDay, subMinutes } from "date-fns";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  addresses,
  airlineCutoffs,
  airports,
  bags,
  bookings,
  createDb,
  custodyEvents,
  payments,
  pricingRules,
  slots,
  users,
  type Database,
} from "@koolee/db";

import { createCoreConfig, fixedClock, type CoreConfig } from "../config";
import { OutOfCoverageError, SlotNotSellableError, SlotSoldOutError } from "../errors";
import { FakePaymentProvider } from "../payments/fake";
import { errorChainMessage, pgErrorCode } from "../test-utils/db-errors";
import { createBooking } from "./create-booking";

/**
 * Integration tests for the booking orchestrator against a real Postgres.
 *
 * OPT-IN. Without `TEST_DATABASE_URL` the whole suite skips, which is what
 * keeps `pnpm test` green on a fresh clone with no environment configured.
 *
 * To run:
 *   docker compose up -d
 *   TEST_DATABASE_URL=postgres://koolee:koolee@localhost:5433/koolee \
 *     pnpm --filter @koolee/core test:integration
 *
 * Docker-compose Postgres was chosen over testcontainers: one fewer dependency,
 * it is the same container developers already run for `pnpm dev`, and it does
 * not need a Docker socket available to the test process.
 *
 * The suite migrates the database it is pointed at and truncates between
 * tests. Point it at a throwaway instance, never at anything you care about.
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIntegration = TEST_DATABASE_URL ? describe : describe.skip;

if (!TEST_DATABASE_URL) {
  console.log(
    "[integration] TEST_DATABASE_URL not set — skipping createBooking integration tests.\n" +
      "  docker compose up -d && TEST_DATABASE_URL=postgres://koolee:koolee@localhost:5433/koolee pnpm --filter @koolee/core test:integration",
  );
}

const migrationsFolder = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../db/drizzle",
);

describeIntegration("createBooking (integration)", () => {
  let sqlClient: ReturnType<typeof postgres>;
  let db: Database;
  let paymentProvider: FakePaymentProvider;
  let config: CoreConfig;
  // Two configs on separate single-connection pools, so the race test's
  // concurrent callers provably arrive over distinct database connections.
  let configA: CoreConfig;
  let configB: CoreConfig;

  // A fixed "now" keeps slot sellability deterministic.
  const now = new Date("2025-06-10T10:00:00Z");
  const departureAt = new Date("2025-06-12T22:00:00Z");

  let userId: string;
  let addressId: string;
  let slotId: string;

  beforeAll(async () => {
    sqlClient = postgres(TEST_DATABASE_URL!, { max: 1, prepare: false });
    await migrate(drizzle(sqlClient), { migrationsFolder });

    db = createDb({ url: TEST_DATABASE_URL!, max: 5 });
    paymentProvider = new FakePaymentProvider();
    config = createCoreConfig({
      db,
      payments: paymentProvider,
      clock: fixedClock(now),
      defaults: { minimumLeadMinutes: 0 },
    });

    // Like `db` above, these pools are reaped by idle_timeout rather than
    // closed explicitly — the suite has no handle to end a createDb pool.
    configA = createCoreConfig({
      db: createDb({ url: TEST_DATABASE_URL!, max: 1 }),
      payments: paymentProvider,
      clock: fixedClock(now),
      defaults: { minimumLeadMinutes: 0 },
    });
    configB = createCoreConfig({
      db: createDb({ url: TEST_DATABASE_URL!, max: 1 }),
      payments: paymentProvider,
      clock: fixedClock(now),
      defaults: { minimumLeadMinutes: 0 },
    });
  });

  afterAll(async () => {
    await sqlClient.end();
  });

  beforeEach(async () => {
    paymentProvider.reset();

    // custody_events refuses TRUNCATE (the append-only trigger), so it is
    // dropped via a cascade from bookings instead. That is exactly the
    // behaviour the trigger is supposed to have.
    await sqlClient.unsafe(`
      SET session_replication_role = replica;
      DELETE FROM custody_events;
      DELETE FROM payments;
      DELETE FROM bags;
      DELETE FROM bookings;
      DELETE FROM slots;
      DELETE FROM airline_cutoffs;
      DELETE FROM pricing_rules;
      DELETE FROM addresses;
      DELETE FROM users;
      DELETE FROM airports;
      SET session_replication_role = DEFAULT;
    `);

    await db.insert(airports).values({
      code: "JFK",
      name: "John F. Kennedy International",
      tz: "America/New_York",
    });

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
      slotTierMultiplier: { standard_4h: 1 },
      discountRules: [],
      active: true,
    });

    const [user] = await db
      .insert(users)
      .values({ phone: "+15551230000", fullName: "Test Customer" })
      .returning();
    userId = user!.id;

    const [address] = await db
      .insert(addresses)
      .values({
        userId,
        line1: "1 Test St",
        city: "New York",
        state: "NY",
        zip: "10001",
      })
      .returning();
    addressId = address!.id;

    // Window well before the latest safe pickup start
    // (22:00Z − 45 − 60 − 30 = 19:45Z).
    const [slot] = await db
      .insert(slots)
      .values({
        airportCode: "JFK",
        tier: "standard_4h",
        windowStart: new Date("2025-06-12T12:00:00Z"),
        windowEnd: new Date("2025-06-12T16:00:00Z"),
        capacity: 2,
        bookedCount: 0,
      })
      .returning();
    slotId = slot!.id;
  });

  const input = (over: Partial<Parameters<typeof createBooking>[1]> = {}) => ({
    userId,
    pickupAddressId: addressId,
    slotId,
    flightNumber: "dl123",
    airlineIata: "dl",
    departureAirport: "JFK" as const,
    departureAt,
    scope: "domestic" as const,
    paxName: "Test Customer",
    bagCount: 2,
    distanceKm: 20,
    ...over,
  });

  it("writes booking, bags, custody event and payment in one coherent state", async () => {
    const result = await createBooking(config, input());

    expect(result.booking.status).toBe("paid");
    expect(result.booking.priceCents).toBe(6800); // 2900 + 2×1500 + 900
    expect(result.breakdown.totalCents).toBe(6800);
    expect(result.payment.status).toBe("authorized");

    // Flight and airline codes are normalised to upper case.
    expect(result.booking.flightNumber).toBe("DL123");
    expect(result.booking.airlineIata).toBe("DL");

    const bagRows = await db
      .select()
      .from(bags)
      .where(eq(bags.bookingId, result.booking.id));
    expect(bagRows).toHaveLength(2);

    const events = await db
      .select()
      .from(custodyEvents)
      .where(eq(custodyEvents.bookingId, result.booking.id));
    expect(events.map((e) => e.eventType).sort()).toEqual([
      "booking.created",
      "booking.payment_authorized",
    ]);

    const paymentRows = await db
      .select()
      .from(payments)
      .where(eq(payments.bookingId, result.booking.id));
    expect(paymentRows).toHaveLength(1);
    expect(paymentRows[0]!.status).toBe("authorized");
    expect(paymentRows[0]!.provider).toBe("fake");

    const [slotRow] = await db.select().from(slots).where(eq(slots.id, slotId));
    expect(slotRow!.bookedCount).toBe(1);
  });

  /**
   * Runs concurrent bookings that all provably race at the capacity claim.
   *
   * A gate transaction pins the slot row FOR UPDATE. Plain reads don't block,
   * so every caller passes the sellability pre-check, then queues on its
   * conditional-UPDATE claim. The gate opens only after all of them are
   * observed waiting on the lock — losers therefore fail at the locked claim
   * (SlotSoldOutError), never at the pre-check (SlotNotSellableError). Without
   * the gate the loser's error depends on timing, which is exactly the
   * flakiness this avoids.
   */
  async function raceAtSlotClaim(launch: () => Promise<unknown>[]) {
    let openGate!: () => void;
    const gateOpened = new Promise<void>((resolve) => (openGate = resolve));
    let signalLockHeld!: () => void;
    const lockHeld = new Promise<void>((resolve) => (signalLockHeld = resolve));

    const gate = sqlClient.begin(async (tx) => {
      await tx`SELECT id FROM slots WHERE id = ${slotId} FOR UPDATE`;
      signalLockHeld();
      await gateOpened;
    });
    await lockHeld;

    const attempts = launch();

    // The poll pattern is anchored (no leading %) and the polling query's own
    // text starts with whitespace, so it never matches itself.
    let allQueued = false;
    const deadline = Date.now() + 10_000;
    while (!allQueued && Date.now() < deadline) {
      const rows = await db.execute(sql`
        SELECT count(*)::int AS waiting
        FROM pg_stat_activity
        WHERE wait_event_type = 'Lock' AND query LIKE 'update "slots"%'
      `);
      allQueued = Number(rows[0]?.waiting) >= attempts.length;
      if (!allQueued) await new Promise((resolve) => setTimeout(resolve, 25));
    }
    openGate();
    await gate;

    const results = await Promise.allSettled(attempts);
    expect(allQueued, "every claim must reach the slot row lock before it releases").toBe(
      true,
    );
    return results;
  }

  it("does not oversell a slot under concurrency", async () => {
    // capacity 2, three attempts racing at the claim.
    const results = await raceAtSlotClaim(() => [
      createBooking(config, input()),
      createBooking(config, input()),
      createBooking(config, input()),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(fulfilled).toHaveLength(2);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      SlotSoldOutError,
    );

    const [slotRow] = await db.select().from(slots).where(eq(slots.id, slotId));
    expect(slotRow!.bookedCount).toBe(2);
    expect(slotRow!.bookedCount).toBeLessThanOrEqual(slotRow!.capacity);

    const bookingRows = await db.select().from(bookings);
    expect(bookingRows).toHaveLength(2);
  });

  it("settles a race for the last seat at the row lock: one winner, one SlotSoldOutError", async () => {
    // Exactly one seat remaining; two real concurrent calls over two separate
    // connections (configA/B each own a single-connection pool).
    await db.update(slots).set({ bookedCount: 1 }).where(eq(slots.id, slotId));

    const results = await raceAtSlotClaim(() => [
      createBooking(configA, input()),
      createBooking(configB, input()),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(SlotSoldOutError);

    const [slotRow] = await db.select().from(slots).where(eq(slots.id, slotId));
    expect(slotRow!.bookedCount).toBe(2);
    expect(slotRow!.bookedCount).toBeLessThanOrEqual(slotRow!.capacity);

    // The loser's transaction rolled back whole — only the winner's rows exist.
    expect(await db.select().from(bookings)).toHaveLength(1);
    expect(await db.select().from(payments)).toHaveLength(1);
  });

  it("refuses a slot already full at request time, writing nothing", async () => {
    await db.update(slots).set({ bookedCount: 2 }).where(eq(slots.id, slotId));

    // Known-full at request time is the sellability pre-check's job —
    // SlotSoldOutError is reserved for losing the race at the row lock
    // (covered by the concurrency tests above).
    const error = await createBooking(config, input()).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(SlotNotSellableError);
    expect((error as SlotNotSellableError).reason).toBe("at_capacity");

    expect(await db.select().from(bookings)).toHaveLength(0);
    expect(await db.select().from(bags)).toHaveLength(0);
    expect(await db.select().from(custodyEvents)).toHaveLength(0);
    expect(await db.select().from(payments)).toHaveLength(0);
  });

  it("compensates when payment authorization fails — no phantom slot held", async () => {
    paymentProvider.failAuthorize = true;

    await expect(createBooking(config, input())).rejects.toThrow(/Authorization failed/);

    const bookingRows = await db.select().from(bookings);
    expect(bookingRows).toHaveLength(1);
    expect(bookingRows[0]!.status).toBe("cancelled");

    const [slotRow] = await db.select().from(slots).where(eq(slots.id, slotId));
    expect(slotRow!.bookedCount).toBe(0);

    expect(await db.select().from(payments)).toHaveLength(0);

    const events = await db.select().from(custodyEvents);
    expect(events.map((e) => e.eventType)).toEqual([
      "booking.created",
      "booking.cancelled",
    ]);
  });

  it("refuses a slot that cannot make the bag-drop cutoff", async () => {
    // Window ends 21:00Z; latest safe start is 19:45Z.
    const [lateSlot] = await db
      .insert(slots)
      .values({
        airportCode: "JFK",
        tier: "standard_4h",
        windowStart: new Date("2025-06-12T17:00:00Z"),
        windowEnd: new Date("2025-06-12T21:00:00Z"),
        capacity: 5,
        bookedCount: 0,
      })
      .returning();

    await expect(createBooking(config, input({ slotId: lateSlot!.id }))).rejects.toThrow(
      SlotNotSellableError,
    );

    expect(await db.select().from(bookings)).toHaveLength(0);
    const [slotRow] = await db.select().from(slots).where(eq(slots.id, lateSlot!.id));
    expect(slotRow!.bookedCount).toBe(0);
  });

  it("refuses an address outside the coverage area", async () => {
    const [outside] = await db
      .insert(addresses)
      .values({
        userId,
        line1: "1 Far Away",
        city: "Beverly Hills",
        state: "CA",
        zip: "90210",
      })
      .returning();

    await expect(
      createBooking(config, input({ pickupAddressId: outside!.id })),
    ).rejects.toThrow(OutOfCoverageError);

    expect(await db.select().from(bookings)).toHaveLength(0);
  });

  it("refuses an address belonging to another user", async () => {
    const [other] = await db.insert(users).values({ phone: "+15559990000" }).returning();

    await expect(createBooking(config, input({ userId: other!.id }))).rejects.toThrow(
      /Address .* not found/,
    );
  });

  it("refuses to sell when no cutoff is on record for the airline", async () => {
    await expect(createBooking(config, input({ airlineIata: "B6" }))).rejects.toThrow(
      /No bag-drop cutoff on record/,
    );

    expect(await db.select().from(bookings)).toHaveLength(0);
  });

  it("applies the international cutoff separately from domestic", async () => {
    await db.insert(airlineCutoffs).values({
      airlineIata: "DL",
      airportCode: "JFK",
      scope: "international",
      cutoffMinutesBeforeDeparture: 300,
      effectiveFrom: new Date("2024-01-01T00:00:00Z"),
    });

    // Domestic (45m) sells; international (300m) pushes the latest start to
    // 22:00Z − 300 − 60 − 30 = 15:30Z, before this window's 16:00Z end.
    await expect(
      createBooking(config, input({ scope: "international" })),
    ).rejects.toThrow(SlotNotSellableError);

    await expect(createBooking(config, input())).resolves.toBeDefined();
  });
});

describeIntegration("custody_events append-only trigger", () => {
  let sqlClient: ReturnType<typeof postgres>;
  let db: Database;

  beforeAll(async () => {
    sqlClient = postgres(TEST_DATABASE_URL!, { max: 1, prepare: false });
    await migrate(drizzle(sqlClient), { migrationsFolder });
    db = createDb({ url: TEST_DATABASE_URL!, max: 2 });
  });

  afterAll(async () => {
    await sqlClient.end();
  });

  it("rejects UPDATE and DELETE, and accepts a compensating INSERT", async () => {
    await sqlClient.unsafe(`
      SET session_replication_role = replica;
      DELETE FROM custody_events;
      DELETE FROM bags;
      DELETE FROM bookings;
      DELETE FROM slots;
      DELETE FROM addresses;
      DELETE FROM users;
      DELETE FROM airports;
      SET session_replication_role = DEFAULT;
    `);

    await db
      .insert(airports)
      .values({ code: "JFK", name: "JFK", tz: "America/New_York" });
    const [user] = await db.insert(users).values({ phone: "+15551110000" }).returning();
    const [address] = await db
      .insert(addresses)
      .values({
        userId: user!.id,
        line1: "1 Test St",
        city: "New York",
        state: "NY",
        zip: "10001",
      })
      .returning();

    const day = startOfDay(addDays(new Date(), 1));
    const [slot] = await db
      .insert(slots)
      .values({
        airportCode: "JFK",
        tier: "standard_4h",
        windowStart: addHours(day, 8),
        windowEnd: addHours(day, 12),
        capacity: 1,
      })
      .returning();

    const [booking] = await db
      .insert(bookings)
      .values({
        userId: user!.id,
        flightNumber: "DL1",
        airlineIata: "DL",
        departureAirport: "JFK",
        departureAt: addHours(day, 20),
        paxName: "Test",
        pickupAddressId: address!.id,
        bagCount: 1,
        slotId: slot!.id,
        priceCents: 1000,
      })
      .returning();

    const [event] = await db
      .insert(custodyEvents)
      .values({ bookingId: booking!.id, eventType: "booking.created" })
      .returning();

    // drizzle wraps Postgres errors in DrizzleQueryError ("Failed query: …");
    // the trigger's message and SQLSTATE live on the cause chain. The trigger
    // raises ERRCODE 'restrict_violation' (23001) — assert that too, since a
    // code is a more stable contract than message text.
    const updateError = await db
      .update(custodyEvents)
      .set({ eventType: "tampered" })
      .where(eq(custodyEvents.id, event!.id))
      .then(() => null, (e: unknown) => e);
    expect(updateError).toBeInstanceOf(Error);
    expect(errorChainMessage(updateError)).toMatch(/append-only/);
    expect(pgErrorCode(updateError)).toBe("23001");

    const deleteError = await db
      .delete(custodyEvents)
      .where(eq(custodyEvents.id, event!.id))
      .then(() => null, (e: unknown) => e);
    expect(deleteError).toBeInstanceOf(Error);
    expect(errorChainMessage(deleteError)).toMatch(/append-only/);
    expect(pgErrorCode(deleteError)).toBe("23001");

    // Raw postgres.js is not wrapped, but the helpers handle a chain of one.
    const truncateError = await sqlClient
      .unsafe(`TRUNCATE custody_events`)
      .then(() => null, (e: unknown) => e);
    expect(truncateError).toBeInstanceOf(Error);
    expect(errorChainMessage(truncateError)).toMatch(/append-only/);
    expect(pgErrorCode(truncateError)).toBe("23001");

    // The supported way to correct the record.
    await db.insert(custodyEvents).values({
      bookingId: booking!.id,
      eventType: "booking.correction",
      metadata: { corrects: event!.id, note: "compensating entry" },
    });

    const rows = await db
      .select()
      .from(custodyEvents)
      .where(eq(custodyEvents.bookingId, booking!.id));
    expect(rows).toHaveLength(2);

    // The original is untouched.
    expect(rows.find((r) => r.id === event!.id)?.eventType).toBe("booking.created");
  });
});

// Referenced so the imports stay honest if the suite is skipped.
void subMinutes;
