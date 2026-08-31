import { fileURLToPath } from "node:url";
import path from "node:path";

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  airlineCutoffs,
  airports,
  bookings,
  createDb,
  custodyEvents,
  pricingRules,
  users,
  type Database,
} from "@koolee/db";
import { TEST_AIRPORTS } from "../test-utils/airport-fixtures";

import type { CustomerSession } from "../auth/types";
import { createCoreConfig, fixedClock, type CoreConfig } from "../config";
import { ConflictError, NotFoundError, OutOfCoverageError } from "../errors";
import { FakePaymentProvider } from "../payments/fake";
import {
  createAddressForSession,
  deleteAddressForSession,
  getAddressForSession,
  listAddressesForSession,
  updateAddressForSession,
} from "./addresses";
import { getBookingDetailForSession } from "./bookings";
import { createBooking } from "./create-booking";

/**
 * Phase 4 acceptance — the customer account area's core services:
 *
 *  - saved-address CRUD with the coverage check on every save and ownership
 *    enforced in core (user A cannot touch user B's addresses);
 *  - booking detail (timeline + bags + payments) scoped to exactly one
 *    booking, authorized against the session.
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIntegration = TEST_DATABASE_URL ? describe : describe.skip;

if (!TEST_DATABASE_URL) {
  console.log("[integration] TEST_DATABASE_URL not set — skipping account-area tests.");
}

const migrationsFolder = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../db/drizzle",
);

function customerSession(userId: string): CustomerSession {
  return { kind: "customer", role: "customer", userId, phone: "", email: null };
}

const HOUR = 3_600_000;
/** A clock-aligned one-hour pickup window, mid-band and notice-safe. */
function windowFor(departureAt: Date, leadHours = 20) {
  const end = new Date(
    Math.floor((departureAt.getTime() - leadHours * HOUR) / HOUR) * HOUR,
  );
  return { pickupWindowStart: new Date(end.getTime() - HOUR), pickupWindowEnd: end };
}

