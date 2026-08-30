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
  custodyEvents,
  pricingRules,
  users,
  type Booking,
  type Database,
} from "@koolee/db";

import { createCoreConfig, fixedClock, type CoreConfig } from "../config";
import { BookingNotActionableError } from "../errors";
import { FakePaymentProvider } from "../payments/fake";
import { TEST_AIRPORTS } from "../test-utils/airport-fixtures";
import { acceptAgreement } from "./agreements";
import { applyTransition } from "./bookings";
import { createBooking } from "./create-booking";
import { ensureAddress } from "./customers";
import { recordCustomerUpload } from "./passport";
import { getBookingActionability } from "./actionability";

/**
 * The gate matrix, ENFORCED — the half the pure suite cannot prove.
 *
 * `actionability.test.ts` proves the rules. This proves that the rules are
 * actually in the way: that the customer-facing entry points refuse when the
 * booking is past its bag-drop cutoff, that a refusal raises the exception
 * ops resolves, that it raises it exactly once, and that a refusal is silent
 * about everything else — the booking is not otherwise touched.
 *
 * The agent and driver gates (`arriveAtVisit`, `listCandidateDrivers`,
 * `selectDriver`, `startPickupTravel`) are covered in their own suites, which
 * already carry the tasks, trucks and shifts they need.
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIntegration = TEST_DATABASE_URL ? describe : describe.skip;

if (!TEST_DATABASE_URL) {
  console.log("[integration] TEST_DATABASE_URL not set — skipping actionability tests.");
}

const migrationsFolder = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../db/drizzle",
);

const HOUR = 3_600_000;

describeIntegration("booking actionability (integration)", () => {
  let sqlClient: ReturnType<typeof postgres>;
  let db: Database;
  let config: CoreConfig;
  let customerId: string;

  /** Booked well ahead; the cutoff below is 45 minutes before departure. */
  const now = new Date("2025-06-10T10:00:00Z");
  const departureAt = new Date("2025-06-12T22:00:00Z");
  const cutoffAt = new Date(departureAt.getTime() - 45 * 60_000);
  /** Window ends 20 hours out, so "late but savable" is a real interval. */
  const windowEnd = new Date(
    Math.floor((departureAt.getTime() - 20 * HOUR) / HOUR) * HOUR,
  );

  /** A config whose clock sits at a chosen instant. */
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
      DELETE FROM custody_events;
      DELETE FROM agreement_acceptances;
      DELETE FROM agreement_versions;
      DELETE FROM passport_verifications;
      DELETE FROM payment_webhook_events;
      DELETE FROM payments;
      DELETE FROM verification_tasks;
      DELETE FROM pickup_tasks;
      DELETE FROM bags;
      DELETE FROM bookings;
      DELETE FROM ticket_uploads;
      DELETE FROM staff_members;
      DELETE FROM slot_blocks;
      DELETE FROM slots;
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
      .values({ phone: "+15551140001", role: "customer" })
      .returning();
    customerId = customer!.id;
  });

  async function paidBooking(): Promise<Booking> {
    const address = await ensureAddress(db, customerId, {
      line1: "1 Test St",
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
      paxName: "Test Customer",
      bagCount: 1,
      distanceKm: 20,
    });
    return booking;
  }

  const statusOf = async (id: string) =>
    (await db.query.bookings.findFirst({ where: eq(bookings.id, id) }))!.status;

  const exceptionEvents = async (id: string) =>
    (await db.select().from(custodyEvents).where(eq(custodyEvents.bookingId, id))).filter(
      (e) => e.eventType === "booking.exception_raised",
    );

  /* ---------------------------------------------------------------- */
  /* The deadline is read off the airline row, not assumed             */
  /* ---------------------------------------------------------------- */

  it("resolves the bag-drop deadline from the airline cutoff on record", async () => {
    const booking = await paidBooking();
    const state = await getBookingActionability(db, booking, now);

    expect(state.bagDropCutoffAt?.toISOString()).toBe(cutoffAt.toISOString());
    expect(state.phase).toBe("before_window_end");
    expect(state.can.acceptAgreement).toBe(true);
  });

  it("takes the STRICTEST cutoff when both scopes have a row", async () => {
    // Bookings do not persist domestic vs international, so a flight matches
    // both rows. The looser one is a deadline that runs late.
    await db.insert(airlineCutoffs).values({
      airlineIata: "DL",
      airportCode: "JFK",
      scope: "international",
      cutoffMinutesBeforeDeparture: 60,
      effectiveFrom: new Date("2024-01-01T00:00:00Z"),
    });
    const booking = await paidBooking();
    const state = await getBookingActionability(db, booking, now);

    expect(state.bagDropCutoffAt?.toISOString()).toBe(
      new Date(departureAt.getTime() - 60 * 60_000).toISOString(),
    );
  });

  /* ---------------------------------------------------------------- */
  /* Late but savable                                                  */
  /* ---------------------------------------------------------------- */

  it("still accepts the agreement after the pickup window, before the cutoff", async () => {
    const booking = await paidBooking();
    const late = at(new Date(windowEnd.getTime() + 30 * 60_000));

    const result = await acceptAgreement(late, {
      bookingId: booking.id,
      userId: customerId,
    });

    expect(result.created).toBe(true);
    expect(await statusOf(booking.id)).toBe("paid");
    // Nothing was escalated: this booking is late, not lost.
    expect(await exceptionEvents(booking.id)).toHaveLength(0);
  });

  it("still takes a passport upload after the pickup window, before the cutoff", async () => {
    const booking = await paidBooking();
    const late = at(new Date(windowEnd.getTime() + 30 * 60_000));

    const row = await recordCustomerUpload(late, {
      bookingId: booking.id,
      userId: customerId,
      storagePath: `passports/${booking.id}/late.jpg`,
    });

    expect(row.status).toBe("customer_uploaded");
    expect(await exceptionEvents(booking.id)).toHaveLength(0);
  });

  /* ---------------------------------------------------------------- */
  /* Missed                                                            */
  /* ---------------------------------------------------------------- */

  it("refuses the agreement past the cutoff and raises the exception", async () => {
    const booking = await paidBooking();
    const missed = at(new Date(cutoffAt.getTime() + 60_000));

    const error = await acceptAgreement(missed, {
      bookingId: booking.id,
      userId: customerId,
    }).then(
      () => null,
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(BookingNotActionableError);
    expect((error as BookingNotActionableError).phase).toBe("missed_cutoff");
    expect((error as BookingNotActionableError).action).toBe("acceptAgreement");
    // The customer is told what happened, in the message the surface renders.
    expect((error as Error).message).toContain("bag drop");

    // Ops now owns it.
    expect(await statusOf(booking.id)).toBe("exception");
    expect(await exceptionEvents(booking.id)).toHaveLength(1);
  });

  it("refuses a passport upload past the cutoff", async () => {
    const booking = await paidBooking();
    const missed = at(new Date(cutoffAt.getTime() + 60_000));

    await expect(
      recordCustomerUpload(missed, {
        bookingId: booking.id,
        userId: customerId,
        storagePath: `passports/${booking.id}/too-late.jpg`,
      }),
    ).rejects.toBeInstanceOf(BookingNotActionableError);

    expect(await statusOf(booking.id)).toBe("exception");
  });

  it("raises the exception EXACTLY ONCE across repeated blocked attempts", async () => {
    const booking = await paidBooking();
    const missed = at(new Date(cutoffAt.getTime() + 60_000));

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(
        acceptAgreement(missed, { bookingId: booking.id, userId: customerId }),
      ).rejects.toBeInstanceOf(BookingNotActionableError);
    }

    // Not because anything counts: every attempt after the first finds the
    // booking already in `exception`, where `raisesException` is false.
    expect(await exceptionEvents(booking.id)).toHaveLength(1);
  });

  it("raises it exactly once under concurrent blocked attempts", async () => {
    const booking = await paidBooking();
    const missed = at(new Date(cutoffAt.getTime() + 60_000));

    const outcomes = await Promise.allSettled([
      acceptAgreement(missed, { bookingId: booking.id, userId: customerId }),
      acceptAgreement(missed, { bookingId: booking.id, userId: customerId }),
    ]);

    expect(outcomes.every((o) => o.status === "rejected")).toBe(true);
    // `applyTransition` guards on `WHERE status = from`, so the loser writes
    // no custody event at all.
    expect(await exceptionEvents(booking.id)).toHaveLength(1);
  });

  /* ---------------------------------------------------------------- */
  /* Departed                                                          */
  /* ---------------------------------------------------------------- */

  it("says the flight has departed once it has, and still escalates", async () => {
    const booking = await paidBooking();
    const departed = at(new Date(departureAt.getTime() + 60_000));

    const error = await acceptAgreement(departed, {
      bookingId: booking.id,
      userId: customerId,
    }).then(
      () => null,
      (e: unknown) => e,
    );

    expect((error as BookingNotActionableError).phase).toBe("departed");
    expect((error as Error).message).toContain("departed");
    expect(await statusOf(booking.id)).toBe("exception");
  });

  /* ---------------------------------------------------------------- */
  /* The gates must not get in ops' way                                */
  /* ---------------------------------------------------------------- */

  it("leaves admin resolution of the exception working", async () => {
    const booking = await paidBooking();
    const missed = at(new Date(cutoffAt.getTime() + 60_000));
    await expect(
      acceptAgreement(missed, { bookingId: booking.id, userId: customerId }),
    ).rejects.toBeInstanceOf(BookingNotActionableError);
    expect(await statusOf(booking.id)).toBe("exception");

    // The five gated actions are the customer's and the crew's. Ops resolves
    // through `applyTransition`, which this must never touch.
    const cancelled = await applyTransition(missed, {
      bookingId: booking.id,
      event: "cancel",
      actor: { userId: customerId, role: "admin" },
    });

    expect(cancelled.ok).toBe(true);
    expect(await statusOf(booking.id)).toBe("cancelled");
  });

  it("refuses a cancelled booking without escalating it again", async () => {
    const booking = await paidBooking();
    const cancelled = await applyTransition(config, {
      bookingId: booking.id,
      event: "cancel",
      actor: { userId: customerId, role: "admin" },
    });
    expect(cancelled.ok).toBe(true);

    await expect(
      acceptAgreement(config, { bookingId: booking.id, userId: customerId }),
    ).rejects.toThrow();

    expect(await statusOf(booking.id)).toBe("cancelled");
    expect(await exceptionEvents(booking.id)).toHaveLength(0);
  });
});
