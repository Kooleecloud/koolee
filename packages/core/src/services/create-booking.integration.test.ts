import { fileURLToPath } from "node:url";
import path from "node:path";

import { eq } from "drizzle-orm";
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
  slotBlocks,
  users,
  type Database,
} from "@koolee/db";

import { createCoreConfig, type CoreConfig } from "../config";
import { OutOfCoverageError, SlotNotSellableError } from "../errors";
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
 *   pnpm test:env:up                              # writes .env.test
 *   pnpm --filter @koolee/core test:integration
 *
 * A bare `docker compose up -d` Postgres (host port 5433) works for this file
 * too — set TEST_DATABASE_URL yourself — but it carries no GoTrue `auth`
 * schema, so the auth-acceptance tier needs the Supabase stack. See
 * packages/core/docs/local-test-env.md.
 *
 * The suite migrates the database it is pointed at and clears rows between
 * tests. Point it at a throwaway instance, never at anything you care about.
 *
 * Pickup windows are virtual (no inventory, no capacity), so fixtures anchor
 * on the REAL clock: a clock-aligned departure ~3 days out keeps every
 * mid-band window comfortably past the 2h booking notice, and the window
 * rules (band, notice, blackouts) are what these tests exercise.
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIntegration = TEST_DATABASE_URL ? describe : describe.skip;

if (!TEST_DATABASE_URL) {
  console.log(
    "[integration] TEST_DATABASE_URL not set — skipping createBooking integration tests.\n" +
      "  pnpm test:env:up && pnpm --filter @koolee/core test:integration",
  );
}

const migrationsFolder = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../db/drizzle",
);

const HOUR = 3_600_000;

/** Floors an instant to the previous epoch hour boundary. */
function alignToHour(instant: Date): Date {
  return new Date(Math.floor(instant.getTime() / HOUR) * HOUR);
}

/** Clock-aligned 1h window ending ~`leadHours` before departure — mid-band
 * and notice-safe at the default of 20h. */
function windowFor(departureAt: Date, leadHours = 20) {
  const end = new Date(Math.floor((departureAt.getTime() - leadHours * HOUR) / HOUR) * HOUR);
  return { pickupWindowStart: new Date(end.getTime() - HOUR), pickupWindowEnd: end };
}