describeIntegration("customer account area (integration)", () => {
  let sqlClient: ReturnType<typeof postgres>;
  let db: Database;
  let config: CoreConfig;

  const now = new Date("2025-06-10T10:00:00Z");
  const departureAt = new Date("2025-06-12T22:00:00Z");
  let userA: string;
  let userB: string;

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
      DELETE FROM custody_events;
      DELETE FROM payments;
      DELETE FROM bags;
      DELETE FROM bookings;
      DELETE FROM ticket_uploads;
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

    const [a] = await db
      .insert(users)
      .values({ phone: "+15551118001", role: "customer" })
      .returning();
    const [b] = await db
      .insert(users)
      .values({ phone: "+15551118002", role: "customer" })
      .returning();
    userA = a!.id;
    userB = b!.id;
  });

  async function bookFor(userId: string) {
    const address = await createAddressForSession(db, customerSession(userId), {
      label: "Home",
      line1: "1 Booking St",
      city: "New York",
      state: "NY",
      zip: "10001",
    });
    return createBooking(config, {
      userId,
      pickupAddressId: address.id,
      quotedZip: address.zip,
      ...windowFor(departureAt),
      flightNumber: "DL123",
      airlineIata: "DL",
      departureAirport: "JFK",
      departureAt,
      scope: "domestic",
      paxName: "Test Customer",
      bagCount: 2,
      distanceKm: 20,
    });
  }

  it("address CRUD: create with label, list, update, delete — coverage-checked on every save", async () => {
    const session = customerSession(userA);

    const created = await createAddressForSession(db, session, {
      label: "Home",
      line1: "100 W 23rd St",
      line2: "Apt 4",
      city: "New York",
      state: "ny",
      zip: "10011",
    });
    expect(created.label).toBe("Home");
    expect(created.state).toBe("NY");

    // Out-of-coverage saves are rejected — create AND update.
    await expect(
      createAddressForSession(db, session, {
        line1: "1 Far Away",
        city: "Beverly Hills",
        state: "CA",
        zip: "90210",
      }),
    ).rejects.toThrow(OutOfCoverageError);
    await expect(
      updateAddressForSession(db, session, created.id, {
        label: "Home",
        line1: "100 W 23rd St",
        city: "Beverly Hills",
        state: "CA",
        zip: "90210",
      }),
    ).rejects.toThrow(OutOfCoverageError);

    const updated = await updateAddressForSession(db, session, created.id, {
      label: "Office",
      line1: "200 5th Ave",
      city: "New York",
      state: "NY",
      zip: "10010",
    });
    expect(updated.label).toBe("Office");
    expect(updated.line1).toBe("200 5th Ave");

    expect(await listAddressesForSession(db, session)).toHaveLength(1);

    await deleteAddressForSession(db, session, created.id);
    expect(await listAddressesForSession(db, session)).toHaveLength(0);
  });

  it("ownership: user A cannot read, update, or delete user B's address", async () => {
    const bAddress = await createAddressForSession(db, customerSession(userB), {
      label: "B's place",
      line1: "9 Private Rd",
      city: "New York",
      state: "NY",
      zip: "10001",
    });

    const sessionA = customerSession(userA);
    expect(await getAddressForSession(db, sessionA, bAddress.id)).toBeNull();
    await expect(
      updateAddressForSession(db, sessionA, bAddress.id, {
        line1: "Hijacked",
        city: "New York",
        state: "NY",
        zip: "10001",
      }),
    ).rejects.toThrow(NotFoundError);
    await expect(deleteAddressForSession(db, sessionA, bAddress.id)).rejects.toThrow(
      NotFoundError,
    );

    // B still has it, untouched.
    const [row] = await listAddressesForSession(db, customerSession(userB));
    expect(row?.line1).toBe("9 Private Rd");
  });

  it("an address a LIVE booking is counting on can't be deleted — typed conflict, not a DB error", async () => {
    const { booking } = await bookFor(userA);
    await expect(
      deleteAddressForSession(db, customerSession(userA), booking.pickupAddressId!),
    ).rejects.toThrow(ConflictError);
  });

  /*
   * The other half of that rule, and the reason 0033 exists.
   *
   * Before the pickup snapshot, an address used by ANY booking was
   * undeletable forever — the booking held no address of its own, so the row
   * was evidence. Now the booking carries the doorstep it was made for, so a
   * finished trip places no claim on the customer's saved list, and what the
   * booking says happened is unchanged by the deletion.
   */
  it("an address is deletable once its bookings are done, and the booking keeps the doorstep", async () => {
    const { booking } = await bookFor(userA);
    const addressId = booking.pickupAddressId!;
    await db
      .update(bookings)
      .set({ status: "completed" })
      .where(eq(bookings.id, booking.id));

    await deleteAddressForSession(db, customerSession(userA), addressId);

    expect(await listAddressesForSession(db, customerSession(userA))).toHaveLength(0);

    const after = await db.query.bookings.findFirst({
      where: eq(bookings.id, booking.id),
    });
    // Provenance goes null; the address the pickup was for does not.
    expect(after?.pickupAddressId).toBeNull();
    expect(after?.pickupLine1).toBe("1 Booking St");
    expect(after?.pickupZip).toBe("10001");
  });

  it("booking detail renders that booking's custody events, bags and payments — and only that booking's", async () => {
    const { booking: bookingA } = await bookFor(userA);
    const { booking: bookingB } = await bookFor(userB);

    // Extra event on B, to catch any cross-booking leak.
    await db.insert(custodyEvents).values({
      bookingId: bookingB.id,
      eventType: "booking.b_only_marker",
    });

    const detail = await getBookingDetailForSession(
      db,
      customerSession(userA),
      bookingA.id,
    );

    expect(detail.booking.id).toBe(bookingA.id);
    expect(detail.bags).toHaveLength(2);
    expect(detail.payments).toHaveLength(1);
    expect(detail.payments[0]?.status).toBe("authorized");
    expect(detail.timeline.length).toBeGreaterThan(0);
    for (const event of detail.timeline) {
      expect(event.bookingId).toBe(bookingA.id);
      expect(event.eventType).not.toBe("booking.b_only_marker");
    }

    // And the session gate still holds on the detail read.
    await expect(
      getBookingDetailForSession(db, customerSession(userA), bookingB.id),
    ).rejects.toThrow(NotFoundError);
  });
});
