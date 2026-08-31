import { fileURLToPath } from "node:url";
import path from "node:path";

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  airports,
  bookings,
  createDb,
  custodyEvents,
  driverShifts,
  pickupTasks,
  staffMembers,
  trucks,
  users,
  type Database,
  type Address,
} from "@koolee/db";

import { createCoreConfig, fixedClock, type CoreConfig } from "../config";
import { ConflictError, NotAuthorizedError } from "../errors";
import { FakePaymentProvider } from "../payments/fake";
import { TEST_AIRPORTS } from "../test-utils/airport-fixtures";
import { pickupSnapshotOf } from "../test-utils/booking-fixtures";
import { ensureAddress } from "./customers";
import { PICKUP_EVENT_TYPES } from "./pickup-events";
import {
  adminForceEndShift,
  endShift,
  getActiveShift,
  listTruckOptions,
  startShift,
} from "./shifts";

/**
 * Shifts against a real Postgres.
 *
 * The two partial unique indexes (`WHERE ended_at IS NULL`) are the whole
 * point of this suite: they are the only thing standing between two taps on
 * "Start shift" and two people dispatched to the same van, and no fake
 * database expresses a partial unique index.
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIntegration = TEST_DATABASE_URL ? describe : describe.skip;

if (!TEST_DATABASE_URL) {
  console.log("[integration] TEST_DATABASE_URL not set — skipping shift tests.");
}

const migrationsFolder = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../db/drizzle",
);

describeIntegration("driver shifts (integration)", () => {
  let sqlClient: ReturnType<typeof postgres>;
  let db: Database;
  let config: CoreConfig;

  const now = new Date("2025-06-10T10:00:00Z");
  const departureAt = new Date("2025-06-12T22:00:00Z");

  let customerId: string;
  let pickupAddress: Address;
  let adminId: string;
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
      .values({ phone: "+15551200001", role: "customer" })
      .returning();
    customerId = customer!.id;
    pickupAddress = await ensureAddress(db, customerId, {
      line1: "1 Test St",
      city: "New York",
      state: "NY",
      zip: "10018",
    });

    const [admin] = await db
      .insert(users)
      .values({ email: "ops@koolee-test.example", role: "admin", fullName: "Alex Morgan" })
      .returning();
    adminId = admin!.id;
    await db.insert(staffMembers).values({ userId: adminId, role: "admin", active: true });
    refCounter = 0;
  });

  async function makeDriver(
    name: string,
    opts: { canDrive?: boolean; active?: boolean } = {},
  ): Promise<string> {
    const [row] = await db
      .insert(users)
      .values({
        email: `${name.toLowerCase().replace(/\W+/g, ".")}@koolee-test.example`,
        role: "agent",
        fullName: name,
      })
      .returning();
    await db.insert(staffMembers).values({
      userId: row!.id,
      role: "agent",
      active: opts.active ?? true,
      canDrive: opts.canDrive ?? true,
    });
    return row!.id;
  }

  const makeTruck = async (name: string, bagCapacity = 30, active = true) =>
    (await db.insert(trucks).values({ name, bagCapacity, active }).returning())[0]!;

  async function pickupOnShift(shiftId: string, driverUserId: string, status: string) {
    refCounter += 1;
    const [booking] = await db
      .insert(bookings)
      .values({
        ref: `KOO-S${String(refCounter).padStart(4, "0")}`,
        userId: customerId,
        status: status === "in_progress" ? "in_transit" : "awaiting_pickup",
        flightNumber: "DL123",
        airlineIata: "DL",
        departureAirport: "JFK",
        departureAt,
        paxName: "Casey Rivera",
        ...pickupSnapshotOf(pickupAddress),
        bagCount: 2,
        displayTz: "America/New_York",
        priceCents: 5000,
      })
      .returning();
    await db.insert(pickupTasks).values({
      bookingId: booking!.id,
      driverShiftId: shiftId,
      assigneeUserId: driverUserId,
      status: status as "assigned",
      ...(status === "in_progress" ? { startedAt: now } : {}),
    });
    return booking!;
  }

  /* --- starting ----------------------------------------------------- */

  it("opens a shift for a driver in an active truck", async () => {
    const driver = await makeDriver("Nina Petrov");
    const truck = await makeTruck("Van A", 12);

    const shift = await startShift(config, { staffUserId: driver, truckId: truck.id });
    expect(shift).toMatchObject({ bagsOnBoard: 0 });
    expect(shift.shift.endedAt).toBeNull();
    expect(shift.truck.name).toBe("Van A");

    expect(await getActiveShift(db, driver)).toMatchObject({ bagsOnBoard: 0 });
  });

  it("refuses somebody who is not cleared to drive", async () => {
    const agent = await makeDriver("Verifier Only", { canDrive: false });
    const truck = await makeTruck("Van A");
    await expect(
      startShift(config, { staffUserId: agent, truckId: truck.id }),
    ).rejects.toBeInstanceOf(NotAuthorizedError);
  });

  it("refuses deactivated staff", async () => {
    const driver = await makeDriver("Gone Home", { active: false });
    const truck = await makeTruck("Van A");
    await expect(
      startShift(config, { staffUserId: driver, truckId: truck.id }),
    ).rejects.toThrow(/No active staff role/);
  });

  it("refuses a truck that is out of service", async () => {
    const driver = await makeDriver("Nina Petrov");
    const truck = await makeTruck("Van A", 30, false);
    await expect(
      startShift(config, { staffUserId: driver, truckId: truck.id }),
    ).rejects.toThrow(/out of service/);
  });

  it("refuses a second shift for the same person, naming the truck they have", async () => {
    const driver = await makeDriver("Nina Petrov");
    const vanA = await makeTruck("Van A");
    const vanB = await makeTruck("Van B");
    await startShift(config, { staffUserId: driver, truckId: vanA.id });

    await expect(
      startShift(config, { staffUserId: driver, truckId: vanB.id }),
    ).rejects.toThrow(/already on shift with Van A/);
  });

  it("refuses a truck already out, naming who has it", async () => {
    const nina = await makeDriver("Nina Petrov");
    const sam = await makeDriver("Sam Okafor");
    const truck = await makeTruck("Van A");
    await startShift(config, { staffUserId: nina, truckId: truck.id });

    await expect(
      startShift(config, { staffUserId: sam, truckId: truck.id }),
    ).rejects.toThrow(/already out with Nina Petrov/);
  });

  /**
   * The reason the invariant lives in the database. Both calls pass every
   * SELECT either could make; only the partial unique index refuses the
   * second, and the 23505 handler turns that into a sentence.
   */
  it("two concurrent starts on one truck: exactly one shift exists", async () => {
    const nina = await makeDriver("Nina Petrov");
    const sam = await makeDriver("Sam Okafor");
    const truck = await makeTruck("Van A");

    const outcomes = await Promise.allSettled([
      startShift(config, { staffUserId: nina, truckId: truck.id }),
      startShift(config, { staffUserId: sam, truckId: truck.id }),
    ]);

    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((o) => o.status === "rejected")).toHaveLength(1);
    expect(await db.select().from(driverShifts)).toHaveLength(1);
  });

  it("lists active trucks and says which are already out", async () => {
    const driver = await makeDriver("Nina Petrov");
    const vanA = await makeTruck("Van A");
    await makeTruck("Van B");
    await makeTruck("Van C", 30, false);
    await startShift(config, { staffUserId: driver, truckId: vanA.id });

    const options = await listTruckOptions(db);
    expect(options.map((t) => t.name)).toEqual(["Van A", "Van B"]);
    expect(options[0]!.heldByUserId).toBe(driver);
    expect(options[1]!.heldByUserId).toBeNull();
  });

  /* --- ending ------------------------------------------------------- */

  it("ends a shift with nothing on the truck", async () => {
    const driver = await makeDriver("Nina Petrov");
    const truck = await makeTruck("Van A");
    await startShift(config, { staffUserId: driver, truckId: truck.id });

    const { shift } = await endShift(config, { staffUserId: driver });
    expect(shift.endedAt).toEqual(now);
    expect(await getActiveShift(db, driver)).toBeNull();
  });

  it("frees the truck and the person once the shift ends", async () => {
    const nina = await makeDriver("Nina Petrov");
    const sam = await makeDriver("Sam Okafor");
    const truck = await makeTruck("Van A");
    await startShift(config, { staffUserId: nina, truckId: truck.id });
    await endShift(config, { staffUserId: nina });

    // The partial index only constrains OPEN shifts, so the same truck goes
    // straight back out with the next driver.
    await expect(
      startShift(config, { staffUserId: sam, truckId: truck.id }),
    ).resolves.toMatchObject({ truck: { name: "Van A" } });
  });

  it("refuses to end a shift with bags still on the truck, naming the bookings", async () => {
    const driver = await makeDriver("Nina Petrov");
    const truck = await makeTruck("Van A");
    const shift = await startShift(config, { staffUserId: driver, truckId: truck.id });
    const booking = await pickupOnShift(shift.shift.id, driver, "assigned");

    const failure = await endShift(config, { staffUserId: driver }).catch((e) => e);
    expect(failure).toBeInstanceOf(ConflictError);
    expect(String(failure)).toContain(booking.ref);
    expect(String(failure)).toMatch(/2 bags/);

    expect(await getActiveShift(db, driver)).not.toBeNull();
  });

  it("counts bags, not pickups, when reporting what is on board", async () => {
    const driver = await makeDriver("Nina Petrov");
    const truck = await makeTruck("Van A");
    const shift = await startShift(config, { staffUserId: driver, truckId: truck.id });
    await pickupOnShift(shift.shift.id, driver, "assigned");
    await pickupOnShift(shift.shift.id, driver, "assigned");

    expect(await getActiveShift(db, driver)).toMatchObject({ bagsOnBoard: 4 });
  });

  it("lets a shift end once its pickups are done", async () => {
    const driver = await makeDriver("Nina Petrov");
    const truck = await makeTruck("Van A");
    const shift = await startShift(config, { staffUserId: driver, truckId: truck.id });
    const booking = await pickupOnShift(shift.shift.id, driver, "assigned");
    await db
      .update(pickupTasks)
      .set({ status: "done", completedAt: now })
      .where(eq(pickupTasks.bookingId, booking.id));

    await expect(endShift(config, { staffUserId: driver })).resolves.toBeDefined();
  });

  /* --- force-ending ------------------------------------------------- */

  it("force-end releases the pickups back into the pool with a reason", async () => {
    const driver = await makeDriver("Nina Petrov");
    const truck = await makeTruck("Van A");
    const shift = await startShift(config, { staffUserId: driver, truckId: truck.id });
    const booking = await pickupOnShift(shift.shift.id, driver, "assigned");

    const result = await adminForceEndShift(config, {
      shiftId: shift.shift.id,
      adminUserId: adminId,
      reason: "Van broke down on the BQE",
    });

    expect(result.released.map((r) => r.ref)).toEqual([booking.ref]);
    expect(result.raisedExceptions).toEqual([]);
    expect(result.shift.endedAt).toEqual(now);

    const task = await db.query.pickupTasks.findFirst({
      where: eq(pickupTasks.bookingId, booking.id),
    });
    expect(task).toMatchObject({
      driverShiftId: null,
      assigneeUserId: null,
      status: "pending",
      startedAt: null,
    });

    const events = await db
      .select()
      .from(custodyEvents)
      .where(eq(custodyEvents.bookingId, booking.id));
    const released = events.filter(
      (e) => e.eventType === PICKUP_EVENT_TYPES.shift_force_ended,
    );
    expect(released).toHaveLength(1);
    expect(released[0]!.metadata).toMatchObject({ reason: "Van broke down on the BQE" });
    expect(released[0]!.actorUserId).toBe(adminId);
  });

  it("raises an exception when the bags were already in transit", async () => {
    const driver = await makeDriver("Nina Petrov");
    const truck = await makeTruck("Van A");
    const shift = await startShift(config, { staffUserId: driver, truckId: truck.id });
    const booking = await pickupOnShift(shift.shift.id, driver, "in_progress");

    const result = await adminForceEndShift(config, {
      shiftId: shift.shift.id,
      adminUserId: adminId,
      reason: "Driver unreachable",
    });

    expect(result.raisedExceptions).toEqual([booking.id]);
    const after = await db.query.bookings.findFirst({ where: eq(bookings.id, booking.id) });
    expect(after?.status).toBe("exception");
  });

  it("insists on a reason", async () => {
    const driver = await makeDriver("Nina Petrov");
    const truck = await makeTruck("Van A");
    const shift = await startShift(config, { staffUserId: driver, truckId: truck.id });

    await expect(
      adminForceEndShift(config, {
        shiftId: shift.shift.id,
        adminUserId: adminId,
        reason: "   ",
      }),
    ).rejects.toThrow(/needs a reason/);
  });

  it("refuses to force-end a shift that already ended", async () => {
    const driver = await makeDriver("Nina Petrov");
    const truck = await makeTruck("Van A");
    const shift = await startShift(config, { staffUserId: driver, truckId: truck.id });
    await endShift(config, { staffUserId: driver });

    await expect(
      adminForceEndShift(config, {
        shiftId: shift.shift.id,
        adminUserId: adminId,
        reason: "too late",
      }),
    ).rejects.toThrow(/already ended/);
  });
});
