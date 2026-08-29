import { fileURLToPath } from "node:url";
import path from "node:path";

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  agentZones,
  airports,
  bookings,
  createDb,
  custodyEvents,
  driverPositions,
  driverShifts,
  pickupTasks,
  staffMembers,
  trucks,
  users,
  type Database,
} from "@koolee/db";

import { createCoreConfig, fixedClock, type CoreConfig } from "../config";
import { ConflictError } from "../errors";
import { FakePaymentProvider } from "../payments/fake";
import { TEST_AIRPORTS } from "../test-utils/airport-fixtures";
import { ensureAddress } from "./customers";
import {
  getSelectedDriver,
  listCandidateDrivers,
  recordDriverPosition,
  selectDriver,
} from "./driver-selection";
import { PICKUP_EVENT_TYPES } from "./pickup-events";
import { startShift } from "./shifts";

/**
 * Driver selection against a real Postgres.
 *
 * The reason this suite cannot be a unit test is the last case in it: two
 * customers taking the last space in the same van at the same instant. That
 * outcome is decided by `pg_advisory_xact_lock`, which a fake database cannot
 * model — a mock would prove only that the code calls a function.
 *
 * Pattern follows `auto-assign-on-paid.integration.test.ts`: a `max: 1` client
 * for DDL and cleanup, a separate `max: 8` pool for the code under test (the
 * pool is what makes real concurrency possible), and `Promise.all` over the
 * real entry point rather than an internal.
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIntegration = TEST_DATABASE_URL ? describe : describe.skip;

if (!TEST_DATABASE_URL) {
  console.log("[integration] TEST_DATABASE_URL not set — skipping driver-selection tests.");
}

const migrationsFolder = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../db/drizzle",
);

/** Midtown — the ZIP centroid the address backfill gives 10018. */
const MIDTOWN = { lat: 40.75544, lng: -73.9927 };

