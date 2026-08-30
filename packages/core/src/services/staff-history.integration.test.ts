import { fileURLToPath } from "node:url";
import path from "node:path";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  airlineCutoffs,
  airports,
  createDb,
  pickupTasks,
  pricingRules,
  staffMembers,
  users,
  verificationTasks,
  type Booking,
  type Database,
} from "@koolee/db";

import { createCoreConfig, fixedClock, type CoreConfig } from "../config";
import { FakePaymentProvider } from "../payments/fake";
import { TEST_AIRPORTS } from "../test-utils/airport-fixtures";
import { createBooking } from "./create-booking";
import { ensureAddress } from "./customers";
import { getStaffWorkHistory, staffHistoryRange } from "./staff-history";

/**
 * What one person did, derived rather than bookkept.
 *
 * The two claims worth a database: the range reads the instant the work
 * ACTUALLY HAPPENED (completion, falling back to the schedule) rather than
 * when it was assigned — a task handed out in May and run in June belongs to
 * June — and one person's history never contains another person's work.
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIntegration = TEST_DATABASE_URL ? describe : describe.skip;

if (!TEST_DATABASE_URL) {
  console.log("[integration] TEST_DATABASE_URL not set — skipping staff history.");
}

const migrationsFolder = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../db/drizzle",
);

const HOUR = 3_600_000;

describeIntegration("staff work history (integration)", () => {
  let sqlClient: ReturnType<typeof postgres>;
  let db: Database;
  let config: CoreConfig;
  let customerId: string;
  let ninaId: string;
  let samId: string;

  const now = new Date("2026-06-10T10:00:00Z");
  const departureAt = new Date("2026-06-12T22:00:00Z");

  beforeAll(async () => {
    sqlClient = postgres(TEST_DATABASE_URL!, { max: 1, prepare: false });
    await migrate(drizzle(sqlClient), { migrationsFolder });
    db = createDb({ url: TEST_DATABASE_URL!, max: 5 });
    config = createCoreConfig({
      db,
      payments: new FakePaymentProvider(),
      clock: fixedClock(now),
    });
  });

  afterAll(async () => {
    await sqlClient?.end();
  });

  beforeEach(async () => {
    await sqlClient.unsafe(`
      SET session_replication_role = replica;
      DELETE FROM booking_signals;
      DELETE FROM custody_events;
      DELETE FROM payments;
      DELETE FROM verification_tasks;
      DELETE FROM pickup_tasks;
      DELETE FROM staff_members;
      DELETE FROM bags;
      DELETE FROM bookings;
      DELETE FROM airline_cutoffs;
      DELETE FROM pricing_rules;
      DELETE FROM addresses;
      DELETE FROM users;
      DELETE FROM airports;
      SET session_replication_role = DEFAULT;
    `);

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

    const rows = await db
      .insert(users)
      .values([
        { phone: "+15551230001", role: "customer" },
        { email: "nina@koolee.test", role: "agent", fullName: "Nina Petrov" },
        { email: "sam@koolee.test", role: "agent", fullName: "Sam Stone" },
      ])
      .returning();
    [customerId, ninaId, samId] = rows.map((r) => r.id) as [string, string, string];

    await db.insert(staffMembers).values([
      { userId: ninaId, role: "agent", active: true, canDrive: true },
      { userId: samId, role: "agent", active: true, canDrive: true },
    ]);
  });

  async function aBooking(flightNumber: string): Promise<Booking> {
    const end = new Date(Math.floor((departureAt.getTime() - 20 * HOUR) / HOUR) * HOUR);
    const address = await ensureAddress(db, customerId, {
      line1: `${flightNumber} Work St`,
      city: "New York",
      state: "NY",
      zip: "10001",
    });
    const { booking } = await createBooking(config, {
      userId: customerId,
      pickupAddressId: address.id,
      quotedZip: address.zip,
      pickupWindowStart: new Date(end.getTime() - HOUR),
      pickupWindowEnd: end,
      flightNumber,
      airlineIata: "DL",
      departureAirport: "JFK",
      departureAt,
      scope: "domestic",
      paxName: "Work Customer",
      bagCount: 1,
      distanceKm: 20,
    });
    return booking;
  }

  it("counts finished verifications and pickups separately", async () => {
    // One person can do both halves of one booking, and they are two pieces
    // of work at two times — collapsing them would make "how many pickups did
    // Nina run" unanswerable.
    const booking = await aBooking("DL100");
    await db.insert(verificationTasks).values({
      bookingId: booking.id,
      assigneeUserId: ninaId,
      status: "done",
      completedAt: new Date("2026-06-11T12:00:00Z"),
    });
    await db.insert(pickupTasks).values({
      bookingId: booking.id,
      assigneeUserId: ninaId,
      status: "done",
      completedAt: new Date("2026-06-11T15:00:00Z"),
    });

    const history = await getStaffWorkHistory(db, { staffUserId: ninaId });
    expect(history.counts.verificationsDone).toBe(1);
    expect(history.counts.pickupsDone).toBe(1);
    expect(history.rows).toHaveLength(2);
    // Most recent first: the pickup ran after the visit.
    expect(history.rows[0]!.kind).toBe("pickup");
  });

  it("separates open and failed from done", async () => {
    const a = await aBooking("DL200");
    const b = await aBooking("DL300");
    await db.insert(verificationTasks).values([
      { bookingId: a.id, assigneeUserId: ninaId, status: "assigned" },
      {
        bookingId: b.id,
        assigneeUserId: ninaId,
        status: "failed",
        completedAt: new Date("2026-06-11T09:00:00Z"),
      },
    ]);

    const history = await getStaffWorkHistory(db, { staffUserId: ninaId });
    expect(history.counts.verificationsDone).toBe(0);
    expect(history.counts.open).toBe(1);
    expect(history.counts.failed).toBe(1);
  });

  it("never returns another person's work", async () => {
    const booking = await aBooking("DL400");
    await db.insert(verificationTasks).values({
      bookingId: booking.id,
      assigneeUserId: samId,
      status: "done",
      completedAt: new Date("2026-06-11T12:00:00Z"),
    });

    expect((await getStaffWorkHistory(db, { staffUserId: ninaId })).rows).toHaveLength(0);
    expect((await getStaffWorkHistory(db, { staffUserId: samId })).rows).toHaveLength(1);
  });

  it("ranges on when the work HAPPENED, not on when it was assigned", async () => {
    // The distinction that makes this a work history rather than a dispatch
    // log: a task created today and completed next month belongs to next
    // month.
    const booking = await aBooking("DL500");
    await db.insert(verificationTasks).values({
      bookingId: booking.id,
      assigneeUserId: ninaId,
      status: "done",
      scheduledStart: new Date("2026-06-01T12:00:00Z"),
      completedAt: new Date("2026-07-15T12:00:00Z"),
    });

    const june = await getStaffWorkHistory(db, {
      staffUserId: ninaId,
      ...staffHistoryRange("2026-06-01", "2026-06-30"),
    });
    const july = await getStaffWorkHistory(db, {
      staffUserId: ninaId,
      ...staffHistoryRange("2026-07-01", "2026-07-31"),
    });

    expect(june.rows).toHaveLength(0);
    expect(july.rows).toHaveLength(1);
  });

  it("falls back to the schedule for work that has not finished", async () => {
    const booking = await aBooking("DL600");
    await db.insert(pickupTasks).values({
      bookingId: booking.id,
      assigneeUserId: ninaId,
      status: "assigned",
      scheduledStart: new Date("2026-06-20T12:00:00Z"),
    });

    const inRange = await getStaffWorkHistory(db, {
      staffUserId: ninaId,
      ...staffHistoryRange("2026-06-15", "2026-06-25"),
    });
    expect(inRange.rows).toHaveLength(1);
    expect(inRange.rows[0]!.at?.toISOString()).toBe("2026-06-20T12:00:00.000Z");
  });

  it("carries the booking so every row can link to it", async () => {
    const booking = await aBooking("DL700");
    await db.insert(verificationTasks).values({
      bookingId: booking.id,
      assigneeUserId: ninaId,
      status: "done",
      completedAt: new Date("2026-06-11T12:00:00Z"),
    });

    const [row] = (await getStaffWorkHistory(db, { staffUserId: ninaId })).rows;
    expect(row!.bookingId).toBe(booking.id);
    expect(row!.bookingRef).toBe(booking.ref);
    expect(row!.departureAirport).toBe("JFK");
    expect(row!.tz).toBe(TEST_AIRPORTS.JFK.tz);
  });

  it("returns empty rather than throwing for somebody with no work", async () => {
    expect(await getStaffWorkHistory(db, { staffUserId: ninaId })).toEqual({
      counts: { verificationsDone: 0, pickupsDone: 0, open: 0, failed: 0 },
      rows: [],
    });
  });
});

describe("staffHistoryRange", () => {
  it("reads a date box as a whole UTC day, inclusive at both ends", () => {
    const range = staffHistoryRange("2026-06-01", "2026-06-30");
    expect(range.from?.toISOString()).toBe("2026-06-01T00:00:00.000Z");
    expect(range.to?.toISOString()).toBe("2026-06-30T23:59:59.999Z");
  });

  it("ignores anything that is not a plain date", () => {
    // The values come from a query string, so they are whatever somebody
    // typed. A malformed bound must widen the range, never narrow it to
    // nothing or throw a page away.
    expect(staffHistoryRange("yesterday", undefined)).toEqual({});
    expect(staffHistoryRange("2026-13-45", "")).toEqual({});
  });
});
