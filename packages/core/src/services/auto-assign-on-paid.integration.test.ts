import { fileURLToPath } from "node:url";
import path from "node:path";

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  agentZones,
  airlineCutoffs,
  airports,
  bookings,
  createDb,
  custodyEvents,
  pickupTasks,
  pricingRules,
  staffMembers,
  users,
  verificationTasks,
  type Database,
} from "@koolee/db";

import { createCoreConfig, fixedClock, type CoreConfig } from "../config";
import { FakePaymentProvider } from "../payments/fake";
import { autoAssignOnPaid } from "./auto-assign";
import { ensureAddress } from "./customers";
import {
  ensureBookingPaymentIntent,
  reconcileBookingPayment,
  type EnsurePaymentIntentInput,
} from "./payment-intent";
import { handlePaymentEvent } from "./webhooks";

/**
 * Phase 2 acceptance — the on-paid auto-assign trigger under the race it was
 * built for. The Stripe webhook and the /book/return re-check both advance a
 * booking to `paid` and both fire dispatch; the 0019 unique indexes are what
 * turn the loser's insert into a clean "already assigned". Only a real
 * database can prove that.
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIntegration = TEST_DATABASE_URL ? describe : describe.skip;

if (!TEST_DATABASE_URL) {
  console.log(
    "[integration] TEST_DATABASE_URL not set — skipping on-paid auto-assign tests.",
  );
}

const migrationsFolder = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../db/drizzle",
);

const HOUR = 3_600_000;

/** A valid clock-aligned one-hour pickup window ending `leadHours` before departure. */
function windowFor(departureAt: Date, leadHours = 20) {
  const end = new Date(
    Math.floor((departureAt.getTime() - leadHours * HOUR) / HOUR) * HOUR,
  );
  return { pickupWindowStart: new Date(end.getTime() - HOUR), pickupWindowEnd: end };
}

