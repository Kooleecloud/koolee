import { fileURLToPath } from "node:url";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addresses,
  airports,
  bookingDrafts,
  bookings,
  createDb,
  users,
  type Database,
} from "@koolee/db";
import { TEST_AIRPORTS } from "../test-utils/airport-fixtures";

import { cleanupAnonymousUsers } from "./cleanup-anonymous-users";
import { generateBookingRef } from "../booking/ref";
import { pickupSnapshotOf } from "../test-utils/booking-fixtures";

/**
 * Integration tests for the anonymous-user GC against a real Postgres.
 *
 * OPT-IN, same convention as create-booking.integration.test.ts: without
 * `TEST_DATABASE_URL` the suite skips and `pnpm test` stays green. Point it
 * at a THROWAWAY database — it migrates and deletes rows.
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIntegration = TEST_DATABASE_URL ? describe : describe.skip;

const migrationsFolder = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../db/drizzle",
);

const DAY_MS = 24 * 3600_000;

describeIntegration("cleanupAnonymousUsers (integration)", () => {
  let sqlClient: ReturnType<typeof postgres>;
  let db: Database;

  const now = new Date("2026-08-01T04:00:00Z");
  const daysAgo = (days: number) => new Date(now.getTime() - days * DAY_MS);

  beforeAll(async () => {
    sqlClient = postgres(TEST_DATABASE_URL!, { max: 1, prepare: false });
    await migrate(drizzle(sqlClient), { migrationsFolder });
    db = createDb({ url: TEST_DATABASE_URL!, max: 5 });
  });

  afterAll(async () => {
    await sqlClient.end();
  });

  beforeEach(async () => {
    await sqlClient.unsafe(`
      SET session_replication_role = replica;
      DELETE FROM custody_events;
      DELETE FROM payments;
      DELETE FROM bags;
      DELETE FROM bookings;
      DELETE FROM booking_drafts;
      DELETE FROM slot_blocks;
      DELETE FROM slots;
      DELETE FROM airline_cutoffs;
      DELETE FROM pricing_rules;
      DELETE FROM addresses;
      DELETE FROM users;
      DELETE FROM airports;
      SET session_replication_role = DEFAULT;
    `);
  });

  async function insertAnon(lastSeenDaysAgo: number): Promise<string> {
    const id = randomUUID();
    await db.insert(users).values({
      id,
      phone: null,
      isAnonymous: true,
      lastSeenAt: daysAgo(lastSeenDaysAgo),
    });
    return id;
  }

  it("deletes an 8-day-old anonymous user and their draft, and calls the auth deleter", async () => {
    const staleId = await insertAnon(8);
    await db.insert(bookingDrafts).values({
      userId: staleId,
      payload: { zip: "10001", flightNumber: "UA1189" },
    });

    const deleteAuthUser = vi.fn(async () => {});
    const result = await cleanupAnonymousUsers(db, {
      now,
      deleteAuthUser,
      log: () => {},
    });

    expect(result.deletedUsers).toBe(1);
    expect(result.deletedDrafts).toBe(1);
    expect(result.skippedWithBookings).toBe(0);
    expect(deleteAuthUser).toHaveBeenCalledWith(staleId);
    expect(
      await db.query.users.findFirst({ where: eq(users.id, staleId) }),
    ).toBeUndefined();
    expect(
      await db.query.bookingDrafts.findFirst({
        where: eq(bookingDrafts.userId, staleId),
      }),
    ).toBeUndefined();
  });

  it("leaves fresh anonymous users and verified users alone", async () => {
    const freshAnon = await insertAnon(2);
    const verifiedId = randomUUID();
    await db.insert(users).values({
      id: verifiedId,
      phone: "+13322602829",
      isAnonymous: false,
      phoneVerifiedAt: daysAgo(30),
      lastSeenAt: daysAgo(30),
    });

    const result = await cleanupAnonymousUsers(db, { now, log: () => {} });

    expect(result.deletedUsers).toBe(0);
    expect(
      await db.query.users.findFirst({ where: eq(users.id, freshAnon) }),
    ).toBeDefined();
    expect(
      await db.query.users.findFirst({ where: eq(users.id, verifiedId) }),
    ).toBeDefined();
  });

  it("refuses to touch a stale anonymous user who somehow owns a booking", async () => {
    const staleWithBooking = await insertAnon(30);

    await db.insert(airports).values(TEST_AIRPORTS.JFK);
    const [address] = await db
      .insert(addresses)
      .values({
        userId: staleWithBooking,
        line1: "1 Main St",
        city: "New York",
        state: "NY",
        zip: "10001",
      })
      .returning();
    await db.insert(bookings).values({
      ref: generateBookingRef(),
      userId: staleWithBooking,
      status: "draft",
      displayTz: "America/New_York",
      flightNumber: "UA1189",
      airlineIata: "UA",
      departureAirport: "JFK",
      departureAt: daysAgo(-5),
      paxName: "Jordan Alvarez",
      ...pickupSnapshotOf(address!),
      bagCount: 2,
      priceCents: 9900,
    });

    const deleteAuthUser = vi.fn(async () => {});
    const result = await cleanupAnonymousUsers(db, {
      now,
      deleteAuthUser,
      log: () => {},
    });

    expect(result.deletedUsers).toBe(0);
    expect(result.skippedWithBookings).toBe(1);
    expect(deleteAuthUser).not.toHaveBeenCalled();
    expect(
      await db.query.users.findFirst({ where: eq(users.id, staleWithBooking) }),
    ).toBeDefined();
  });

  it("counts auth-delete failures without aborting the run", async () => {
    await insertAnon(10);
    await insertAnon(11);

    const deleteAuthUser = vi
      .fn(async () => {})
      .mockRejectedValueOnce(new Error("gotrue 500"));
    const result = await cleanupAnonymousUsers(db, {
      now,
      deleteAuthUser,
      log: () => {},
    });

    expect(result.deletedUsers).toBe(2);
    expect(result.authDeleteFailures).toBe(1);
  });
});
