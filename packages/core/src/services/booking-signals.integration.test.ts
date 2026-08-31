import { fileURLToPath } from "node:url";
import path from "node:path";

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  agreementVersions,
  airlineCutoffs,
  airports,
  bookingSignals,
  createDb,
  driverShifts,
  pickupTasks,
  pricingRules,
  staffMembers,
  trucks,
  users,
  type Booking,
  type Database,
} from "@koolee/db";

import { createCoreConfig, systemClock, type CoreConfig } from "../config";
import { FakePaymentProvider } from "../payments/fake";
import { TEST_AIRPORTS } from "../test-utils/airport-fixtures";
import { acceptAgreement } from "./agreements";
import { applyTransition } from "./bookings";
import { createBooking } from "./create-booking";
import { ensureAddress } from "./customers";
import { recordDriverPosition } from "./driver-selection";
import { getBookingSignal, latestSignalFor, touchBookingSignal } from "./booking-signals";

/**
 * The doorbell, proved against a real database.
 *
 * `booking-signals.test.ts` asserts the migration says the right things. This
 * asserts the database DOES them: that a transition moves the row, that an
 * agreement acceptance moves it without any service knowing the table exists,
 * that one write moves it once, and — the property the whole design rests on —
 * that touching one booking never touches another.
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIntegration = TEST_DATABASE_URL ? describe : describe.skip;

if (!TEST_DATABASE_URL) {
  console.log("[integration] TEST_DATABASE_URL not set — skipping signal tests.");
}

const migrationsFolder = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../db/drizzle",
);

const HOUR = 3_600_000;

describeIntegration("booking signals (integration)", () => {
  let sqlClient: ReturnType<typeof postgres>;
  let db: Database;
  let config: CoreConfig;
  let customerId: string;

  const departureAt = new Date(Date.now() + 48 * HOUR);
  /**
   * Windows are CLOCK-ALIGNED hours (slots/windows.ts), so an arbitrary
   * instant 20 hours out is `not_a_window`. Floor to the hour, as the
   * enumerator does.
   */
  const windowEnd = new Date(
    Math.floor((departureAt.getTime() - 20 * HOUR) / HOUR) * HOUR,
  );

  beforeAll(async () => {
    sqlClient = postgres(TEST_DATABASE_URL!, { max: 1, prepare: false });
    await migrate(drizzle(sqlClient), { migrationsFolder });
    db = createDb({ url: TEST_DATABASE_URL!, max: 5 });
    config = createCoreConfig({
      db,
      payments: new FakePaymentProvider(),
      clock: systemClock,
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
      DELETE FROM driver_positions;
      DELETE FROM pickup_tasks;
      DELETE FROM verification_tasks;
      DELETE FROM driver_shifts;
      DELETE FROM trucks;
      DELETE FROM staff_members;
      DELETE FROM payments;
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
      .values({ phone: "+15551190001", role: "customer" })
      .returning();
    customerId = customer!.id;
  });

  async function newBooking(): Promise<Booking> {
    const address = await ensureAddress(db, customerId, {
      line1: "1 Signal St",
      city: "New York",
      state: "NY",
      zip: "10001",
    });
    const { booking } = await createBooking(config, {
      userId: customerId,
      pickupAddressId: address.id,
      quotedZip: address.zip,
      pickupWindowStart: new Date(windowEnd.getTime() - HOUR),
      pickupWindowEnd: windowEnd,
      flightNumber: "DL123",
      airlineIata: "DL",
      departureAirport: "JFK",
      departureAt,
      scope: "domestic",
      paxName: "Signal Customer",
      bagCount: 1,
      distanceKm: 20,
    });
    return booking;
  }

  const signalAt = async (bookingId: string) =>
    (await getBookingSignal(db, bookingId))?.updatedAt ?? null;

  const rowCount = async (bookingId: string) =>
    (
      await db
        .select()
        .from(bookingSignals)
        .where(eq(bookingSignals.bookingId, bookingId))
    ).length;

  /* ---------------------------------------------------------------- */
  /* Created, then moved                                               */
  /* ---------------------------------------------------------------- */

  it("creates exactly one signal row for a new booking", async () => {
    const booking = await newBooking();
    // `createBooking` appends a custody event, so the trigger has already
    // fired — no service had to remember anything.
    expect(await rowCount(booking.id)).toBe(1);
    expect(await signalAt(booking.id)).toBeInstanceOf(Date);
  });

  it("moves the signal on a state transition, and still holds ONE row", async () => {
    const booking = await newBooking();
    const before = await signalAt(booking.id);

    const moved = await applyTransition(config, {
      bookingId: booking.id,
      event: "assign_agent",
    });
    expect(moved.ok).toBe(true);

    const after = await signalAt(booking.id);
    expect(after!.getTime()).toBeGreaterThan(before!.getTime());
    // "Exactly once" is a property of the ROW, not of a counter: the upsert
    // overwrites, so a transition can never leave two doorbells behind.
    expect(await rowCount(booking.id)).toBe(1);
  });

  it("records who caused it", async () => {
    const booking = await newBooking();
    await applyTransition(config, {
      bookingId: booking.id,
      event: "assign_agent",
      actor: { userId: customerId, role: "customer" },
    });
    expect((await getBookingSignal(db, booking.id))?.touchedBy).toBe(customerId);
  });

  /* ---------------------------------------------------------------- */
  /* The services that never heard of this table                       */
  /* ---------------------------------------------------------------- */

  it("moves on an agreement acceptance, which knows nothing about signals", async () => {
    const booking = await newBooking();
    const before = await signalAt(booking.id);

    const result = await acceptAgreement(config, {
      bookingId: booking.id,
      userId: customerId,
    });
    expect(result.created).toBe(true);

    expect((await signalAt(booking.id))!.getTime()).toBeGreaterThan(before!.getTime());
  });

  /* ---------------------------------------------------------------- */
  /* Isolation — the property the RLS design rests on                  */
  /* ---------------------------------------------------------------- */

  it("never touches another booking's signal", async () => {
    const a = await newBooking();
    const b = await newBooking();
    const bBefore = await signalAt(b.id);

    await applyTransition(config, { bookingId: a.id, event: "assign_agent" });

    expect((await signalAt(b.id))!.getTime()).toBe(bBefore!.getTime());
  });

  /* ---------------------------------------------------------------- */
  /* The one explicit writer                                           */
  /* ---------------------------------------------------------------- */

  it("rings for the bookings a driver is carrying when they ping their position", async () => {
    const booking = await newBooking();

    const [driver] = await db
      .insert(users)
      .values({ email: "driver-signal@koolee.test", role: "agent" })
      .returning();
    await db
      .insert(staffMembers)
      .values({ userId: driver!.id, role: "agent", active: true, canDrive: true });
    const [truck] = await db
      .insert(trucks)
      .values({ name: "Signal Van", bagCapacity: 10, active: true })
      .returning();
    const [shift] = await db
      .insert(driverShifts)
      .values({ staffUserId: driver!.id, truckId: truck!.id })
      .returning();
    await db.insert(pickupTasks).values({
      bookingId: booking.id,
      assigneeUserId: driver!.id,
      driverShiftId: shift!.id,
      status: "assigned",
    });

    const before = await signalAt(booking.id);
    // A GPS ping appends NO custody event on purpose — a position is not
    // evidence — so this is the one path the trigger cannot cover.
    await recordDriverPosition(config, {
      staffUserId: driver!.id,
      lat: 40.7,
      lng: -73.99,
    });

    expect((await signalAt(booking.id))!.getTime()).toBeGreaterThan(before!.getTime());
  });

  it("touchBookingSignal never throws on a booking that does not exist", async () => {
    // The contract: a lost signal delays a refresh by the poll interval and
    // loses nothing else. It must never fail the work that caused it.
    await expect(
      touchBookingSignal(db, { bookingId: "00000000-0000-0000-0000-000000000000" }),
    ).resolves.toBeUndefined();
  });

  /* ---------------------------------------------------------------- */
  /* The polling fallback's question                                   */
  /* ---------------------------------------------------------------- */

  it("latestSignalFor returns the newest across a set, and null for none", async () => {
    const a = await newBooking();
    const b = await newBooking();
    await applyTransition(config, { bookingId: b.id, event: "assign_agent" });

    const latest = await latestSignalFor(db, [a.id, b.id]);
    expect(latest!.getTime()).toBe((await signalAt(b.id))!.getTime());
    expect(await latestSignalFor(db, [])).toBeNull();
  });

  it("takes the signal with the booking when the booking is deleted", async () => {
    const booking = await newBooking();
    // The custody trigger refuses DELETE (0001), and payments carry an FK, so
    // the teardown mirrors what `beforeEach` does: replica mode for the
    // append-only guard, dependants first, then the booking itself under the
    // real constraints — which is what makes the CASCADE below a real result.
    await sqlClient.unsafe(
      `SET session_replication_role = replica;
       DELETE FROM custody_events WHERE booking_id = '${booking.id}';
       DELETE FROM payments WHERE booking_id = '${booking.id}';
       DELETE FROM bags WHERE booking_id = '${booking.id}';
       SET session_replication_role = DEFAULT;`,
    );
    await sqlClient.unsafe(`DELETE FROM bookings WHERE id = '${booking.id}'`);
    expect(await rowCount(booking.id)).toBe(0);
  });
});