describeIntegration("on-paid auto-assign (integration)", () => {
  let sqlClient: ReturnType<typeof postgres>;
  let db: Database;
  let provider: FakePaymentProvider;
  let config: CoreConfig;

  const now = new Date("2025-06-10T10:00:00Z");
  const departureAt = new Date("2025-06-12T22:00:00Z");
  const window = windowFor(departureAt);
  let userId: string;
  let agentId: string;
  let addressId: string;

  beforeAll(async () => {
    sqlClient = postgres(TEST_DATABASE_URL!, { max: 1, prepare: false });
    await migrate(drizzle(sqlClient), { migrationsFolder });
    db = createDb({ url: TEST_DATABASE_URL!, max: 8 });
  });

  afterAll(async () => {
    await sqlClient?.end();
  });

  beforeEach(async () => {
    provider = new FakePaymentProvider({ requiresClientConfirmation: true });
    config = createCoreConfig({
      db,
      payments: provider,
      clock: fixedClock(now),
    });

    await sqlClient.unsafe(`
      SET session_replication_role = replica;
      DELETE FROM custody_events;
      DELETE FROM payment_webhook_events;
      DELETE FROM payments;
      DELETE FROM verification_tasks;
      DELETE FROM pickup_tasks;
      DELETE FROM bags;
      DELETE FROM bookings;
      DELETE FROM ticket_uploads;
      DELETE FROM agent_zones;
      DELETE FROM staff_members;
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
    await db.insert(pricingRules).values({
      name: "test",
      baseFeeCents: 2900,
      perBagCents: 1500,
      distanceMultiplier: "45.0000",
      leadTimeMultipliers: [],
      discountRules: [],
      active: true,
    });

    const [customer] = await db
      .insert(users)
      .values({ phone: "+15551140001", role: "customer" })
      .returning();
    userId = customer!.id;

    const [agent] = await db
      .insert(users)
      .values({ email: "onpaid.agent@koolee-test.example", role: "agent" })
      .returning();
    agentId = agent!.id;
    await db.insert(staffMembers).values({ userId: agentId, role: "agent", active: true });
    await db.insert(agentZones).values({ agentUserId: agentId, zip: "10001" });

    const address = await ensureAddress(db, userId, {
      line1: "1 Test St",
      city: "New York",
      state: "NY",
      zip: "10001",
    });
    addressId = address.id;
  });

  function baseInput(
    overrides: Partial<EnsurePaymentIntentInput> = {},
  ): EnsurePaymentIntentInput {
    return {
      userId,
      pickupAddressId: addressId,
      ...window,
      flightNumber: "DL123",
      airlineIata: "DL",
      departureAirport: "JFK",
      departureAt,
      scope: "domestic",
      paxName: "Test Customer",
      bagCount: 1,
      distanceKm: 20,
      contactPhone: null,
      ...overrides,
    };
  }

  /** Draft booking + pending intent, funds not yet confirmed. */
  async function draftIntent() {
    const intent = await ensureBookingPaymentIntent(config, baseInput());
    if (intent.kind !== "ready") throw new Error(`expected ready intent, got ${intent.kind}`);
    return intent;
  }

  async function assignmentState(bookingId: string) {
    const [booking, vTasks, pTasks, events] = await Promise.all([
      db.query.bookings.findFirst({ where: eq(bookings.id, bookingId) }),
      db.select().from(verificationTasks).where(eq(verificationTasks.bookingId, bookingId)),
      db.select().from(pickupTasks).where(eq(pickupTasks.bookingId, bookingId)),
      db.select().from(custodyEvents).where(eq(custodyEvents.bookingId, bookingId)),
    ]);
    return {
      booking,
      vTasks,
      pTasks,
      assignEvents: events.filter((e) => e.eventType === "booking.agent_assigned"),
    };
  }

  it("two concurrent transitions to paid produce exactly one task pair and one assignment", async () => {
    const intent = await draftIntent();
    provider.simulateClientConfirmation(intent.providerRef, "success");
    const { payload, signature } = provider.simulateWebhook({
      type: "payment.authorized",
      providerRef: intent.providerRef,
    });

    // The production race, verbatim: webhook delivery and return-page re-check.
    const [webhook, recheck] = await Promise.all([
      handlePaymentEvent(config, provider.verifyWebhook(payload, signature)),
      reconcileBookingPayment(config, { bookingId: intent.bookingId, userId }),
    ]);
    expect(webhook.handled).toBe(true);
    expect(recheck.outcome).toBe("authorized");

    const state = await assignmentState(intent.bookingId);
    expect(state.booking?.status).toBe("agent_assigned");
    expect(state.vTasks).toHaveLength(1);
    expect(state.pTasks).toHaveLength(1);
    expect(state.vTasks[0]).toMatchObject({ assigneeUserId: agentId, status: "assigned" });
    expect(state.pTasks[0]).toMatchObject({ assigneeUserId: agentId, status: "assigned" });
    expect(state.assignEvents).toHaveLength(1);
  });

  it("a concurrent burst of on-paid hooks assigns exactly once, stamped by the system actor", async () => {
    // Reach paid UNASSIGNED first (no coverage), then hand the agent the zone
    // and fire the hook from several "paths" at once.
    await db.delete(agentZones);
    const intent = await draftIntent();
    provider.simulateClientConfirmation(intent.providerRef, "success");
    const recheck = await reconcileBookingPayment(config, {
      bookingId: intent.bookingId,
      userId,
    });
    expect(recheck.outcome).toBe("authorized");
    expect((await assignmentState(intent.bookingId)).booking?.status).toBe("paid");

    await db.insert(agentZones).values({ agentUserId: agentId, zip: "10001" });
    await Promise.all(
      Array.from({ length: 4 }, () => autoAssignOnPaid(config, intent.bookingId)),
    );

    const state = await assignmentState(intent.bookingId);
    expect(state.booking?.status).toBe("agent_assigned");
    expect(state.vTasks).toHaveLength(1);
    expect(state.pTasks).toHaveLength(1);
    expect(state.assignEvents).toHaveLength(1);
    // System actor: an automatic assignment records no human (matches
    // captureDueBookings' convention).
    expect(state.assignEvents[0]?.actorUserId).toBeNull();
  });

  it("no covering agent never fails the payment path — booking stays paid-unassigned", async () => {
    await db.delete(agentZones);
    const intent = await draftIntent();
    provider.simulateClientConfirmation(intent.providerRef, "success");
    const { payload, signature } = provider.simulateWebhook({
      type: "payment.authorized",
      providerRef: intent.providerRef,
    });

    const outcome = await handlePaymentEvent(
      config,
      provider.verifyWebhook(payload, signature),
    );
    expect(outcome.handled).toBe(true);

    const state = await assignmentState(intent.bookingId);
    expect(state.booking?.status).toBe("paid");
    expect(state.vTasks).toHaveLength(0);
    expect(state.pTasks).toHaveLength(0);
    // The board's at-risk flag covers this booking from here.
  });
});
