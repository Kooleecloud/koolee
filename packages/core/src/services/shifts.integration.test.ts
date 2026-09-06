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
  adminStartShiftOnBehalf,
  createTruck,
  endShift,
  getActiveShift,
  listOnBehalfDriverOptions,
  listTruckOptions,
  startShift,
  updateTruck,
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
      .values({
        email: "ops@koolee-test.example",
        role: "admin",
        fullName: "Alex Morgan",
      })
      .returning();
    adminId = admin!.id;
    await db
      .insert(staffMembers)
      .values({ userId: adminId, role: "admin", active: true });
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
    const after = await db.query.bookings.findFirst({
      where: eq(bookings.id, booking.id),
    });
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

  /* --- the fleet ---------------------------------------------------- */

  /**
   * A RESERVE MUST LEAVE AT LEAST ONE BOOKABLE SPACE.
   *
   * `reserved_spaces >= bag_capacity` is a truck that can never be offered to
   * anybody — `bookableSpaces` returns 0 for every booking, so it vanishes
   * from every shortlist and every reassign picker while still looking active
   * and fully crewed in the console. Taking a van out of service is what the
   * `active` toggle is for, and it says so on screen; a reserve doing the same
   * thing silently is a van nobody can explain.
   */
  describe("reserved spaces must leave room", () => {
    it("refuses a new truck whose reserve equals its capacity", async () => {
      await expect(
        createTruck(db, { name: "Van Z", bagCapacity: 10, reservedSpaces: 10 }),
      ).rejects.toThrow(/nothing bookable/i);
    });

    /*
     * THE RULE THAT REVERSED A COMMENT. `updateTruck`'s header used to say
     * capacity could be cut below what was aboard, because the number is
     * being corrected and refusing would not unload the van — true, and
     * nothing breaks, since `bookableSpaces` floors at zero.
     *
     * That silence is the problem. On a truck with an open shift the likelier
     * cause of "capacity 5" on a van that holds 15 is a typo, and the
     * consequence of accepting it is a driver vanishing from every customer's
     * shortlist for the rest of the day with nothing saying why.
     */
    describe("while the truck is out", () => {
      async function truckOnTheRoadWithBags() {
        const driver = await makeDriver("Nina Petrov");
        const truck = await makeTruck("Van Live", 20);
        const shift = await startShift(config, {
          staffUserId: driver,
          truckId: truck.id,
        });
        // Two bookings of two bags each: four aboard.
        await pickupOnShift(shift.shift.id, driver, "assigned");
        await pickupOnShift(shift.shift.id, driver, "assigned");
        return truck;
      }

      it("refuses a capacity that would leave less room than the bags aboard", async () => {
        const truck = await truckOnTheRoadWithBags();
        await expect(updateTruck(db, { id: truck.id, bagCapacity: 3 })).rejects.toThrow(
          /4 bags committed/i,
        );
      });

      it("names the numbers, so a typo is obvious", async () => {
        const truck = await truckOnTheRoadWithBags();
        await expect(
          updateTruck(db, { id: truck.id, bagCapacity: 6, reservedSpaces: 5 }),
        ).rejects.toThrow(/6 capacity minus 5 reserved leaves only 1/i);
      });

      it("allows a capacity that still covers them", async () => {
        const truck = await truckOnTheRoadWithBags();
        const ok = await updateTruck(db, { id: truck.id, bagCapacity: 4 });
        expect(ok.bagCapacity).toBe(4);
      });

      /* The name is not a capacity question and was never in doubt. */
      it("lets the name be corrected mid-shift", async () => {
        const truck = await truckOnTheRoadWithBags();
        const ok = await updateTruck(db, { id: truck.id, name: "Van Live II" });
        expect(ok.name).toBe("Van Live II");
      });

      /*
       * THE CORRECTION IS DEFERRED, NOT LOST — the rule only applies while a
       * shift is open, and that escape is named in the refusal.
       */
      it("accepts the same edit once the shift has ended", async () => {
        const driver = await makeDriver("Sam Okafor");
        const truck = await makeTruck("Van Parked", 20);
        const shift = await startShift(config, {
          staffUserId: driver,
          truckId: truck.id,
        });
        await pickupOnShift(shift.shift.id, driver, "assigned");
        await expect(updateTruck(db, { id: truck.id, bagCapacity: 1 })).rejects.toThrow(
          /committed/i,
        );

        await db
          .update(driverShifts)
          .set({ endedAt: now })
          .where(eq(driverShifts.id, shift.shift.id));

        const ok = await updateTruck(db, { id: truck.id, bagCapacity: 1 });
        expect(ok.bagCapacity).toBe(1);
      });

      /* A parked truck has nothing aboard to strand. */
      it("does not ask the question of a truck with no open shift", async () => {
        const truck = await makeTruck("Van Idle", 20);
        const ok = await updateTruck(db, { id: truck.id, bagCapacity: 1 });
        expect(ok.bagCapacity).toBe(1);
      });
    });

    it("refuses a reserve above the capacity", async () => {
      await expect(
        createTruck(db, { name: "Van Z", bagCapacity: 10, reservedSpaces: 11 }),
      ).rejects.toThrow(/nothing bookable/i);
    });

    it("accepts a reserve one below the capacity", async () => {
      const truck = await createTruck(db, {
        name: "Van Z",
        bagCapacity: 10,
        reservedSpaces: 9,
      });
      expect(truck.reservedSpaces).toBe(9);
    });

    it("refuses raising the reserve past an unchanged capacity", async () => {
      const truck = await createTruck(db, { name: "Van Z", bagCapacity: 10 });
      await expect(updateTruck(db, { id: truck.id, reservedSpaces: 10 })).rejects.toThrow(
        /nothing bookable/i,
      );
    });

    /**
     * The half a single-field check would miss. An edit form posts BOTH
     * numbers, and lowering the capacity under an existing reserve is the
     * same mistake arriving from the other direction.
     */
    it("refuses lowering the capacity under an existing reserve", async () => {
      const truck = await createTruck(db, {
        name: "Van Z",
        bagCapacity: 10,
        reservedSpaces: 6,
      });
      await expect(updateTruck(db, { id: truck.id, bagCapacity: 6 })).rejects.toThrow(
        /nothing bookable/i,
      );
      // …and the pair moving together is fine.
      const ok = await updateTruck(db, {
        id: truck.id,
        bagCapacity: 6,
        reservedSpaces: 2,
      });
      expect(ok.bagCapacity).toBe(6);
      expect(ok.reservedSpaces).toBe(2);
    });

    it("still refuses a negative reserve, with its own message", async () => {
      await expect(
        createTruck(db, { name: "Van Z", bagCapacity: 10, reservedSpaces: -1 }),
      ).rejects.toThrow(/cannot be negative/i);
    });
  });

  /* --- starting somebody else's shift ------------------------------- */

  /**
   * THE PAIR TO `adminForceEndShift`, which has existed since Tier 4.
   *
   * The console could take a driver OFF the road and not put one back on: a
   * dead phone, a locked-out account or an app that would not load meant
   * talking somebody through starting their own shift, or the van stayed
   * parked while every sealed booking in that zone read "needs a driver".
   *
   * The eligibility rules are not re-implemented — `adminStartShiftOnBehalf`
   * CALLS `startShift` — so these tests are as much about that as about the
   * feature: a second implementation is how the two would drift, and the one
   * that drifts is the one nobody drives every day.
   */
  describe("adminStartShiftOnBehalf", () => {
    it("opens the shift and stamps the admin who did it", async () => {
      const driver = await makeDriver("Nina Petrov");
      const truck = await createTruck(db, { name: "Van Z", bagCapacity: 20 });

      const shift = await adminStartShiftOnBehalf(config, {
        staffUserId: driver,
        truckId: truck.id,
        adminUserId: adminId,
      });

      expect(shift.shift.staffUserId).toBe(driver);
      expect(shift.shift.truckId).toBe(truck.id);
      expect(shift.shift.endedAt).toBeNull();
      expect(shift.shift.startedByUserId).toBe(adminId);
    });

    it("leaves startedByUserId NULL when the driver starts it themselves", async () => {
      const driver = await makeDriver("Nina Petrov");
      const truck = await createTruck(db, { name: "Van Z", bagCapacity: 20 });

      const shift = await startShift(config, {
        staffUserId: driver,
        truckId: truck.id,
      });
      // NULL is not "unknown" — it is the ordinary case, and it is what
      // distinguishes a self-start from an on-behalf one.
      expect(shift.shift.startedByUserId).toBeNull();
    });

    it("is visible to the driver's own app exactly like a self-start", async () => {
      const driver = await makeDriver("Nina Petrov");
      const truck = await createTruck(db, { name: "Van Z", bagCapacity: 20 });
      await adminStartShiftOnBehalf(config, {
        staffUserId: driver,
        truckId: truck.id,
        adminUserId: adminId,
      });

      // `getActiveShift` is what the field app's shift bar reads. Nothing
      // about the origin of the shift changes what the driver sees.
      const active = await getActiveShift(db, driver);
      expect(active).not.toBeNull();
      expect(active!.truck.name).toBe("Van Z");
      expect(active!.bagsOnBoard).toBe(0);
    });

    describe("the same eligibility as a self-start", () => {
      it("refuses somebody who is not cleared to drive", async () => {
        const notDriver = await makeDriver("Sam Ops", { canDrive: false });
        const truck = await createTruck(db, { name: "Van Z", bagCapacity: 20 });
        await expect(
          adminStartShiftOnBehalf(config, {
            staffUserId: notDriver,
            truckId: truck.id,
            adminUserId: adminId,
          }),
        ).rejects.toThrow(/not cleared to drive/i);
      });

      it("refuses a truck that is out of service", async () => {
        const driver = await makeDriver("Nina Petrov");
        const truck = await createTruck(db, { name: "Van Z", bagCapacity: 20 });
        await updateTruck(db, { id: truck.id, active: false });
        await expect(
          adminStartShiftOnBehalf(config, {
            staffUserId: driver,
            truckId: truck.id,
            adminUserId: adminId,
          }),
        ).rejects.toThrow(/out of service/i);
      });

      it("refuses a driver who is already out, in the THIRD person", async () => {
        const driver = await makeDriver("Nina Petrov");
        const a = await createTruck(db, { name: "Van A", bagCapacity: 20 });
        const b = await createTruck(db, { name: "Van B", bagCapacity: 20 });
        await startShift(config, { staffUserId: driver, truckId: a.id });

        // `startShift` says "You are already on shift…", which an admin
        // reading about somebody else has to translate.
        await expect(
          adminStartShiftOnBehalf(config, {
            staffUserId: driver,
            truckId: b.id,
            adminUserId: adminId,
          }),
        ).rejects.toThrow(/They are already on shift with Van A/);
      });

      it("refuses a truck somebody else has, naming them", async () => {
        const nina = await makeDriver("Nina Petrov");
        const other = await makeDriver("Alex Kim");
        const truck = await createTruck(db, { name: "Van A", bagCapacity: 20 });
        await startShift(config, { staffUserId: other, truckId: truck.id });

        await expect(
          adminStartShiftOnBehalf(config, {
            staffUserId: nina,
            truckId: truck.id,
            adminUserId: adminId,
          }),
        ).rejects.toThrow(/already out with Alex Kim/);
      });
    });

    /**
     * TWO STARTS AT ONCE. The freeness check is the database's, not ours:
     * both calls pass any SELECT either could write, and only the partial
     * unique index refuses the second (23505). This is the same guarantee
     * self-start has; it must not be weaker because an admin pressed it.
     */
    it("two concurrent on-behalf starts produce exactly one shift", async () => {
      const driver = await makeDriver("Nina Petrov");
      const a = await createTruck(db, { name: "Van A", bagCapacity: 20 });
      const b = await createTruck(db, { name: "Van B", bagCapacity: 20 });

      const outcomes = await Promise.allSettled([
        adminStartShiftOnBehalf(config, {
          staffUserId: driver,
          truckId: a.id,
          adminUserId: adminId,
        }),
        adminStartShiftOnBehalf(config, {
          staffUserId: driver,
          truckId: b.id,
          adminUserId: adminId,
        }),
      ]);

      expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
      const lost = outcomes.find((o) => o.status === "rejected");
      expect((lost as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError);

      const open = await db
        .select()
        .from(driverShifts)
        .where(eq(driverShifts.staffUserId, driver));
      expect(open).toHaveLength(1);
    });

    it("lists cleared drivers, saying which are already out", async () => {
      const free = await makeDriver("Nina Petrov");
      const busy = await makeDriver("Alex Kim");
      await makeDriver("Sam Ops", { canDrive: false });
      const truck = await createTruck(db, { name: "Van A", bagCapacity: 20 });
      await startShift(config, { staffUserId: busy, truckId: truck.id });

      const options = await listOnBehalfDriverOptions(db);
      const ids = options.map((o) => o.staffUserId);
      // `can_drive: false` is a /staff task, not a picker entry.
      expect(ids).toHaveLength(2);
      expect(ids).toContain(free);
      expect(ids).toContain(busy);
      // Shown, not hidden — a missing name teaches nothing.
      expect(options.find((o) => o.staffUserId === busy)!.activeShiftTruckName).toBe(
        "Van A",
      );
      expect(
        options.find((o) => o.staffUserId === free)!.activeShiftTruckName,
      ).toBeNull();
    });
  });
});