describeIntegration("createBooking (integration)", () => {
  let sqlClient: ReturnType<typeof postgres>;
  let db: Database;
  let paymentProvider: FakePaymentProvider;
  let config: CoreConfig;

  // ~3 days out, clock-aligned, real clock. At the defaults the bookable band
  // is windows ENDING in (departureAt − 30h, departureAt − 6h].
  const departureAt = new Date(alignToHour(new Date()).getTime() + 72 * HOUR);
  const validWindow = windowFor(departureAt); // ends departureAt − 20h

  let userId: string;
  let addressId: string;

  beforeAll(async () => {
    sqlClient = postgres(TEST_DATABASE_URL!, { max: 1, prepare: false });
    await migrate(drizzle(sqlClient), { migrationsFolder });

    db = createDb({ url: TEST_DATABASE_URL!, max: 5 });
    paymentProvider = new FakePaymentProvider();
    // Stock defaults and the system clock: fixtures are built relative to the
    // real "now", so nothing needs overriding.
    config = createCoreConfig({ db, payments: paymentProvider });
  });

  afterAll(async () => {
    await sqlClient.end();
  });

  beforeEach(async () => {
    paymentProvider.reset();

    // custody_events refuses TRUNCATE (the append-only trigger), so it is
    // dropped via a cascade from bookings instead. That is exactly the
    // behaviour the trigger is supposed to have. `slots` still exists (legacy
    // inventory, kept for pre-cutover rows) and is cleaned alongside.
    await sqlClient.unsafe(`
      SET session_replication_role = replica;
      DELETE FROM custody_events;
      DELETE FROM payments;
      DELETE FROM bags;
      DELETE FROM bookings;
      DELETE FROM slots;
      DELETE FROM slot_blocks;
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

    // Lead-time step curve: windows ending within 10h of departure cost ×1.4;
    // anything further out is base price. The retired slotTierMultiplier
    // column is left at its default — the engine no longer reads it.
    await db.insert(pricingRules).values({
      name: "test",
      baseFeeCents: 2900,
      perBagCents: 1500,
      distanceMultiplier: "45.0000",
      leadTimeMultipliers: [{ maxLeadMinutes: 600, multiplier: 1.4 }],
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
  });

  const input = (over: Partial<Parameters<typeof createBooking>[1]> = {}) => ({
    userId,
    pickupAddressId: addressId,
    ...validWindow,
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

  /** Resolves to the rejection (or null on success), for reason assertions. */
  const rejectionOf = (promise: Promise<unknown>) =>
    promise.then(
      () => null,
      (e: unknown) => e,
    );

  it("writes booking, bags, custody event and payment in one coherent state", async () => {
    const result = await createBooking(config, input());

    expect(result.booking.status).toBe("paid");
    // 2900 + 2×1500 + 900; lead 20h is outside every step, so ×1.
    expect(result.booking.priceCents).toBe(6800);
    expect(result.breakdown.totalCents).toBe(6800);
    expect(result.breakdown.leadTimeMultiplier).toBe(1);
    expect(result.payment.status).toBe("authorized");

    // Flight and airline codes are normalised to upper case.
    expect(result.booking.flightNumber).toBe("DL123");
    expect(result.booking.airlineIata).toBe("DL");

    // The window lives on the booking itself; there is no slot pointer.
    expect(result.booking.slotId).toBeNull();
    expect(result.booking.pickupWindowStart?.getTime()).toBe(
      validWindow.pickupWindowStart.getTime(),
    );
    expect(result.booking.pickupWindowEnd?.getTime()).toBe(
      validWindow.pickupWindowEnd.getTime(),
    );

    // The price snapshot is written alongside the charge and agrees with it.
    expect(result.booking.priceBreakdown).not.toBeNull();
    expect(result.booking.priceBreakdown!.totalCents).toBe(result.booking.priceCents);

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

    // The creation event records the window, not a slot id.
    const createdEvent = events.find((e) => e.eventType === "booking.created");
    const meta = createdEvent!.metadata!;
    expect(meta["pickupWindowStart"]).toBe(validWindow.pickupWindowStart.toISOString());
    expect(meta["pickupWindowEnd"]).toBe(validWindow.pickupWindowEnd.toISOString());
    expect(meta).not.toHaveProperty("slotId");

    const paymentRows = await db
      .select()
      .from(payments)
      .where(eq(payments.bookingId, result.booking.id));
    expect(paymentRows).toHaveLength(1);
    expect(paymentRows[0]!.status).toBe("authorized");
    expect(paymentRows[0]!.provider).toBe("fake");
  });

  it("accepts two concurrent bookings of the same window — windows have no capacity", async () => {
    const [first, second] = await Promise.all([
      createBooking(config, input()),
      createBooking(config, input()),
    ]);

    expect(first.booking.status).toBe("paid");
    expect(second.booking.status).toBe("paid");
    expect(first.booking.id).not.toBe(second.booking.id);

    expect(await db.select().from(bookings)).toHaveLength(2);
    expect(await db.select().from(payments)).toHaveLength(2);
  });

  it("compensates when payment authorization fails — booking cancelled, custody trail appended", async () => {
    paymentProvider.failAuthorize = true;

    await expect(createBooking(config, input())).rejects.toThrow(/Authorization failed/);

    const bookingRows = await db.select().from(bookings);
    expect(bookingRows).toHaveLength(1);
    expect(bookingRows[0]!.status).toBe("cancelled");

    expect(await db.select().from(payments)).toHaveLength(0);

    const events = await db.select().from(custodyEvents);
    expect(events.map((e) => e.eventType)).toEqual([
      "booking.created",
      "booking.cancelled",
    ]);
  });

  it("refuses a window overlapping an ops blackout", async () => {
    await db.insert(slotBlocks).values({
      airportCode: "JFK",
      blockStart: new Date(validWindow.pickupWindowStart.getTime() + 30 * 60 * 1000),
      blockEnd: new Date(validWindow.pickupWindowEnd.getTime() + HOUR),
      reason: "no drivers",
    });

    const error = await rejectionOf(createBooking(config, input()));
    expect(error).toBeInstanceOf(SlotNotSellableError);
    expect((error as SlotNotSellableError).reason).toBe("blocked");

    expect(await db.select().from(bookings)).toHaveLength(0);
    expect(await db.select().from(custodyEvents)).toHaveLength(0);
  });

  it("refuses a hand-crafted window the enumerator would never produce", async () => {
    // Starts at :30 — not on an epoch hour boundary.
    const start = new Date(validWindow.pickupWindowStart.getTime() + 30 * 60 * 1000);
    const end = new Date(start.getTime() + HOUR);

    const error = await rejectionOf(
      createBooking(config, input({ pickupWindowStart: start, pickupWindowEnd: end })),
    );
    expect(error).toBeInstanceOf(SlotNotSellableError);
    expect((error as SlotNotSellableError).reason).toBe("not_a_window");

    expect(await db.select().from(bookings)).toHaveLength(0);
  });

  it("refuses a window that cannot make the bag-drop cutoff", async () => {
    // Ends departureAt − 5h, inside the 6h operations reserve.
    const error = await rejectionOf(
      createBooking(config, input(windowFor(departureAt, 5))),
    );
    expect(error).toBeInstanceOf(SlotNotSellableError);
    expect((error as SlotNotSellableError).reason).toBe("misses_bag_drop_cutoff");

    expect(await db.select().from(bookings)).toHaveLength(0);
  });

  it("refuses a window before the bookable band opens", async () => {
    // Ends departureAt − 31h, before the band floor at departureAt − 30h.
    const error = await rejectionOf(
      createBooking(config, input(windowFor(departureAt, 31))),
    );
    expect(error).toBeInstanceOf(SlotNotSellableError);
    expect((error as SlotNotSellableError).reason).toBe("too_early_for_flight");

    expect(await db.select().from(bookings)).toHaveLength(0);
  });

  it("refuses a window starting sooner than the booking notice", async () => {
    // Same-day flight: the very next clock hour is a real band window
    // (12h − 30h < end ≤ 12h − 6h holds) but starts within the 2h notice.
    const alignedNow = alignToHour(new Date());
    const soonDeparture = new Date(alignedNow.getTime() + 12 * HOUR);
    const start = new Date(alignedNow.getTime() + HOUR);
    const end = new Date(start.getTime() + HOUR);

    const error = await rejectionOf(
      createBooking(
        config,
        input({
          departureAt: soonDeparture,
          pickupWindowStart: start,
          pickupWindowEnd: end,
        }),
      ),
    );
    expect(error).toBeInstanceOf(SlotNotSellableError);
    expect((error as SlotNotSellableError).reason).toBe("starts_before_notice");

    expect(await db.select().from(bookings)).toHaveLength(0);
  });

  it("prices by lead time: a window closer to departure costs more", async () => {
    // Lead 8h = 480min hits the ≤600min step (×1.4); lead 25h misses every
    // step and stays at base price.
    const close = await createBooking(config, input(windowFor(departureAt, 8)));
    const far = await createBooking(config, input(windowFor(departureAt, 25)));

    expect(far.booking.priceCents).toBe(6800);
    expect(far.breakdown.leadTimeMultiplier).toBe(1);
    expect(far.breakdown.leadTimeAdjustmentCents).toBe(0);

    expect(close.booking.priceCents).toBe(9520); // round(6800 × 1.4)
    expect(close.breakdown.leadTimeMultiplier).toBe(1.4);
    expect(close.breakdown.leadTimeAdjustmentCents).toBe(2720);

    expect(close.booking.priceCents).toBeGreaterThan(far.booking.priceCents);

    // Each row's snapshot carries its own step — per-window pricing data.
    expect(close.booking.priceBreakdown!.leadTimeMultiplier).toBe(1.4);
    expect(far.booking.priceBreakdown!.leadTimeMultiplier).toBe(1);
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

    // A window ending exactly at the reserve edge (departure − 6h). Domestic
    // (45m cutoff) leaves the reserve as the binding limit, so it sells;
    // international pushes the deadline to
    // departure − 300 − 60 − 30 = departure − 6.5h, which this window misses.
    const edgeWindow = windowFor(departureAt, 6);

    const error = await rejectionOf(
      createBooking(config, input({ ...edgeWindow, scope: "international" })),
    );
    expect(error).toBeInstanceOf(SlotNotSellableError);
    expect((error as SlotNotSellableError).reason).toBe("misses_bag_drop_cutoff");

    await expect(createBooking(config, input(edgeWindow))).resolves.toBeDefined();
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
      DELETE FROM payments;
      DELETE FROM bags;
      DELETE FROM bookings;
      DELETE FROM slots;
      DELETE FROM slot_blocks;
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

    // A plain windowed booking — windows are virtual, no slot row involved.
    const departureAt = new Date(alignToHour(new Date()).getTime() + 72 * HOUR);
    const { pickupWindowStart, pickupWindowEnd } = windowFor(departureAt);
    const [booking] = await db
      .insert(bookings)
      .values({
        userId: user!.id,
        flightNumber: "DL1",
        airlineIata: "DL",
        departureAirport: "JFK",
        departureAt,
        paxName: "Test",
        pickupAddressId: address!.id,
        bagCount: 1,
        pickupWindowStart,
        pickupWindowEnd,
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
