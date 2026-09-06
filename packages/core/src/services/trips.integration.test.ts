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
  bookings,
  createDb,
  pickupTasks,
  pricingRules,
  users,
  type Booking,
  type Database,
} from "@koolee/db";

import { createCoreConfig, fixedClock, type CoreConfig } from "../config";
import { FakePaymentProvider } from "../payments/fake";
import { TEST_AIRPORTS } from "../test-utils/airport-fixtures";
import { acceptAgreement } from "./agreements";
import { applyTransition } from "./bookings";
import { createBooking } from "./create-booking";
import { ensureAddress } from "./customers";
import { listCustomerTrips } from "./trips";
import type { CustomerSession } from "../auth/types";

/**
 * The trips home, proved against a database.
 *
 * Three claims worth a real Postgres: that Upcoming and Past split on
 * ACTIONABILITY rather than on status (a `paid` booking for yesterday's plane
 * is past); that needs come from the same gates the trip page uses, so a
 * booking that cannot be acted on asks for nothing; and that one customer
 * never sees another's trips.
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIntegration = TEST_DATABASE_URL ? describe : describe.skip;

if (!TEST_DATABASE_URL) {
  console.log("[integration] TEST_DATABASE_URL not set — skipping trips tests.");
}

const migrationsFolder = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../db/drizzle",
);

const HOUR = 3_600_000;

describeIntegration("listCustomerTrips (integration)", () => {
  let sqlClient: ReturnType<typeof postgres>;
  let db: Database;
  let config: CoreConfig;
  let customerId: string;
  let session: CustomerSession;

  /** Booking time. The cutoff below is 45 minutes before departure. */
  const now = new Date("2026-06-10T10:00:00Z");
  const departureAt = new Date("2026-06-12T22:00:00Z");

  const at = (instant: Date): CoreConfig =>
    createCoreConfig({
      db,
      payments: new FakePaymentProvider(),
      clock: fixedClock(instant),
    });

  beforeAll(async () => {
    sqlClient = postgres(TEST_DATABASE_URL!, { max: 1, prepare: false });
    await migrate(drizzle(sqlClient), { migrationsFolder });
    db = createDb({ url: TEST_DATABASE_URL!, max: 5 });
  });

  afterAll(async () => {
    await sqlClient?.end();
  });

  beforeEach(async () => {
    config = at(now);

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
      .values({ phone: "+15551200001", role: "customer" })
      .returning();
    customerId = customer!.id;
    session = {
      kind: "customer",
      userId: customerId,
      role: "customer",
      phone: "+15551200001",
    };
  });

  async function paidBooking(over: { departureAt?: Date } = {}): Promise<Booking> {
    const departure = over.departureAt ?? departureAt;
    const end = new Date(Math.floor((departure.getTime() - 20 * HOUR) / HOUR) * HOUR);
    const address = await ensureAddress(db, customerId, {
      line1: "1 Trip St",
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
      departureAt: departure,
      scope: "domestic",
      paxName: "Trip Customer",
      bagCount: 1,
      distanceKm: 20,
    });
    return booking;
  }

  /* ---------------------------------------------------------------- */
  /* The split                                                         */
  /* ---------------------------------------------------------------- */

  it("puts a live booking in Upcoming", async () => {
    const booking = await paidBooking();
    const trips = await listCustomerTrips(db, session, now);

    expect(trips.upcoming.map((t) => t.booking.id)).toEqual([booking.id]);
    expect(trips.past).toHaveLength(0);
  });

  it("moves a booking to Past once its FLIGHT has gone, whatever its status says", async () => {
    // A `paid` booking for yesterday's plane is not upcoming. Leaving it at
    // the top of the list is how a history list becomes untrustworthy.
    const booking = await paidBooking();
    const trips = await listCustomerTrips(
      db,
      session,
      new Date(departureAt.getTime() + HOUR),
    );

    expect(trips.upcoming).toHaveLength(0);
    expect(trips.past.map((t) => t.booking.id)).toEqual([booking.id]);
    expect(trips.past[0]!.actionability.phase).toBe("departed");
  });

  it("keeps a booking whose bags are IN TRANSIT in Upcoming past departure", async () => {
    /*
     * The case the old `terminal || departed` rule got wrong, and the one that
     * matters most: a customer whose driver is holding their bags right now
     * watched the trip drop out of Upcoming the moment the plane left. The
     * live thing on their screen moved to the history list while it was still
     * happening.
     */
    const booking = await paidBooking();
    await db
      .update(bookings)
      .set({ status: "in_transit" })
      .where(eq(bookings.id, booking.id));

    const trips = await listCustomerTrips(
      db,
      session,
      new Date(departureAt.getTime() + HOUR),
    );

    expect(trips.upcoming.map((t) => t.booking.id)).toEqual([booking.id]);
    expect(trips.past).toHaveLength(0);
  });

  it("keeps a booking in EXCEPTION in Upcoming past departure", async () => {
    // Somebody is actively sorting this out and the customer is the person
    // waiting to hear. Filing it under history says the opposite.
    const booking = await paidBooking();
    await db
      .update(bookings)
      .set({ status: "exception" })
      .where(eq(bookings.id, booking.id));

    const trips = await listCustomerTrips(
      db,
      session,
      new Date(departureAt.getTime() + HOUR),
    );

    expect(trips.upcoming.map((t) => t.booking.id)).toEqual([booking.id]);
  });

  it("moves an in-transit booking to Past the moment it completes", async () => {
    // Active until done — then done, whatever the clock says.
    const booking = await paidBooking();
    await db
      .update(bookings)
      .set({ status: "completed" })
      .where(eq(bookings.id, booking.id));

    const trips = await listCustomerTrips(db, session, now);
    expect(trips.upcoming).toHaveLength(0);
    expect(trips.past.map((t) => t.booking.id)).toEqual([booking.id]);
  });

  it("moves a cancelled booking to Past immediately", async () => {
    const booking = await paidBooking();
    const moved = await applyTransition(config, {
      bookingId: booking.id,
      event: "cancel",
    });
    expect(moved.ok).toBe(true);

    const trips = await listCustomerTrips(db, session, now);
    expect(trips.upcoming).toHaveLength(0);
    expect(trips.past[0]!.actionability.standing).toBe("terminal");
  });

  it("orders Upcoming soonest first, not newest first", async () => {
    const later = await paidBooking({
      departureAt: new Date(departureAt.getTime() + 48 * HOUR),
    });
    const sooner = await paidBooking();

    const trips = await listCustomerTrips(db, session, now);
    expect(trips.upcoming.map((t) => t.booking.id)).toEqual([sooner.id, later.id]);
  });

  /* ---------------------------------------------------------------- */
  /* Needs — the same gates the trip page uses                         */
  /* ---------------------------------------------------------------- */

  it("asks for the agreement until it is accepted", async () => {
    const booking = await paidBooking();
    let trips = await listCustomerTrips(db, session, now);
    expect(trips.upcoming[0]!.needs).toContain("accept_agreement");

    await acceptAgreement(config, { bookingId: booking.id, userId: customerId });

    trips = await listCustomerTrips(db, session, now);
    expect(trips.upcoming[0]!.needs).not.toContain("accept_agreement");
  });

  it("asks for the passport as an OPTIONAL last item", async () => {
    await paidBooking();
    const trips = await listCustomerTrips(db, session, now);
    const needs = trips.upcoming[0]!.needs;
    expect(needs).toContain("upload_passport");
    // Last, because it is the only one that does not block a pickup.
    expect(needs.at(-1)).toBe("upload_passport");
  });

  it("asks to choose a driver only once the shortlist is actually open", async () => {
    const booking = await paidBooking();
    await db.insert(pickupTasks).values({ bookingId: booking.id, status: "assigned" });

    // `paid` is not a driver-selectable status; nothing should ask yet.
    let trips = await listCustomerTrips(db, session, now);
    expect(trips.upcoming[0]!.needs).not.toContain("choose_driver");

    for (const event of ["assign_agent", "complete_verification"] as const) {
      const moved = await applyTransition(config, { bookingId: booking.id, event });
      expect(moved.ok, event).toBe(true);
    }

    trips = await listCustomerTrips(db, session, now);
    expect(trips.upcoming[0]!.booking.status).toBe("verified_sealed");
    expect(trips.upcoming[0]!.needs).toContain("choose_driver");
  });

  it("asks for NOTHING once the bag-drop cutoff has passed", async () => {
    // The gates are the same object the trip page reads. Asking somebody to
    // accept an agreement for a pickup that can no longer happen is worse
    // than saying nothing.
    await paidBooking();
    const pastCutoff = new Date(departureAt.getTime() - 30 * 60_000);
    const trips = await listCustomerTrips(db, session, pastCutoff);

    expect(trips.upcoming[0]!.actionability.phase).toBe("missed_cutoff");
    expect(trips.upcoming[0]!.needs).toEqual([]);
    expect(trips.upcoming[0]!.actionability.blockedReason).toBeTruthy();
  });

  /* ---------------------------------------------------------------- */
  /* Scoping and shape                                                 */
  /* ---------------------------------------------------------------- */

  it("never returns another customer's trips", async () => {
    await paidBooking();
    const [other] = await db
      .insert(users)
      .values({ phone: "+15551200002", role: "customer" })
      .returning();

    const trips = await listCustomerTrips(
      db,
      {
        kind: "customer",
        userId: other!.id,
        role: "customer",
        phone: "+15551200002",
      },
      now,
    );

    expect(trips.upcoming).toHaveLength(0);
    expect(trips.past).toHaveLength(0);
  });

  it("carries the BOOKING's zone on every row", async () => {
    await paidBooking();
    const trips = await listCustomerTrips(db, session, now);
    expect(trips.upcoming[0]!.tz).toBe(TEST_AIRPORTS.JFK.tz);
  });

  it("returns empty lists rather than throwing for a customer with nothing", async () => {
    const trips = await listCustomerTrips(db, session, now);
    expect(trips).toEqual({ upcoming: [], past: [] });
  });
});
