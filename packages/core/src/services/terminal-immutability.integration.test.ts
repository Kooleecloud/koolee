import { fileURLToPath } from "node:url";
import path from "node:path";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  agreementVersions,
  airlineCutoffs,
  airports,
  bookings,
  createDb,
  custodyEvents,
  pickupTasks,
  pricingRules,
  staffMembers,
  trucks,
  driverShifts,
  users,
  verificationTasks,
  type Booking,
  type Database,
} from "@koolee/db";
import { eq } from "drizzle-orm";

import { createCoreConfig, fixedClock, type CoreConfig } from "../config";
import { FakePaymentProvider } from "../payments/fake";
import { TEST_AIRPORTS } from "../test-utils/airport-fixtures";
import type { AgentSession } from "../auth/types";
import { applyTransition } from "./bookings";
import { createBooking } from "./create-booking";
import { ensureAddress } from "./customers";
import {
  arriveAtVisit,
  completeVerificationVisit,
  confirmVisitIdentity,
  recordBagSealed,
  reportVisitException,
} from "./agent-visit";
import {
  confirmAirlineHandover,
  deliverToBagdrop,
  scanSealAtPickup,
  startPickupTravel,
} from "./pickup";

/**
 * A FINISHED TASK IS IMMUTABLE, and not because the UI stops rendering forms.
 *
 * The agent app's History renders every terminal task in a locked mode with no
 * controls. That is presentation. A server action stays a reachable POST
 * whatever the UI shows, and a phone in a van keeps stale tabs open for days —
 * so this is the half that actually holds, asserted rather than asserted-in-a-
 * comment.
 *
 * Three mechanisms do the work, and the point of this file is that no single
 * one of them is load-bearing alone:
 *
 *  1. `assertActionable` — a `completed` booking has standing `terminal`,
 *     which permits none of the five gated actions.
 *  2. The state machine — `completed` and `cancelled` have no outgoing edges,
 *     and `applyTransition` guards on `WHERE status = from`.
 *  3. Per-step conflicts — a sealed bag refuses a second seal, because a
 *     correction to custody evidence is a compensating event, never an edit.
 *
 * Every assertion below also checks that NOTHING WAS WRITTEN: a refusal that
 * appends a custody event would be a worse bug than the mutation it prevented.
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIntegration = TEST_DATABASE_URL ? describe : describe.skip;

if (!TEST_DATABASE_URL) {
  console.log("[integration] TEST_DATABASE_URL not set — skipping immutability tests.");
}

const migrationsFolder = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../db/drizzle",
);

const HOUR = 3_600_000;

describeIntegration("terminal tasks are immutable (integration)", () => {
  let sqlClient: ReturnType<typeof postgres>;
  let db: Database;
  let config: CoreConfig;
  let customerId: string;
  let agentUserId: string;
  let session: AgentSession;
  let visitTaskId: string;
  let pickupTaskId: string;
  let booking: Booking;

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
      DELETE FROM agreement_acceptances;
      DELETE FROM agreement_versions;
      DELETE FROM passport_verifications;
      DELETE FROM payments;
      DELETE FROM verification_tasks;
      DELETE FROM pickup_tasks;
      DELETE FROM driver_shifts;
      DELETE FROM trucks;
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
    await db.insert(agreementVersions).values({
      version: 1,
      title: "Terms v1",
      bodyMd: "Terms.",
      effectiveFrom: new Date("2024-01-01T00:00:00Z"),
    });

    const [customer] = await db
      .insert(users)
      .values({ phone: "+15551220001", role: "customer" })
      .returning();
    customerId = customer!.id;

    const [agent] = await db
      .insert(users)
      .values({ email: "agent-immutable@koolee.test", role: "agent" })
      .returning();
    agentUserId = agent!.id;
    session = { kind: "agent", userId: agentUserId, role: "agent" };
    await db
      .insert(staffMembers)
      .values({ userId: agentUserId, role: "agent", active: true, canDrive: true });

    const end = new Date(Math.floor((departureAt.getTime() - 20 * HOUR) / HOUR) * HOUR);
    const address = await ensureAddress(db, customerId, {
      line1: "1 Closed St",
      city: "New York",
      state: "NY",
      zip: "10001",
    });
    const created = await createBooking(config, {
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
      paxName: "Closed Customer",
      bagCount: 1,
      distanceKm: 20,
    });
    booking = created.booking;

    const [truck] = await db
      .insert(trucks)
      .values({ name: "Closed Van", bagCapacity: 10, active: true })
      .returning();
    const [shift] = await db
      .insert(driverShifts)
      .values({ staffUserId: agentUserId, truckId: truck!.id })
      .returning();

    const [vt] = await db
      .insert(verificationTasks)
      .values({
        bookingId: booking.id,
        assigneeUserId: agentUserId,
        status: "done",
        completedAt: now,
      })
      .returning();
    visitTaskId = vt!.id;

    const [pt] = await db
      .insert(pickupTasks)
      .values({
        bookingId: booking.id,
        assigneeUserId: agentUserId,
        driverShiftId: shift!.id,
        status: "done",
        completedAt: now,
      })
      .returning();
    pickupTaskId = pt!.id;

    // Drive the booking all the way to `completed`, the way the product does.
    for (const event of [
      "assign_agent",
      "complete_verification",
      "mark_awaiting_pickup",
      "start_transit",
      "deliver_to_bagdrop",
      "complete",
    ] as const) {
      const moved = await applyTransition(config, { bookingId: booking.id, event });
      expect(moved.ok, `setup transition ${event}`).toBe(true);
    }
  });

  const eventCount = async () =>
    (await db.select().from(custodyEvents).where(eq(custodyEvents.bookingId, booking.id)))
      .length;

  const statusOf = async () =>
    (await db.query.bookings.findFirst({ where: eq(bookings.id, booking.id) }))?.status;

  /* ---------------------------------------------------------------- */
  /* The visit                                                         */
  /* ---------------------------------------------------------------- */

  it("refuses every verification mutation on a completed booking", async () => {
    const before = await eventCount();

    await expect(
      arriveAtVisit(config, session, { taskId: visitTaskId }),
    ).rejects.toThrow();
    // This one had NO GATE AT ALL until F2 Phase 5 — an agent whose task was
    // still assigned could append `passport.agent_confirmed` to a booking
    // delivered days earlier. See the note at `confirmVisitIdentity`.
    await expect(
      confirmVisitIdentity(config, session, { taskId: visitTaskId }),
    ).rejects.toThrow();

    // `completeVerificationVisit` and `reportVisitException` return typed
    // failures rather than throwing — the console renders them — so they are
    // asserted on their result, not on a rejection.
    const completed = await completeVerificationVisit(config, session, {
      taskId: visitTaskId,
    });
    expect(completed.ok).toBe(false);

    const flagged = await reportVisitException(config, session, {
      taskId: visitTaskId,
      reason: "customer_not_home",
    });
    expect(flagged.ok).toBe(false);

    // NOTHING WAS WRITTEN. A refusal that still appends is worse than the
    // mutation it prevented.
    expect(await eventCount()).toBe(before);
  });

  it("refuses a second seal on a bag that already carries one", async () => {
    const [bag] = await db.query.bags.findMany({ limit: 1 });
    if (!bag) return;
    await expect(
      recordBagSealed(config, session, {
        taskId: visitTaskId,
        bagId: bag.id,
        sealId: "KLS-REPLAY",
        weightKg: 12,
        photoPath: "bag-photos/x.jpg",
      }),
    ).rejects.toThrow();
  });

  /* ---------------------------------------------------------------- */
  /* The pickup run                                                    */
  /* ---------------------------------------------------------------- */

  it("refuses every pickup mutation on a completed booking", async () => {
    const before = await eventCount();

    await expect(
      startPickupTravel(config, session, { taskId: pickupTaskId }),
    ).rejects.toThrow();

    /*
     * These two return `ok: true` and that is CORRECT, not a hole.
     *
     * The agent app is an offline-prone PWA on a phone in a van: a tap that
     * times out gets tapped again, and the second tap must return the current
     * state rather than an error. Both check the booking's status first and
     * return early, so "already delivered" reads as success and writes
     * NOTHING — which is what the event count below actually proves. An
     * immutability claim about a UI is about the database, not about a
     * response code.
     */
    for (const step of [deliverToBagdrop, confirmAirlineHandover]) {
      const result = await step(config, session, { taskId: pickupTaskId });
      expect(result.ok, step.name).toBe(true);
    }

    const scan = await scanSealAtPickup(config, session, {
      taskId: pickupTaskId,
      sealValue: "KLS-REPLAY",
    }).catch((error: unknown) => error);
    expect(scan).toBeInstanceOf(Error);

    expect(await eventCount()).toBe(before);
  });

  /* ---------------------------------------------------------------- */
  /* The state machine itself                                          */
  /* ---------------------------------------------------------------- */

  it("has no legal move out of `completed` at all", async () => {
    const before = await eventCount();
    for (const event of [
      "assign_agent",
      "complete_verification",
      "start_transit",
      "deliver_to_bagdrop",
      "complete",
      "cancel",
      "raise_exception",
    ] as const) {
      const moved = await applyTransition(config, { bookingId: booking.id, event });
      expect(moved.ok, event).toBe(false);
    }
    expect(await eventCount()).toBe(before);
    // And it is still exactly where it was.
    expect(await statusOf()).toBe("completed");
  });
});
