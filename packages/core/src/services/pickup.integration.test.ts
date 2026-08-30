import { fileURLToPath } from "node:url";
import path from "node:path";

import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  agentZones,
  airports,
  bags,
  bookings,
  createDb,
  custodyEvents,
  pickupTasks,
  staffMembers,
  trucks,
  users,
  type Database,
} from "@koolee/db";

import type { AgentSession } from "../auth/types";
import { createCoreConfig, fixedClock, type CoreConfig } from "../config";
import { BookingNotActionableError, ConflictError } from "../errors";
import { FakePaymentProvider } from "../payments/fake";
import { TEST_AIRPORTS } from "../test-utils/airport-fixtures";
import { ensureAddress } from "./customers";
import { listBookingsBoard, getOpsDashboard } from "./dispatch";
import { selectDriver } from "./driver-selection";
import { PICKUP_EVENT_TYPES } from "./pickup-events";
import {
  confirmAirlineHandover,
  deliverToBagdrop,
  getPickupContext,
  reportPickupException,
  scanSealAtPickup,
  startPickupTravel,
} from "./pickup";
import { endShift, startShift } from "./shifts";

/**
 * The pickup lifecycle end to end — the four state-machine transitions that
 * had no production caller before this slice.
 *
 * Against a real database because the thing being proved is a SEQUENCE of
 * committed state: booking status, task status, and an append-only custody
 * trail that has to line up with both. A fake would let every step "succeed"
 * in isolation and prove nothing about the order.
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIntegration = TEST_DATABASE_URL ? describe : describe.skip;

if (!TEST_DATABASE_URL) {
  console.log("[integration] TEST_DATABASE_URL not set — skipping pickup lifecycle tests.");
}

const migrationsFolder = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../db/drizzle",
);

class RecordingAlerter {
  readonly alerts: { severity: string; title: string }[] = [];
  async alert(event: { severity: string; title: string }): Promise<void> {
    this.alerts.push({ severity: event.severity, title: event.title });
  }
}

describeIntegration("pickup lifecycle (integration)", () => {
  let sqlClient: ReturnType<typeof postgres>;
  let db: Database;
  let config: CoreConfig;
  let alerter: RecordingAlerter;

  const now = new Date("2025-06-10T10:00:00Z");
  /** Six hours out, so the no-driver at-risk horizon (12 h) bites. */
  const departureAt = new Date("2025-06-10T16:00:00Z");

  let customerId: string;
  let addressId: string;
  let driverId: string;
  let session: AgentSession;
  let refCounter = 0;

  beforeAll(async () => {
    sqlClient = postgres(TEST_DATABASE_URL!, { max: 1, prepare: false });
    await migrate(drizzle(sqlClient), { migrationsFolder });
    db = createDb({ url: TEST_DATABASE_URL!, max: 8 });
  });

  afterAll(async () => {
    await sqlClient?.end();
  });

  beforeEach(async () => {
    alerter = new RecordingAlerter();
    config = createCoreConfig({
      db,
      payments: new FakePaymentProvider(),
      opsAlerter: alerter,
      clock: fixedClock(now),
    });

    await sqlClient.unsafe(`
      SET session_replication_role = replica;
      DELETE FROM custody_events;
      DELETE FROM pickup_tasks;
      DELETE FROM verification_tasks;
      DELETE FROM bags;
      DELETE FROM bookings;
      DELETE FROM driver_positions;
      DELETE FROM driver_shifts;
      DELETE FROM trucks;
      DELETE FROM agent_zones;
      DELETE FROM staff_members;
      DELETE FROM addresses;
      DELETE FROM users;
      DELETE FROM airports;
      SET session_replication_role = DEFAULT;
    `);

    await db.insert(airports).values(TEST_AIRPORTS.JFK);

    const [customer] = await db
      .insert(users)
      .values({ phone: "+15551210001", role: "customer", fullName: "Casey Rivera" })
      .returning();
    customerId = customer!.id;
    addressId = (
      await ensureAddress(db, customerId, {
        line1: "1 Test St",
        city: "New York",
        state: "NY",
        zip: "10018",
      })
    ).id;

    const [driver] = await db
      .insert(users)
      .values({
        email: "nina@koolee-test.example",
        role: "agent",
        fullName: "Nina Petrov",
      })
      .returning();
    driverId = driver!.id;
    await db
      .insert(staffMembers)
      .values({ userId: driverId, role: "agent", active: true, canDrive: true });
    await db.insert(agentZones).values({ agentUserId: driverId, zip: "10018" });
    session = { kind: "agent", role: "agent", userId: driverId };
    refCounter = 0;
  });

  /** A sealed booking with `bagCount` sealed bags, plus its pickup task. */
  async function sealedBooking(bagCount = 2) {
    refCounter += 1;
    const ref = `KOO-P${String(refCounter).padStart(4, "0")}`;
    const [booking] = await db
      .insert(bookings)
      .values({
        ref,
        userId: customerId,
        status: "verified_sealed",
        flightNumber: "DL123",
        airlineIata: "DL",
        departureAirport: "JFK",
        departureAt,
        paxName: "Casey Rivera",
        pickupAddressId: addressId,
        bagCount,
        displayTz: "America/New_York",
        priceCents: 5000,
      })
      .returning();

    const bagRows = await db
      .insert(bags)
      .values(
        Array.from({ length: bagCount }, (_, i) => ({
          bookingId: booking!.id,
          ordinal: i + 1,
          sealId: `${ref}-SEAL-${i + 1}`,
          weightKg: "18.0",
        })),
      )
      .returning();

    const [task] = await db
      .insert(pickupTasks)
      .values({ bookingId: booking!.id, status: "assigned" })
      .returning();

    return { booking: booking!, bags: bagRows, task: task! };
  }

  /** Sealed booking with a driver already chosen — the normal starting state. */
  async function assignedPickup(bagCount = 2, capacity = 30) {
    const fixture = await sealedBooking(bagCount);
    const [truck] = await db
      .insert(trucks)
      .values({ name: `Van ${refCounter}`, bagCapacity: capacity })
      .returning();
    const shift = await startShift(config, {
      staffUserId: driverId,
      truckId: truck!.id,
    });
    await selectDriver(config, {
      bookingId: fixture.booking.id,
      userId: customerId,
      shiftId: shift.shift.id,
    });
    return { ...fixture, shift };
  }

  const statusOf = async (bookingId: string) =>
    (await db.query.bookings.findFirst({ where: eq(bookings.id, bookingId) }))?.status;

  /**
   * ORDER BY is not optional here. Postgres returns rows in whatever order it
   * likes without one, and the lifecycle test asserts a SEQUENCE — it passed
   * by luck until a later change reshuffled the heap. Every event in this flow
   * is written in its own transaction, so `created_at` (transaction-start
   * `now()`) is a real ordering rather than a tie.
   */
  const eventsFor = (bookingId: string) =>
    db
      .select()
      .from(custodyEvents)
      .where(eq(custodyEvents.bookingId, bookingId))
      .orderBy(asc(custodyEvents.createdAt));

  const taskFor = (bookingId: string) =>
    db.query.pickupTasks.findFirst({ where: eq(pickupTasks.bookingId, bookingId) });

  /* --- authorization ------------------------------------------------ */

  it("does not resolve somebody else's task", async () => {
    const { task } = await assignedPickup();
    const [other] = await db
      .insert(users)
      .values({ email: "sam@koolee-test.example", role: "agent" })
      .returning();
    const otherSession: AgentSession = {
      kind: "agent",
      role: "agent",
      userId: other!.id,
    };

    await expect(getPickupContext(db, otherSession, task.id)).rejects.toThrow(
      /Pickup task .* not found/,
    );
  });

  /* --- the happy path ----------------------------------------------- */

  it("runs the whole lifecycle, moving the booking one step at a time", async () => {
    const { booking, bags: bagRows, task } = await assignedPickup(2);

    expect(await statusOf(booking.id)).toBe("verified_sealed");

    await expect(
      startPickupTravel(config, session, { taskId: task.id, lat: 40.75, lng: -73.99 }),
    ).resolves.toEqual({ ok: true });
    expect(await statusOf(booking.id)).toBe("awaiting_pickup");
    expect(await taskFor(booking.id)).toMatchObject({ status: "in_progress" });

    const first = await scanSealAtPickup(config, session, {
      taskId: task.id,
      sealValue: bagRows[0]!.sealId!,
    });
    expect(first).toMatchObject({ scannedCount: 1, totalBags: 2, custodyTransferred: false });
    // One bag in the van is NOT custody — the booking has not moved.
    expect(await statusOf(booking.id)).toBe("awaiting_pickup");

    const second = await scanSealAtPickup(config, session, {
      taskId: task.id,
      sealValue: bagRows[1]!.sealId!,
    });
    expect(second).toMatchObject({ scannedCount: 2, totalBags: 2, custodyTransferred: true });
    expect(await statusOf(booking.id)).toBe("in_transit");

    await expect(
      deliverToBagdrop(config, session, { taskId: task.id }),
    ).resolves.toEqual({ ok: true });
    expect(await statusOf(booking.id)).toBe("delivered_to_bagdrop");
    // Still open: the airline has not taken the bags yet.
    expect(await taskFor(booking.id)).toMatchObject({ status: "in_progress" });

    await expect(
      confirmAirlineHandover(config, session, { taskId: task.id }),
    ).resolves.toEqual({ ok: true });
    expect(await statusOf(booking.id)).toBe("completed");
    expect(await taskFor(booking.id)).toMatchObject({ status: "done" });

    const types = (await eventsFor(booking.id)).map((e) => e.eventType);
    expect(types).toEqual([
      PICKUP_EVENT_TYPES.driver_selected,
      "booking.awaiting_pickup",
      PICKUP_EVENT_TYPES.travel_started,
      PICKUP_EVENT_TYPES.seal_scanned,
      PICKUP_EVENT_TYPES.seal_scanned,
      "booking.in_transit",
      "booking.delivered_to_bagdrop",
      "booking.completed",
      PICKUP_EVENT_TYPES.handover_confirmed,
    ]);
  });

  /* --- the lateness gate, and the carve-out it makes ---------------- */

  /**
   * `now` is 10:00Z and the flight leaves at 16:00Z, so the DL/JFK cutoff
   * (45 minutes) falls at 15:15Z. This clock sits fifteen minutes past it.
   */
  const pastCutoff = () =>
    createCoreConfig({
      db,
      payments: new FakePaymentProvider(),
      opsAlerter: alerter,
      clock: fixedClock(new Date("2025-06-10T15:30:00Z")),
    });

  it("refuses to start a pickup once the airline's bag drop has closed", async () => {
    const { booking, task } = await assignedPickup(2);
    const late = pastCutoff();

    const error = await startPickupTravel(late, session, { taskId: task.id }).then(
      () => null,
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(BookingNotActionableError);
    expect((error as BookingNotActionableError).phase).toBe("missed_cutoff");
    // Ops decides what happens to these bags, not the driver at the door.
    expect(await statusOf(booking.id)).toBe("exception");
    expect(await taskFor(booking.id)).toMatchObject({ status: "assigned" });
  });

  it("lets a driver already in transit finish the run past the cutoff", async () => {
    // The carve-out. Bags in a van are safer at the airline — or back with
    // ops — than in limbo, so nothing below the "start" line is gated. Ops
    // still sees it: `cutoffRiskMonitor` scans in-transit bookings every five
    // minutes and alerts on exactly this.
    const { booking, bags: bagRows, task } = await assignedPickup(1);
    await startPickupTravel(config, session, { taskId: task.id });

    const late = pastCutoff();

    // Re-tapping "start" is idempotent and must NOT now refuse the driver or
    // raise an exception on a booking whose bags are already moving.
    await expect(
      startPickupTravel(late, session, { taskId: task.id }),
    ).resolves.toEqual({ ok: true });

    await scanSealAtPickup(late, session, {
      taskId: task.id,
      sealValue: bagRows[0]!.sealId!,
    });
    expect(await statusOf(booking.id)).toBe("in_transit");

    await expect(deliverToBagdrop(late, session, { taskId: task.id })).resolves.toEqual({
      ok: true,
    });
    await expect(
      confirmAirlineHandover(late, session, { taskId: task.id }),
    ).resolves.toEqual({ ok: true });
    expect(await statusOf(booking.id)).toBe("completed");
  });

  it("stamps each scan with its bag and seal", async () => {
    const { booking, bags: bagRows, task } = await assignedPickup(2);
    await startPickupTravel(config, session, { taskId: task.id });
    await scanSealAtPickup(config, session, {
      taskId: task.id,
      sealValue: bagRows[0]!.sealId!,
      lat: 40.75,
      lng: -73.99,
    });

    const scan = (await eventsFor(booking.id)).find(
      (e) => e.eventType === PICKUP_EVENT_TYPES.seal_scanned,
    );
    expect(scan).toMatchObject({
      bagId: bagRows[0]!.id,
      actorUserId: driverId,
      lat: 40.75,
      lng: -73.99,
    });
    expect(scan!.metadata).toMatchObject({ sealId: bagRows[0]!.sealId, ordinal: 1 });
  });

  /* --- idempotency (an offline-prone PWA taps twice) ----------------- */

  it("is idempotent on every step", async () => {
    const { booking, bags: bagRows, task } = await assignedPickup(1);

    await startPickupTravel(config, session, { taskId: task.id });
    await startPickupTravel(config, session, { taskId: task.id });

    await scanSealAtPickup(config, session, {
      taskId: task.id,
      sealValue: bagRows[0]!.sealId!,
    });
    const again = await scanSealAtPickup(config, session, {
      taskId: task.id,
      sealValue: bagRows[0]!.sealId!,
    });
    expect(again).toMatchObject({ scannedCount: 1, custodyTransferred: false });

    await deliverToBagdrop(config, session, { taskId: task.id });
    await deliverToBagdrop(config, session, { taskId: task.id });
    await confirmAirlineHandover(config, session, { taskId: task.id });
    await confirmAirlineHandover(config, session, { taskId: task.id });

    expect(await statusOf(booking.id)).toBe("completed");
    const types = (await eventsFor(booking.id)).map((e) => e.eventType);
    // Exactly one of each, despite every step being called twice.
    for (const type of [
      PICKUP_EVENT_TYPES.travel_started,
      PICKUP_EVENT_TYPES.seal_scanned,
      "booking.awaiting_pickup",
      "booking.in_transit",
      "booking.delivered_to_bagdrop",
      "booking.completed",
      PICKUP_EVENT_TYPES.handover_confirmed,
    ]) {
      expect(types.filter((t) => t === type)).toHaveLength(1);
    }
  });

  /* --- the refusals ------------------------------------------------- */

  it("refuses a seal that belongs to another booking, and pages ops", async () => {
    const mine = await assignedPickup(1);
    const theirs = await sealedBooking(1);
    await startPickupTravel(config, session, { taskId: mine.task.id });

    const failure = await scanSealAtPickup(config, session, {
      taskId: mine.task.id,
      sealValue: theirs.bags[0]!.sealId!,
    }).catch((e) => e);

    expect(failure).toBeInstanceOf(ConflictError);
    expect(String(failure)).toMatch(/is not on booking KOO-/);
    expect(String(failure)).toMatch(/Do not load that bag/);

    // The refusal is itself evidence, and ops hears about it.
    const mismatch = (await eventsFor(mine.booking.id)).filter(
      (e) => e.eventType === PICKUP_EVENT_TYPES.seal_mismatch,
    );
    expect(mismatch).toHaveLength(1);
    expect(alerter.alerts[0]!.title).toMatch(/does not belong to it/);
    expect(await statusOf(mine.booking.id)).toBe("awaiting_pickup");
  });

  it("refuses to scan before the pickup has started", async () => {
    const { bags: bagRows, task } = await assignedPickup(1);
    await expect(
      scanSealAtPickup(config, session, {
        taskId: task.id,
        sealValue: bagRows[0]!.sealId!,
      }),
    ).rejects.toThrow(/Start the pickup before scanning/);
  });

  it("refuses to deliver with a bag never scanned", async () => {
    const { bags: bagRows, task } = await assignedPickup(2);
    await startPickupTravel(config, session, { taskId: task.id });
    await scanSealAtPickup(config, session, {
      taskId: task.id,
      sealValue: bagRows[0]!.sealId!,
    });

    await expect(deliverToBagdrop(config, session, { taskId: task.id })).resolves.toEqual({
      ok: false,
      error: "1 bag(s) never scanned — scan every seal before delivering.",
    });
  });

  it("routes a driver-side problem into the exception flow", async () => {
    const { booking, task } = await assignedPickup(2);
    await startPickupTravel(config, session, { taskId: task.id });

    await expect(
      reportPickupException(config, session, {
        taskId: task.id,
        reason: "bag_count_mismatch",
        note: "Three bags at the door, two on the booking",
      }),
    ).resolves.toEqual({ ok: true });

    expect(await statusOf(booking.id)).toBe("exception");
    expect(await taskFor(booking.id)).toMatchObject({ status: "failed" });
    expect(alerter.alerts.some((a) => a.title.match(/Pickup exception/))).toBe(true);
  });

  it("insists on a note for an unspecified problem", async () => {
    const { task } = await assignedPickup();
    await expect(
      reportPickupException(config, session, { taskId: task.id, reason: "other" }),
    ).resolves.toEqual({ ok: false, error: "Describe what happened." });
  });

  /* --- the shift can only end when the van is empty ------------------ */

  it("keeps the shift open until the run finishes, then lets it close", async () => {
    const { bags: bagRows, task } = await assignedPickup(1);

    await expect(endShift(config, { staffUserId: driverId })).rejects.toThrow(
      /Finish or hand over/,
    );

    await startPickupTravel(config, session, { taskId: task.id });
    await scanSealAtPickup(config, session, {
      taskId: task.id,
      sealValue: bagRows[0]!.sealId!,
    });
    await deliverToBagdrop(config, session, { taskId: task.id });
    await confirmAirlineHandover(config, session, { taskId: task.id });

    await expect(endShift(config, { staffUserId: driverId })).resolves.toBeDefined();
  });

  /* --- the board learns to see a driverless booking ------------------ */

  it("flags a sealed booking with no driver, with its own reason", async () => {
    const withoutDriver = await sealedBooking(2);
    const withDriver = await assignedPickup(2);

    const board = await listBookingsBoard(db, {}, now);
    const rows = new Map(board.map((r) => [r.booking.id, r]));

    expect(rows.get(withoutDriver.booking.id)).toMatchObject({
      atRisk: true,
      atRiskReason: "no_driver",
      driverShiftId: null,
      driverName: null,
      truckName: null,
    });
    expect(rows.get(withDriver.booking.id)).toMatchObject({
      atRisk: false,
      atRiskReason: null,
      driverName: "Nina Petrov",
      pickupTaskStatus: "assigned",
    });
    expect(rows.get(withDriver.booking.id)!.truckName).toMatch(/^Van /);
  });

  it("does not flag a sealed booking whose flight is days away", async () => {
    const { booking } = await sealedBooking(2);
    await db
      .update(bookings)
      .set({ departureAt: new Date(now.getTime() + 72 * 3_600_000) })
      .where(eq(bookings.id, booking.id));

    const [row] = await listBookingsBoard(db, {}, now);
    expect(row).toMatchObject({ atRisk: false, atRiskReason: null });
  });

  it("counts sealed-but-driverless bookings separately on the dashboard", async () => {
    const window = {
      pickupWindowStart: new Date("2025-06-10T12:00:00Z"),
      pickupWindowEnd: new Date("2025-06-10T13:00:00Z"),
    };
    const withoutDriver = await sealedBooking(2);
    await db.update(bookings).set(window).where(eq(bookings.id, withoutDriver.booking.id));
    const withDriver = await assignedPickup(2);
    await db.update(bookings).set(window).where(eq(bookings.id, withDriver.booking.id));

    const dashboard = await getOpsDashboard(db, "America/New_York", now);
    expect(dashboard.awaitingDriverToday).toBe(1);
    // The agent-side count is a different failure and stays its own number.
    expect(dashboard.unassignedToday).toBe(0);
  });
});
