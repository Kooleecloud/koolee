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
import type { AdminSession, AgentSession, CustomerSession } from "../auth/types";
import { avatarPathForViewer, canReplaceAvatarOf } from "./avatar-visibility";
import { setUserAvatar } from "./avatars";
import { createBooking } from "./create-booking";
import { ensureAddress } from "./customers";

/**
 * WHOSE FACE MAY THIS PERSON SEE?
 *
 * A signed URL is a bearer credential for a private object, so issuing one is
 * an authorization decision. Before `avatar-visibility.ts` that decision was
 * made by construction — the path only reached a render because a join had
 * already proved the relationship — and guarded by a comment saying "never
 * call this with a path that arrived from a request".
 *
 * These are the cases that comment was standing in for.
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIntegration = TEST_DATABASE_URL ? describe : describe.skip;

if (!TEST_DATABASE_URL) {
  console.log("[integration] TEST_DATABASE_URL not set — skipping avatar visibility.");
}

const migrationsFolder = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../db/drizzle",
);

const HOUR = 3_600_000;

describeIntegration("avatar visibility (integration)", () => {
  let sqlClient: ReturnType<typeof postgres>;
  let db: Database;
  let config: CoreConfig;

  let customerId: string;
  let otherCustomerId: string;
  let agentId: string;
  let strangerAgentId: string;
  let adminId: string;

  const now = new Date("2026-06-10T10:00:00Z");
  const departureAt = new Date("2026-06-12T22:00:00Z");

  const customer = (): CustomerSession => ({
    kind: "customer",
    userId: customerId,
    role: "customer",
    phone: "+15551210001",
  });
  const otherCustomer = (): CustomerSession => ({
    kind: "customer",
    userId: otherCustomerId,
    role: "customer",
    phone: "+15551210002",
  });
  const agent = (id: string): AgentSession => ({
    kind: "agent",
    userId: id,
    role: "agent",
  });
  const admin = (): AdminSession => ({
    kind: "admin",
    userId: adminId,
    role: "admin",
  });

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
      DELETE FROM bags;
      DELETE FROM bookings;
      DELETE FROM staff_members;
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

    const inserted = await db
      .insert(users)
      .values([
        { phone: "+15551210001", role: "customer" },
        { phone: "+15551210002", role: "customer" },
        { email: "agent@koolee.test", role: "agent", fullName: "Nina Petrov" },
        { email: "stranger@koolee.test", role: "agent", fullName: "Sam Stranger" },
        { email: "admin@koolee.test", role: "admin", fullName: "Ada Ops" },
      ])
      .returning();
    [customerId, otherCustomerId, agentId, strangerAgentId, adminId] = inserted.map(
      (row) => row.id,
    ) as [string, string, string, string, string];

    await db.insert(staffMembers).values([
      { userId: agentId, role: "agent", active: true, canDrive: true },
      { userId: strangerAgentId, role: "agent", active: true, canDrive: true },
      { userId: adminId, role: "admin", active: true },
    ]);

    // Everybody has a face, so an absent result is always about permission
    // rather than about a missing photo.
    for (const id of [customerId, otherCustomerId, agentId, strangerAgentId, adminId]) {
      await setUserAvatar(db, { userId: id, storagePath: `${id}/face.jpg` });
    }
  });

  async function assignedBooking(): Promise<Booking> {
    const end = new Date(Math.floor((departureAt.getTime() - 20 * HOUR) / HOUR) * HOUR);
    const address = await ensureAddress(db, customerId, {
      line1: "1 Face St",
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
      flightNumber: "DL123",
      airlineIata: "DL",
      departureAirport: "JFK",
      departureAt,
      scope: "domestic",
      paxName: "Face Customer",
      bagCount: 1,
      distanceKm: 20,
    });
    await db
      .insert(verificationTasks)
      .values({ bookingId: booking.id, assigneeUserId: agentId, status: "assigned" });
    await db
      .insert(pickupTasks)
      .values({ bookingId: booking.id, assigneeUserId: agentId, status: "assigned" });
    return booking;
  }

  /* ---------------------------------------------------------------- */
  /* Yourself                                                          */
  /* ---------------------------------------------------------------- */

  it("always lets somebody see their own face, with no booking at all", async () => {
    expect(
      await avatarPathForViewer(db, { viewer: customer(), subjectUserId: customerId }),
    ).toBe(`${customerId}/face.jpg`);
  });

  /* ---------------------------------------------------------------- */
  /* The customer's side                                               */
  /* ---------------------------------------------------------------- */

  it("shows the customer the agent assigned to their own booking", async () => {
    const booking = await assignedBooking();
    expect(
      await avatarPathForViewer(db, {
        viewer: customer(),
        subjectUserId: agentId,
        bookingId: booking.id,
      }),
    ).toBe(`${agentId}/face.jpg`);
  });

  it("refuses a customer an agent who is not on their booking", async () => {
    const booking = await assignedBooking();
    expect(
      await avatarPathForViewer(db, {
        viewer: customer(),
        subjectUserId: strangerAgentId,
        bookingId: booking.id,
      }),
    ).toBeNull();
  });

  it("refuses a customer somebody else's booking, even naming the right agent", async () => {
    // The booking is real and the agent IS on it — but not for this viewer.
    const booking = await assignedBooking();
    expect(
      await avatarPathForViewer(db, {
        viewer: otherCustomer(),
        subjectUserId: agentId,
        bookingId: booking.id,
      }),
    ).toBeNull();
  });

  it("refuses a customer any face at all with no booking named", async () => {
    await assignedBooking();
    expect(
      await avatarPathForViewer(db, { viewer: customer(), subjectUserId: agentId }),
    ).toBeNull();
  });

  it("shows nobody before anybody is assigned", async () => {
    // Same booking, no tasks. There is no relationship yet, so there is
    // nothing to see — which is also why the shortlist has its own path.
    const end = new Date(Math.floor((departureAt.getTime() - 20 * HOUR) / HOUR) * HOUR);
    const address = await ensureAddress(db, customerId, {
      line1: "2 Face St",
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
      flightNumber: "DL456",
      airlineIata: "DL",
      departureAirport: "JFK",
      departureAt,
      scope: "domestic",
      paxName: "Face Customer",
      bagCount: 1,
      distanceKm: 20,
    });

    expect(
      await avatarPathForViewer(db, {
        viewer: customer(),
        subjectUserId: agentId,
        bookingId: booking.id,
      }),
    ).toBeNull();
  });

  /* ---------------------------------------------------------------- */
  /* The staff side                                                    */
  /* ---------------------------------------------------------------- */

  it("shows the assigned agent the customer whose door they are going to", async () => {
    const booking = await assignedBooking();
    expect(
      await avatarPathForViewer(db, {
        viewer: agent(agentId),
        subjectUserId: customerId,
        bookingId: booking.id,
      }),
    ).toBe(`${customerId}/face.jpg`);
  });

  it("refuses an UNASSIGNED agent the customer's face", async () => {
    // The headline case: staff are not a role with broad read access, they
    // are people with tasks. Same rule as `getAssignedTask`.
    const booking = await assignedBooking();
    expect(
      await avatarPathForViewer(db, {
        viewer: agent(strangerAgentId),
        subjectUserId: customerId,
        bookingId: booking.id,
      }),
    ).toBeNull();
  });

  it("refuses an agent a customer they have no booking with", async () => {
    await assignedBooking();
    expect(
      await avatarPathForViewer(db, {
        viewer: agent(agentId),
        subjectUserId: otherCustomerId,
      }),
    ).toBeNull();
  });

  /* ---------------------------------------------------------------- */
  /* Admin                                                             */
  /* ---------------------------------------------------------------- */

  it("shows an admin anyone, with or without a booking", async () => {
    const booking = await assignedBooking();
    for (const subject of [customerId, agentId, strangerAgentId]) {
      expect(
        await avatarPathForViewer(db, { viewer: admin(), subjectUserId: subject }),
      ).toBe(`${subject}/face.jpg`);
    }
    expect(
      await avatarPathForViewer(db, {
        viewer: admin(),
        subjectUserId: customerId,
        bookingId: booking.id,
      }),
    ).toBe(`${customerId}/face.jpg`);
  });

  /* ---------------------------------------------------------------- */
  /* Replacement                                                       */
  /* ---------------------------------------------------------------- */

  it("lets an admin replace a staff photo", async () => {
    expect(await canReplaceAvatarOf(db, admin(), agentId)).toBe(true);
  });

  it("refuses an admin a CUSTOMER's photo — that is moderation, not ops", async () => {
    expect(await canReplaceAvatarOf(db, admin(), customerId)).toBe(false);
  });

  it("refuses an admin a DEACTIVATED staff member", async () => {
    await sqlClient.unsafe(
      `UPDATE staff_members SET active = false WHERE user_id = '${strangerAgentId}'`,
    );
    expect(await canReplaceAvatarOf(db, admin(), strangerAgentId)).toBe(false);
  });

  it("refuses an agent anybody else's photo, including another agent's", async () => {
    expect(await canReplaceAvatarOf(db, agent(agentId), strangerAgentId)).toBe(false);
    expect(await canReplaceAvatarOf(db, agent(agentId), customerId)).toBe(false);
  });

  it("lets anybody replace their own", async () => {
    expect(await canReplaceAvatarOf(db, admin(), adminId)).toBe(true);
  });
});
