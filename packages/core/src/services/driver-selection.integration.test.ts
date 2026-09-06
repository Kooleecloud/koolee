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
  driverPositions,
  driverShifts,
  pickupTasks,
  staffMembers,
  trucks,
  users,
  type Database,
  type Address,
} from "@koolee/db";

import { createCoreConfig, fixedClock, type CoreConfig } from "../config";
import { BookingNotActionableError, ConflictError } from "../errors";
import { FakePaymentProvider } from "../payments/fake";
import { TEST_AIRPORTS } from "../test-utils/airport-fixtures";
import { pickupSnapshotOf } from "../test-utils/booking-fixtures";
import { ensureAddress } from "./customers";
import {
  adminUnassignPickup,
  getSelectedDriver,
  POSITION_FRESH_MS,
  listCandidateDrivers,
  listReassignOptions,
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
  console.log(
    "[integration] TEST_DATABASE_URL not set — skipping driver-selection tests.",
  );
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
  let pickupAddress: Address;
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
      DELETE FROM airline_cutoffs;
      SET session_replication_role = DEFAULT;
    `);

    await db.insert(airports).values(TEST_AIRPORTS.JFK);

    /*
     * THE CUTOFF THIS FILE'S TWO "bag drop has closed" TESTS DEPEND ON.
     *
     * It was never inserted here. `airline_cutoffs` is not in the wipe list
     * above either, so those tests passed only on a database where some OTHER
     * suite had already inserted a DL/JFK row and left it behind —
     * `agent-visit.integration.test.ts` seeds exactly this one in its
     * `beforeAll`. Run this file first, or on a genuinely fresh database, and
     * `resolveCutoffMinutes` finds nothing, `phaseOf` never reaches
     * `missed_cutoff`, and `listCandidateDrivers` cheerfully offers a driver
     * for a flight whose bag drop has closed.
     *
     * Found by pointing the tier at a brand-new container — which is exactly
     * what CI does on every run, so this would have gone red on the first one
     * for a reason that has nothing to do with any feature. The table is
     * wiped and re-seeded here now, so the file is self-sufficient.
     */
    await db.insert(airlineCutoffs).values({
      airlineIata: "DL",
      airportCode: "JFK",
      scope: "domestic",
      cutoffMinutesBeforeDeparture: 45,
      effectiveFrom: new Date("2024-01-01T00:00:00Z"),
    });

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
    pickupAddress = address;
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

  async function makeTruck(
    name: string,
    bagCapacity: number,
    active = true,
    reservedSpaces = 0,
  ) {
    const [row] = await db
      .insert(trucks)
      .values({ name, bagCapacity, active, reservedSpaces })
      .returning();
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
        ...pickupSnapshotOf(pickupAddress),
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
      // No position pinged yet — a real state, rendered as "Locating…".
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

  /**
   * `now` is 2025-06-10T10:00Z and the flight leaves 2025-06-12T22:00Z, so
   * the DL/JFK cutoff (45 minutes) falls at 21:15Z on the 12th.
   */
  const pastCutoff = () =>
    createCoreConfig({
      db,
      payments: new FakePaymentProvider(),
      clock: fixedClock(new Date("2025-06-12T21:30:00Z")),
    });

  it("refuses to shortlist once the airline's bag drop has closed", async () => {
    // A shortlist is an offer. Offering one here asks the customer to choose
    // a driver who cannot make the flight.
    const verifier = await makeDriver("Verifier", { canDrive: false });
    const { booking } = await sealedBooking(2, verifier);
    await makeDriver("Tara");

    const error = await listCandidateDrivers(pastCutoff(), {
      bookingId: booking.id,
    }).then(
      () => null,
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(BookingNotActionableError);
    expect(
      (await db.query.bookings.findFirst({ where: eq(bookings.id, booking.id) }))!.status,
    ).toBe("exception");
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

  it("refuses to select once the airline's bag drop has closed", async () => {
    // Checked at submit as well as at render: a shortlist drawn before the
    // cutoff is still on screen after it, and the POST is reachable.
    const verifier = await makeDriver("Verifier", { canDrive: false });
    const { booking } = await sealedBooking(2, verifier);
    const driver = await makeDriver("Tara");
    const truck = await makeTruck("Late Van", 30);
    const { shift } = await startShift(config, {
      staffUserId: driver,
      truckId: truck.id,
    });

    await expect(
      selectDriver(pastCutoff(), {
        bookingId: booking.id,
        userId: customerId,
        shiftId: shift.id,
      }),
    ).rejects.toBeInstanceOf(BookingNotActionableError);
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
    expect(task).toMatchObject({
      driverShiftId: shiftB.shift.id,
      assigneeUserId: second,
    });

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
    // Five spaces with TWO HELD BACK, so three are bookable — and two
    // customers wanting two bags each. Only one can fit, and the reserve is
    // what makes that true: on raw capacity both would have fitted.
    //
    // The race is what this proves. `bookableSpaces` is applied inside the
    // transaction, under the advisory lock, so the loser is refused by the
    // recount rather than by a filter that ran before either click.
    const truck = await makeTruck("Van A", 5, true, 2);
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

  /* --- the reserve -------------------------------------------------- */

  /**
   * `reserved_spaces` HELD BACK FROM BOOKING CAPACITY.
   *
   * The column existed since Tier 4, the admin form edited it, and it was
   * labelled "not yet enforced" because every capacity check read
   * `bag_capacity` raw. An operator holding two spaces back for a wheelchair
   * or a fragile case had a van that kept accepting bookings into them.
   *
   * Four readers share one formula now, and all four are exercised here — the
   * shortlist filter, the candidate it renders, the transactional recheck
   * under the advisory lock, and the console's reassign picker. A reserve
   * honoured in three of four is a race no unit test could see.
   */
  describe("reserved spaces", () => {
    it("keeps a driver off the shortlist when the reserve leaves too little", async () => {
      const verifier = await makeDriver("Verifier", { canDrive: false });
      const driver = await makeDriver("Nina Petrov", { zip: pickupAddress.zip });
      // Ten spaces, eight held back: two bookable, and this booking is three.
      const truck = await makeTruck("Van A", 10, true, 8);
      await startShift(config, { staffUserId: driver, truckId: truck.id });

      const { booking } = await sealedBooking(3, verifier);
      const candidates = await listCandidateDrivers(config, { bookingId: booking.id });
      expect(candidates).toHaveLength(0);
    });

    it("reports availableCapacity net of the reserve, not the raw capacity", async () => {
      const verifier = await makeDriver("Verifier", { canDrive: false });
      const driver = await makeDriver("Nina Petrov", { zip: pickupAddress.zip });
      const truck = await makeTruck("Van A", 10, true, 4);
      await startShift(config, { staffUserId: driver, truckId: truck.id });

      const { booking } = await sealedBooking(2, verifier);
      const [candidate] = await listCandidateDrivers(config, { bookingId: booking.id });
      expect(candidate!.bagCapacity).toBe(10);
      expect(candidate!.reservedSpaces).toBe(4);
      // Six bookable, none used yet.
      expect(candidate!.availableCapacity).toBe(6);
    });

    it("refuses a selection the reserve does not leave room for", async () => {
      const verifier = await makeDriver("Verifier", { canDrive: false });
      const driver = await makeDriver("Nina Petrov", { zip: pickupAddress.zip });
      const truck = await makeTruck("Van A", 10, true, 0);
      const shift = await startShift(config, { staffUserId: driver, truckId: truck.id });

      const { booking } = await sealedBooking(3, verifier);
      // The shortlist said yes; ops raises the reserve before the click lands.
      // This is the recheck under the lock, and it is the one that matters.
      await db.update(trucks).set({ reservedSpaces: 8 }).where(eq(trucks.id, truck.id));

      await expect(
        selectDriver(config, {
          bookingId: booking.id,
          userId: customerId,
          shiftId: shift.shift.id,
        }),
      ).rejects.toThrow(/filled up/);
    });

    it("marks a reserved-out truck as having no room in the reassign picker", async () => {
      const verifier = await makeDriver("Verifier", { canDrive: false });
      const driver = await makeDriver("Nina Petrov", { zip: pickupAddress.zip });
      const truck = await makeTruck("Van A", 10, true, 9);
      await startShift(config, { staffUserId: driver, truckId: truck.id });

      const { booking } = await sealedBooking(3, verifier);
      const [option] = await listReassignOptions(db, booking.id);
      expect(option!.reservedSpaces).toBe(9);
      expect(option!.hasRoom).toBe(false);
    });

    it("still offers a driver when the reserve leaves exactly enough", async () => {
      const verifier = await makeDriver("Verifier", { canDrive: false });
      const driver = await makeDriver("Nina Petrov", { zip: pickupAddress.zip });
      // Boundary: 10 − 7 = 3 bookable, and the booking is exactly 3.
      const truck = await makeTruck("Van A", 10, true, 7);
      const shift = await startShift(config, { staffUserId: driver, truckId: truck.id });

      const { booking } = await sealedBooking(3, verifier);
      expect(await listCandidateDrivers(config, { bookingId: booking.id })).toHaveLength(
        1,
      );
      const result = await selectDriver(config, {
        bookingId: booking.id,
        userId: customerId,
        shiftId: shift.shift.id,
      });
      expect(result.candidate.availableCapacity).toBe(0);
    });
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

  /*
   * THE SAME RULE, ON THE SHORTLIST — which did not have it.
   *
   * The tracking card has asked "is this fresh?" since the map shipped; the
   * shortlist read `driver_positions` raw. That was survivable while the pins
   * were a nicety beside a list somebody actually chose from. In F5 the map
   * BECAME the chooser, so a pin is a claim about where a van is — and a
   * driver who finished a run yesterday still has yesterday's row, because
   * `recordDriverPosition` overwrites one mutable row per driver and keeps no
   * history.
   *
   * The ETA goes with it, and that half matters more: a pin drawn on the wrong
   * street is misleading, but "about 15 min" computed from it is the number
   * `bestCandidate` ranks on.
   */
  it("drops a stale position from the shortlist, pin and ETA together", async () => {
    const verifier = await makeDriver("Shortlist Verifier", { canDrive: false });
    const driver = await makeDriver("Rosa Marin");
    const truck = await makeTruck("Van Stale", 30);
    await startShift(config, { staffUserId: driver, truckId: truck.id });
    await recordDriverPosition(config, {
      staffUserId: driver,
      lat: 40.71277,
      lng: -73.95371,
    });

    const { booking } = await sealedBooking(2, verifier);

    // Fresh: a pin and an estimate.
    const [live] = await listCandidateDrivers(config, { bookingId: booking.id });
    expect(live!.position).not.toBeNull();
    expect(live!.eta).not.toBeNull();

    // The same driver, read past the window. Still perfectly choosable — the
    // CARD remains, which is why the list is not a fallback — but nothing is
    // drawn and nothing is estimated.
    const later = createCoreConfig({
      db,
      payments: new FakePaymentProvider(),
      clock: fixedClock(new Date(now.getTime() + POSITION_FRESH_MS + 1_000)),
    });
    const [stale] = await listCandidateDrivers(later, { bookingId: booking.id });
    expect(stale!.shiftId).toBe(live!.shiftId);
    expect(stale!.position).toBeNull();
    expect(stale!.eta).toBeNull();
  });

  it("a fix older than POSITION_FRESH_MS is reported as not fresh", async () => {
    /*
     * The case that put a van on the wrong street: `driver_positions` keeps
     * one mutable row per driver and no history, so a driver chosen but not
     * yet set off still has yesterday's position on file. The map must not
     * draw it as current.
     */
    const verifier = await makeDriver("Stale Verifier", { canDrive: false });
    const driver = await makeDriver("Omar Diaz");
    const truck = await makeTruck("Van S", 30);
    const shift = await startShift(config, { staffUserId: driver, truckId: truck.id });
    const { booking } = await sealedBooking(2, verifier);
    await selectDriver(config, {
      bookingId: booking.id,
      userId: customerId,
      shiftId: shift.shift.id,
    });
    await recordDriverPosition(config, { staffUserId: driver, ...MIDTOWN });

    // The suite's `now`, not the wall clock: `recordDriverPosition` stamps
    // `recorded_at` from `config.clock`, which is fixed at 2025-06-10 here.
    // Comparing that against a real `new Date()` makes every fix look years
    // stale — which is what this assertion caught on its first run.
    const fresh = await getSelectedDriver(db, booking.id, now);
    expect(fresh?.positionIsFresh).toBe(true);
    expect(fresh?.position).toEqual(MIDTOWN);

    const later = new Date(now.getTime() + POSITION_FRESH_MS + 1_000);
    const stale = await getSelectedDriver(db, booking.id, later);
    // The position is still KNOWN — it is simply too old to present as where
    // the driver is, and the caller is the one that drops it.
    expect(stale?.position).toEqual(MIDTOWN);
    expect(stale?.positionIsFresh).toBe(false);
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

  /* --- removing a driver -------------------------------------------- */

  /**
   * TAKING THE DRIVER OFF, rather than moving the pickup to another one.
   *
   * The console could only ever MOVE a pickup between shifts, so an admin
   * undoing an assignment — a driver called in sick, a van broke down, the
   * customer picked somebody who then clocked off — had to park the booking
   * on some OTHER driver who was not going to do it either. That is a lie
   * told to the dispatch board, and the board is what decides who gets
   * chased. An unassigned sealed booking is not a gap in the record; it is
   * exactly what the at-risk flag exists to surface.
   */
  describe("adminUnassignPickup", () => {
    async function assignedBooking() {
      const verifier = await makeDriver("Verifier", { canDrive: false });
      const driver = await makeDriver("Nina Petrov", { zip: pickupAddress.zip });
      const truck = await makeTruck("Van A", 30);
      const shift = await startShift(config, { staffUserId: driver, truckId: truck.id });
      const { booking, task } = await sealedBooking(2, verifier);
      await selectDriver(config, {
        bookingId: booking.id,
        userId: customerId,
        shiftId: shift.shift.id,
      });
      return { booking, task, shift, driver };
    }

    it("clears the shift, the assignee and the start, and returns the task to pending", async () => {
      const { booking, shift } = await assignedBooking();

      const result = await adminUnassignPickup(config, {
        bookingId: booking.id,
        adminUserId: customerId,
      });
      expect(result.releasedShiftId).toBe(shift.shift.id);

      const [task] = await db
        .select()
        .from(pickupTasks)
        .where(eq(pickupTasks.bookingId, booking.id));
      expect(task!.driverShiftId).toBeNull();
      expect(task!.assigneeUserId).toBeNull();
      expect(task!.status).toBe("pending");
      // A cleared run has not started. A stale `started_at` would make the
      // customer's page claim somebody is on the way who is not.
      expect(task!.startedAt).toBeNull();
    });

    it("writes the removal to the custody trail, with the reason when given", async () => {
      const { booking } = await assignedBooking();
      await adminUnassignPickup(config, {
        bookingId: booking.id,
        adminUserId: customerId,
        reason: "Called in sick",
      });

      const events = await db
        .select()
        .from(custodyEvents)
        .where(eq(custodyEvents.bookingId, booking.id));
      const removal = events.find((e) => e.eventType === PICKUP_EVENT_TYPES.unassigned);
      expect(removal).toBeDefined();
      expect(removal!.actorRole).toBe("admin");
      expect((removal!.metadata as Record<string, unknown>)["reason"]).toBe(
        "Called in sick",
      );
    });

    it("puts the booking back on the customer's shortlist", async () => {
      const { booking } = await assignedBooking();
      await adminUnassignPickup(config, {
        bookingId: booking.id,
        adminUserId: customerId,
      });
      // The driver is free again and the customer can choose — which is the
      // whole point of releasing rather than parking it on somebody else.
      const candidates = await listCandidateDrivers(config, { bookingId: booking.id });
      expect(candidates.length).toBeGreaterThan(0);
    });

    /**
     * THE REFUSAL TD CHOSE. Once the bags are in the van, re-listing the
     * booking for another driver to collect from a door they have left would
     * be a lie of a different kind. `adminForceEndShift` handles that case by
     * raising an EXCEPTION, which pages ops; this names that route rather
     * than quietly doing something exceptional under a routine button.
     */
    it("refuses once the bags are in the van, and names force-end instead", async () => {
      const { booking } = await assignedBooking();
      await db
        .update(bookings)
        .set({ status: "in_transit" })
        .where(eq(bookings.id, booking.id));

      await expect(
        adminUnassignPickup(config, {
          bookingId: booking.id,
          adminUserId: customerId,
        }),
      ).rejects.toThrow(/already in this driver's van/i);
      await expect(
        adminUnassignPickup(config, {
          bookingId: booking.id,
          adminUserId: customerId,
        }),
      ).rejects.toThrow(/force-end/i);
    });

    /**
     * "Nothing to remove" means BOTH halves are already empty.
     *
     * A task can carry an `assignee_user_id` with no `driver_shift_id` —
     * that is exactly the state `auto-assign` leaves it in before the
     * customer has chosen a driver — and removing that assignee is a real
     * act, so it must not be refused. Only a task that is empty on both
     * counts has nothing to give up. (This test asserted the wrong thing
     * first: it used a fresh sealed booking, whose fixture DOES set an
     * assignee, and the service correctly unassigned it.)
     */
    it("removes a lone assignee even when no shift owns the task", async () => {
      const verifier = await makeDriver("Verifier", { canDrive: false });
      const { booking } = await sealedBooking(2, verifier);

      const result = await adminUnassignPickup(config, {
        bookingId: booking.id,
        adminUserId: customerId,
      });
      expect(result.releasedShiftId).toBeNull();
      expect((await taskFor(booking.id))!.assigneeUserId).toBeNull();
    });

    it("refuses when nobody is assigned at all — there is nothing to remove", async () => {
      const verifier = await makeDriver("Verifier", { canDrive: false });
      const { booking } = await sealedBooking(2, verifier);
      await db
        .update(pickupTasks)
        .set({ assigneeUserId: null, driverShiftId: null, status: "pending" })
        .where(eq(pickupTasks.bookingId, booking.id));

      await expect(
        adminUnassignPickup(config, {
          bookingId: booking.id,
          adminUserId: customerId,
        }),
      ).rejects.toThrow(/nothing to remove/i);
    });
  });
});