describeIntegration("driver selection (integration)", () => {
  let sqlClient: ReturnType<typeof postgres>;
  let db: Database;
  let config: CoreConfig;

  const now = new Date("2025-06-10T10:00:00Z");
  const departureAt = new Date("2025-06-12T22:00:00Z");

  let customerId: string;
  let addressId: string;
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
    config = createCoreConfig({
      db,
      payments: new FakePaymentProvider(),
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
      .values({ phone: "+15551190001", role: "customer", fullName: "Casey Rivera" })
      .returning();
    customerId = customer!.id;

    const address = await ensureAddress(db, customerId, {
      line1: "1 Test St",
      city: "New York",
      state: "NY",
      zip: "10018",
    });
    addressId = address.id;
    refCounter = 0;
  });

  /* --- fixtures ----------------------------------------------------- */

  /** A driver who can drive, covers 10018 unless told otherwise. */
  async function makeDriver(
    name: string,
    opts: { zip?: string | null; canDrive?: boolean; active?: boolean } = {},
  ): Promise<string> {
    const [row] = await db
      .insert(users)
      .values({
        email: `${name.toLowerCase().replace(/\W+/g, ".")}@koolee-test.example`,
        role: "agent",
        fullName: name,
      })
      .returning();
    const userId = row!.id;
    await db.insert(staffMembers).values({
      userId,
      role: "agent",
      active: opts.active ?? true,
      canDrive: opts.canDrive ?? true,
    });
    const zip = opts.zip === undefined ? "10018" : opts.zip;
    if (zip) await db.insert(agentZones).values({ agentUserId: userId, zip });
    return userId;
  }

  async function makeTruck(name: string, bagCapacity: number, active = true) {
    const [row] = await db.insert(trucks).values({ name, bagCapacity, active }).returning();
    return row!;
  }

  /**
   * A booking already sealed and waiting for a driver, with the pickup task
   * the on-paid auto-assign would have created. Inserted directly: the path
   * to `verified_sealed` is covered by `agent-visit.integration.test.ts`, and
   * reproducing it here would test the funnel rather than selection.
   */
  async function sealedBooking(bagCount: number, verifierUserId: string) {
    refCounter += 1;
    const [booking] = await db
      .insert(bookings)
      .values({
        ref: `KOO-T${String(refCounter).padStart(4, "0")}`,
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
    const [task] = await db
      .insert(pickupTasks)
      .values({
        bookingId: booking!.id,
        assigneeUserId: verifierUserId,
        status: "assigned",
      })
      .returning();
    return { booking: booking!, task: task! };
  }

  const eventsFor = (bookingId: string) =>
    db.select().from(custodyEvents).where(eq(custodyEvents.bookingId, bookingId));

  const taskFor = (bookingId: string) =>
    db.query.pickupTasks.findFirst({ where: eq(pickupTasks.bookingId, bookingId) });

  /* --- the shortlist ------------------------------------------------ */

  it("offers only drivers who are on shift, cleared to drive, in zone and have room", async () => {
    const verifier = await makeDriver("Verifier Only", { canDrive: false });
    const onShift = await makeDriver("Nina Petrov");
    const offShift = await makeDriver("Sam Okafor");
    const outOfZone = await makeDriver("Tara Lin", { zip: "11201" });
    const tooSmall = await makeDriver("Jonas Weber");

    const bigVan = await makeTruck("Van A", 30);
    const smallVan = await makeTruck("Van B", 2);
    const otherVan = await makeTruck("Van C", 30);

    await startShift(config, { staffUserId: onShift, truckId: bigVan.id });
    await startShift(config, { staffUserId: tooSmall, truckId: smallVan.id });
    await startShift(config, { staffUserId: outOfZone, truckId: otherVan.id });
    // `offShift` and `verifier` never start one.

    const { booking } = await sealedBooking(3, verifier);
    const candidates = await listCandidateDrivers(config, { bookingId: booking.id });

    expect(candidates.map((c) => c.givenName)).toEqual(["Nina"]);
    expect(candidates[0]).toMatchObject({
      truckName: "Van A",
      bagCapacity: 30,
      bagsOnBoard: 0,
      availableCapacity: 30,
      outOfZone: false,
      // No position pinged yet — a real state, rendered as "ETA on the way".
      eta: null,
    });
    void offShift;
  });

  it("puts the emptiest truck first and caps the list at four", async () => {
    const verifier = await makeDriver("Verifier", { canDrive: false });
    const names = ["Ana One", "Bo Two", "Cy Three", "Di Four", "Ed Five"];
    const shifts: { name: string; shiftId: string }[] = [];
    for (const [i, name] of names.entries()) {
      const driver = await makeDriver(name);
      const truck = await makeTruck(`Van ${i}`, 30);
      const shift = await startShift(config, { staffUserId: driver, truckId: truck.id });
      shifts.push({ name, shiftId: shift.shift.id });
    }

    // Load them in descending order so the sort has something to do: Ed
    // carries nothing, Ana carries the most.
    for (const [i, entry] of shifts.entries()) {
      const bags = names.length - i;
      const { booking } = await sealedBooking(bags, verifier);
      await db
        .update(pickupTasks)
        .set({ driverShiftId: entry.shiftId, assigneeUserId: null })
        .where(eq(pickupTasks.bookingId, booking.id));
    }

    const { booking } = await sealedBooking(1, verifier);
    const candidates = await listCandidateDrivers(config, { bookingId: booking.id });

    expect(candidates).toHaveLength(4);
    expect(candidates.map((c) => c.givenName)).toEqual(["Ed", "Di", "Cy", "Bo"]);
    expect(candidates.map((c) => c.bagsOnBoard)).toEqual([1, 2, 3, 4]);
  });

  it("carries an ETA range once the driver has pinged a position", async () => {
    const verifier = await makeDriver("Verifier", { canDrive: false });
    const driver = await makeDriver("Nina Petrov");
    const truck = await makeTruck("Van A", 30);
    await startShift(config, { staffUserId: driver, truckId: truck.id });
    // Two ZIPs east — a real hop, not a teleport.
    await recordDriverPosition(config, {
      staffUserId: driver,
      lat: 40.71277,
      lng: -73.95371,
    });

    const { booking } = await sealedBooking(2, verifier);
    const [candidate] = await listCandidateDrivers(config, { bookingId: booking.id });

    expect(candidate!.eta).not.toBeNull();
    expect(candidate!.eta!.minMinutes).toBeGreaterThanOrEqual(5);
    expect(candidate!.eta!.maxMinutes).toBeGreaterThan(candidate!.eta!.minMinutes);
  });

  it("widens past the zone only when nothing in zone is available, and says so", async () => {
    const verifier = await makeDriver("Verifier", { canDrive: false });
    const brooklyn = await makeDriver("Tara Lin", { zip: "11201" });
    const truck = await makeTruck("Van A", 30);
    await startShift(config, { staffUserId: brooklyn, truckId: truck.id });

    const { booking } = await sealedBooking(2, verifier);
    const candidates = await listCandidateDrivers(config, { bookingId: booking.id });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ givenName: "Tara", outOfZone: true });
  });

  it("returns nothing rather than an unavailable driver when the pool is empty", async () => {
    const verifier = await makeDriver("Verifier", { canDrive: false });
    const { booking } = await sealedBooking(2, verifier);
    expect(await listCandidateDrivers(config, { bookingId: booking.id })).toEqual([]);
  });

  it("refuses to shortlist a booking that is not sealed yet", async () => {
    const verifier = await makeDriver("Verifier", { canDrive: false });
    const { booking } = await sealedBooking(2, verifier);
    await db
      .update(bookings)
      .set({ status: "agent_assigned" })
      .where(eq(bookings.id, booking.id));

    await expect(
      listCandidateDrivers(config, { bookingId: booking.id }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  /* --- selecting ---------------------------------------------------- */

  it("assigns the pickup to the shift, writes both columns, and logs custody", async () => {
    const verifier = await makeDriver("Verifier", { canDrive: false });
    const driver = await makeDriver("Nina Petrov");
    const truck = await makeTruck("Van A", 30);
    const shift = await startShift(config, { staffUserId: driver, truckId: truck.id });
    const { booking } = await sealedBooking(3, verifier);

    const result = await selectDriver(config, {
      bookingId: booking.id,
      userId: customerId,
      shiftId: shift.shift.id,
    });

    expect(result.releasedShiftId).toBeNull();
    expect(result.candidate).toMatchObject({ truckName: "Van A", bagsOnBoard: 3 });

    const task = await taskFor(booking.id);
    // The two assignment columns must agree — see schema/tasks.ts.
    expect(task).toMatchObject({
      driverShiftId: shift.shift.id,
      assigneeUserId: driver,
      status: "assigned",
    });

    const events = await eventsFor(booking.id);
    const selected = events.filter(
      (e) => e.eventType === PICKUP_EVENT_TYPES.driver_selected,
    );
    expect(selected).toHaveLength(1);
    expect(selected[0]!.metadata).toMatchObject({
      shiftId: shift.shift.id,
      truckName: "Van A",
      driverUserId: driver,
      bagCount: 3,
    });
    expect(selected[0]!.actorUserId).toBe(customerId);
  });

  it("refuses a booking belonging to somebody else", async () => {
    const verifier = await makeDriver("Verifier", { canDrive: false });
    const driver = await makeDriver("Nina Petrov");
    const truck = await makeTruck("Van A", 30);
    const shift = await startShift(config, { staffUserId: driver, truckId: truck.id });
    const { booking } = await sealedBooking(2, verifier);

    const [other] = await db
      .insert(users)
      .values({ phone: "+15551190009", role: "customer" })
      .returning();

    await expect(
      selectDriver(config, {
        bookingId: booking.id,
        userId: other!.id,
        shiftId: shift.shift.id,
      }),
    ).rejects.toThrow(/another account/);
  });

  it("is re-runnable: choosing again releases the previous shift", async () => {
    const verifier = await makeDriver("Verifier", { canDrive: false });
    const first = await makeDriver("Nina Petrov");
    const second = await makeDriver("Sam Okafor");
    const vanA = await makeTruck("Van A", 30);
    const vanB = await makeTruck("Van B", 30);
    const shiftA = await startShift(config, { staffUserId: first, truckId: vanA.id });
    const shiftB = await startShift(config, { staffUserId: second, truckId: vanB.id });
    const { booking } = await sealedBooking(3, verifier);

    await selectDriver(config, {
      bookingId: booking.id,
      userId: customerId,
      shiftId: shiftA.shift.id,
    });
    const again = await selectDriver(config, {
      bookingId: booking.id,
      userId: customerId,
      shiftId: shiftB.shift.id,
    });

    expect(again.releasedShiftId).toBe(shiftA.shift.id);

    const task = await taskFor(booking.id);
    expect(task).toMatchObject({ driverShiftId: shiftB.shift.id, assigneeUserId: second });

    const events = await eventsFor(booking.id);
    expect(
      events.filter((e) => e.eventType === PICKUP_EVENT_TYPES.driver_released),
    ).toHaveLength(1);
    expect(
      events.filter((e) => e.eventType === PICKUP_EVENT_TYPES.driver_selected),
    ).toHaveLength(2);

    // The first shift's capacity came back with the release.
    const nowFree = await listCandidateDrivers(config, {
      bookingId: (await sealedBooking(1, verifier)).booking.id,
    });
    expect(nowFree.find((c) => c.shiftId === shiftA.shift.id)?.bagsOnBoard).toBe(0);
  });

  it("closes the choice once the driver has set off", async () => {
    const verifier = await makeDriver("Verifier", { canDrive: false });
    const first = await makeDriver("Nina Petrov");
    const second = await makeDriver("Sam Okafor");
    const vanA = await makeTruck("Van A", 30);
    const vanB = await makeTruck("Van B", 30);
    const shiftA = await startShift(config, { staffUserId: first, truckId: vanA.id });
    const shiftB = await startShift(config, { staffUserId: second, truckId: vanB.id });
    const { booking } = await sealedBooking(2, verifier);

    await selectDriver(config, {
      bookingId: booking.id,
      userId: customerId,
      shiftId: shiftA.shift.id,
    });
    await db
      .update(pickupTasks)
      .set({ startedAt: now, status: "in_progress" })
      .where(eq(pickupTasks.bookingId, booking.id));

    await expect(
      selectDriver(config, {
        bookingId: booking.id,
        userId: customerId,
        shiftId: shiftB.shift.id,
      }),
    ).rejects.toThrow(/already on the way/);
  });

  it("refuses a driver who clocked off between rendering and clicking", async () => {
    const verifier = await makeDriver("Verifier", { canDrive: false });
    const driver = await makeDriver("Nina Petrov");
    const truck = await makeTruck("Van A", 30);
    const shift = await startShift(config, { staffUserId: driver, truckId: truck.id });
    const { booking } = await sealedBooking(2, verifier);

    await db
      .update(driverShifts)
      .set({ endedAt: now })
      .where(eq(driverShifts.id, shift.shift.id));

    await expect(
      selectDriver(config, {
        bookingId: booking.id,
        userId: customerId,
        shiftId: shift.shift.id,
      }),
    ).rejects.toThrow(/finished their shift/);
  });

  /* --- the race ----------------------------------------------------- */

  it("two concurrent selections for the last space: exactly one wins", async () => {
    const verifier = await makeDriver("Verifier", { canDrive: false });
    const driver = await makeDriver("Nina Petrov");
    // Three spaces, two customers wanting two bags each. Only one can fit.
    const truck = await makeTruck("Van A", 3);
    const shift = await startShift(config, { staffUserId: driver, truckId: truck.id });

    const one = await sealedBooking(2, verifier);
    const two = await sealedBooking(2, verifier);

    const outcomes = await Promise.allSettled([
      selectDriver(config, {
        bookingId: one.booking.id,
        userId: customerId,
        shiftId: shift.shift.id,
      }),
      selectDriver(config, {
        bookingId: two.booking.id,
        userId: customerId,
        shiftId: shift.shift.id,
      }),
    ]);

    const won = outcomes.filter((o) => o.status === "fulfilled");
    const lost = outcomes.filter((o) => o.status === "rejected");
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    expect((lost[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError);
    expect(String((lost[0] as PromiseRejectedResult).reason)).toMatch(/filled up/);

    // And the van is not overloaded: exactly one booking is on the shift.
    const onShift = await db
      .select()
      .from(pickupTasks)
      .where(eq(pickupTasks.driverShiftId, shift.shift.id));
    expect(onShift).toHaveLength(1);
  });

  /* --- reads -------------------------------------------------------- */

  it("getSelectedDriver reports the chosen driver, truck and position", async () => {
    const verifier = await makeDriver("Verifier", { canDrive: false });
    const driver = await makeDriver("Nina Petrov");
    const truck = await makeTruck("Van A", 30);
    const shift = await startShift(config, { staffUserId: driver, truckId: truck.id });
    const { booking } = await sealedBooking(2, verifier);
    await selectDriver(config, {
      bookingId: booking.id,
      userId: customerId,
      shiftId: shift.shift.id,
    });

    expect(await getSelectedDriver(db, booking.id)).toMatchObject({
      shiftId: shift.shift.id,
      givenName: "Nina",
      truckName: "Van A",
      taskStatus: "assigned",
      travelStartedAt: null,
      position: null,
    });

    await recordDriverPosition(config, { staffUserId: driver, ...MIDTOWN });
    expect((await getSelectedDriver(db, booking.id))?.position).toEqual(MIDTOWN);
  });

  it("records one position row per driver, overwriting rather than appending", async () => {
    const driver = await makeDriver("Nina Petrov");
    const truck = await makeTruck("Van A", 30);
    await startShift(config, { staffUserId: driver, truckId: truck.id });

    await recordDriverPosition(config, { staffUserId: driver, ...MIDTOWN });
    await recordDriverPosition(config, {
      staffUserId: driver,
      lat: 40.71277,
      lng: -73.95371,
    });

    const rows = await db.select().from(driverPositions);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ lat: 40.71277, lng: -73.95371 });
  });

  it("refuses a position from somebody who is not on shift", async () => {
    const driver = await makeDriver("Nina Petrov");
    await expect(
      recordDriverPosition(config, { staffUserId: driver, ...MIDTOWN }),
    ).rejects.toThrow(/Not on shift/);
  });
});
