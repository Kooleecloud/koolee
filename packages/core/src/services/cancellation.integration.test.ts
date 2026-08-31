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
  payments,
  users,
  type Address,
  type Booking,
  type BookingStatus,
  type Database,
} from "@koolee/db";

import { createCoreConfig, fixedClock, type CoreConfig } from "../config";
import { NotFoundError } from "../errors";
import { FakePaymentProvider } from "../payments/fake";
import { TEST_AIRPORTS } from "../test-utils/airport-fixtures";
import { pickupSnapshotOf } from "../test-utils/booking-fixtures";
import type { CustomerSession } from "../auth/types";
import { ensureAddress } from "./customers";
import { cancelBookingByCustomer, customerCancelEligibility } from "./cancellation";

/**
 * The customer cancelling their own booking, against a real Postgres.
 *
 * These need real rows for two reasons that a fake database cannot supply:
 * the `payments` row the capture gate reads, and the `custody_events` row the
 * transition writes — which is where the ACTOR ends up, and the actor is the
 * whole point of the feature. "Cancelled by you" versus "Cancelled by Koolee"
 * is a claim about that column and nothing else.
 *
 * The money is deliberately asserted through the provider's own state rather
 * than through what the service returns: a service that reports
 * `auth_cancelled` while leaving a live hold on somebody's card is exactly the
 * failure worth catching, and only the provider knows.
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIntegration = TEST_DATABASE_URL ? describe : describe.skip;

if (!TEST_DATABASE_URL) {
  console.log("[integration] TEST_DATABASE_URL not set — skipping cancellation tests.");
}

const migrationsFolder = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../db/drizzle",
);

describeIntegration("customer cancellation (integration)", () => {
  let sqlClient: ReturnType<typeof postgres>;
  let db: Database;
  let config: CoreConfig;
  let provider: FakePaymentProvider;

  /** Now. The window opens two hours from here unless a test says otherwise. */
  const now = new Date("2026-06-10T10:00:00Z");
  const windowStart = new Date("2026-06-10T12:00:00Z");
  const windowEnd = new Date("2026-06-10T13:00:00Z");
  const departureAt = new Date("2026-06-10T22:00:00Z");

  let customerId: string;
  let otherCustomerId: string;
  let pickupAddress: Address;
  let refCounter = 0;

  const sessionFor = (userId: string): CustomerSession => ({
    kind: "customer",
    userId,
    role: "customer",
    phone: "+15551190001",
  });

  beforeAll(async () => {
    sqlClient = postgres(TEST_DATABASE_URL!, { max: 1, prepare: false });
    await migrate(drizzle(sqlClient), { migrationsFolder });
    db = createDb({ url: TEST_DATABASE_URL!, max: 4 });
  });

  afterAll(async () => {
    await sqlClient?.end();
  });

  beforeEach(async () => {
    provider = new FakePaymentProvider();
    config = createCoreConfig({ db, payments: provider, clock: fixedClock(now) });

    await sqlClient.unsafe(`
      SET session_replication_role = replica;
      DELETE FROM custody_events;
      DELETE FROM payments;
      DELETE FROM pickup_tasks;
      DELETE FROM verification_tasks;
      DELETE FROM bags;
      DELETE FROM bookings;
      DELETE FROM addresses;
      DELETE FROM users;
      DELETE FROM airports;
      DELETE FROM airline_cutoffs;
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

    const [customer] = await db
      .insert(users)
      .values({ phone: "+15551190001", role: "customer", fullName: "Casey Rivera" })
      .returning();
    customerId = customer!.id;

    const [other] = await db
      .insert(users)
      .values({ phone: "+15551190002", role: "customer", fullName: "Sam Okafor" })
      .returning();
    otherCustomerId = other!.id;

    pickupAddress = await ensureAddress(db, customerId, {
      line1: "1 Test St",
      city: "New York",
      state: "NY",
      zip: "10018",
    });
    refCounter = 0;
  });

  /* --- fixtures ----------------------------------------------------- */

  /**
   * A paid booking with a live authorization on it, which is the ordinary
   * shape a customer would be cancelling from.
   */
  async function makeBooking(
    over: {
      status?: BookingStatus;
      pickupWindowStart?: Date | null;
      pickupWindowEnd?: Date | null;
      userId?: string;
      payment?: "authorized" | "captured" | "pending" | "none";
    } = {},
  ): Promise<Booking> {
    refCounter += 1;
    const [booking] = await db
      .insert(bookings)
      .values({
        ref: `KOO-C${String(refCounter).padStart(4, "0")}`,
        userId: over.userId ?? customerId,
        status: over.status ?? "paid",
        flightNumber: "DL123",
        airlineIata: "DL",
        departureAirport: "JFK",
        departureAt,
        paxName: "Casey Rivera",
        ...pickupSnapshotOf(pickupAddress),
        pickupWindowStart:
          over.pickupWindowStart === undefined ? windowStart : over.pickupWindowStart,
        pickupWindowEnd:
          over.pickupWindowEnd === undefined ? windowEnd : over.pickupWindowEnd,
        bagCount: 2,
        displayTz: "America/New_York",
        priceCents: 5000,
      })
      .returning();

    const kind = over.payment ?? "authorized";
    if (kind !== "none") {
      const auth = await provider.authorize(booking!.id, 5000);
      const captureRef =
        kind === "captured" ? (await provider.capture(auth.authId)).captureId : null;
      await db.insert(payments).values({
        bookingId: booking!.id,
        provider: provider.name,
        providerRef: auth.authId,
        captureRef,
        status: kind,
        amountCents: 5000,
      });
    }

    return booking!;
  }

  const eventsFor = (bookingId: string) =>
    db.select().from(custodyEvents).where(eq(custodyEvents.bookingId, bookingId));

  const bookingRow = (id: string) =>
    db.query.bookings.findFirst({ where: eq(bookings.id, id) });

  const paymentRow = (bookingId: string) =>
    db.query.payments.findFirst({ where: eq(payments.bookingId, bookingId) });

  /* --- eligibility, which the page and the action both read ---------- */

  describe("customerCancelEligibility", () => {
    it("allows a paid booking before its window opens", async () => {
      const booking = await makeBooking();
      await expect(customerCancelEligibility(db, booking, now)).resolves.toEqual({
        canCancel: true,
        refusal: null,
      });
    });

    it("allows an agent_assigned booking before its window opens", async () => {
      const booking = await makeBooking({ status: "agent_assigned" });
      expect((await customerCancelEligibility(db, booking, now)).canCancel).toBe(true);
    });

    /*
     * THE WINDOW GATE, at its exact boundary. `>=` rather than `>`: the
     * instant the window opens, an agent may already be outside.
     */
    it("refuses at the instant the window opens", async () => {
      const booking = await makeBooking();
      await expect(customerCancelEligibility(db, booking, windowStart)).resolves.toEqual({
        canCancel: false,
        refusal: "window_open",
      });
    });

    it("allows one millisecond before the window opens", async () => {
      const booking = await makeBooking();
      const justBefore = new Date(windowStart.getTime() - 1);
      expect((await customerCancelEligibility(db, booking, justBefore)).canCancel).toBe(
        true,
      );
    });

    /*
     * A booking with no window at all fails the gate. Refusing to guess is
     * the only safe reading: guessing wrong either cancels something already
     * in flight or charges somebody who asked in time.
     */
    it("refuses a booking with no pickup window on record", async () => {
      const booking = await makeBooking({
        pickupWindowStart: null,
        pickupWindowEnd: null,
      });
      expect((await customerCancelEligibility(db, booking, now)).refusal).toBe(
        "window_open",
      );
    });

    it.each(["verified_sealed", "awaiting_pickup", "in_transit", "completed"] as const)(
      "refuses once the booking is %s, even inside the window",
      async (status) => {
        const booking = await makeBooking({ status });
        expect((await customerCancelEligibility(db, booking, now)).refusal).toBe(
          "not_cancellable_status",
        );
      },
    );

    it("refuses a booking that has already been charged", async () => {
      const booking = await makeBooking({ payment: "captured" });
      expect((await customerCancelEligibility(db, booking, now)).refusal).toBe(
        "already_captured",
      );
    });

    /*
     * A `pending` intent — created, not yet confirmed in the browser — is not
     * a capture. `cancelBookingWithRefund` voids it exactly like an
     * authorization, so the customer is not sent to support over one.
     */
    it("allows a booking whose intent is still pending", async () => {
      const booking = await makeBooking({ payment: "pending" });
      expect((await customerCancelEligibility(db, booking, now)).canCancel).toBe(true);
    });
  });

  /* --- the cancellation itself --------------------------------------- */

  describe("cancelBookingByCustomer", () => {
    it("cancels, records the CUSTOMER as the actor, and releases the hold", async () => {
      const booking = await makeBooking();
      const before = await paymentRow(booking.id);

      const result = await cancelBookingByCustomer(config, sessionFor(customerId), {
        bookingId: booking.id,
      });

      expect(result).toEqual({ ok: true, money: "auth_cancelled" });
      expect((await bookingRow(booking.id))?.status).toBe("cancelled");

      // The custody trail names the customer, which is what every surface
      // renders "Cancelled by you" from.
      const events = await eventsFor(booking.id);
      const cancelled = events.find((e) => e.eventType === "booking.cancelled");
      expect(cancelled?.actorUserId).toBe(customerId);
      expect(cancelled?.actorRole).toBe("customer");

      /*
       * The hold is actually GONE at the provider, not merely reported gone.
       *
       * `PaymentAuth.status` has no `cancelled` member on purpose — the seam
       * models "cancelled or expired; the authorization is dead" as `failed`,
       * because a caller has nothing different to do about the two. The
       * `payments` ROW does distinguish them, and says `cancelled`.
       */
      const auth = await provider.getAuth(before!.providerRef);
      expect(auth.status).toBe("failed");
      expect((await paymentRow(booking.id))?.status).toBe("cancelled");

      // And the release is recorded too, so the money has a trail of its own.
      expect(events.some((e) => e.eventType === "booking.payment_auth_cancelled")).toBe(
        true,
      );
    });

    it("carries the customer's reason into the trail", async () => {
      const booking = await makeBooking();
      await cancelBookingByCustomer(config, sessionFor(customerId), {
        bookingId: booking.id,
        reason: "Flight was moved.",
      });
      const cancelled = (await eventsFor(booking.id)).find(
        (e) => e.eventType === "booking.cancelled",
      );
      expect(cancelled?.metadata).toMatchObject({ reason: "Flight was moved." });
    });

    /*
     * OWNERSHIP. A booking belonging to somebody else 404s rather than 403s —
     * telling a caller that another person's booking exists is itself a
     * disclosure, and the booking must be untouched afterwards.
     */
    it("404s on somebody else's booking and leaves it alone", async () => {
      const booking = await makeBooking({ userId: otherCustomerId });

      await expect(
        cancelBookingByCustomer(config, sessionFor(customerId), {
          bookingId: booking.id,
        }),
      ).rejects.toBeInstanceOf(NotFoundError);

      expect((await bookingRow(booking.id))?.status).toBe("paid");
      expect(await eventsFor(booking.id)).toHaveLength(0);
    });

    it("404s on a booking that does not exist", async () => {
      await expect(
        cancelBookingByCustomer(config, sessionFor(customerId), {
          bookingId: "00000000-0000-0000-0000-000000000000",
        }),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    /*
     * THE GATE IS RE-CHECKED SERVER-SIDE. A server action stays a reachable
     * POST whatever the page drew, so a customer whose window opened between
     * the render and the click must be refused here — not merely un-offered
     * the button.
     */
    it("refuses once the window has opened, even when called directly", async () => {
      const booking = await makeBooking();
      const late = createCoreConfig({
        db,
        payments: provider,
        clock: fixedClock(new Date(windowStart.getTime() + 60_000)),
      });

      const result = await cancelBookingByCustomer(late, sessionFor(customerId), {
        bookingId: booking.id,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.refusal).toBe("window_open");
      expect((await bookingRow(booking.id))?.status).toBe("paid");
      expect(await eventsFor(booking.id)).toHaveLength(0);
    });

    it("refuses a captured booking without touching the money", async () => {
      const booking = await makeBooking({ payment: "captured" });
      const before = await paymentRow(booking.id);

      const result = await cancelBookingByCustomer(config, sessionFor(customerId), {
        bookingId: booking.id,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.refusal).toBe("already_captured");
      expect((await bookingRow(booking.id))?.status).toBe("paid");
      expect((await paymentRow(booking.id))?.status).toBe(before!.status);
    });

    it("refuses a booking already past the visit", async () => {
      const booking = await makeBooking({ status: "verified_sealed" });
      const result = await cancelBookingByCustomer(config, sessionFor(customerId), {
        bookingId: booking.id,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.refusal).toBe("not_cancellable_status");
      expect((await bookingRow(booking.id))?.status).toBe("verified_sealed");
    });

    /*
     * Cancelling twice. The second call finds a `cancelled` booking, which is
     * not in the cancellable set, so it is refused by the status gate rather
     * than reaching the state machine — and nothing is written twice.
     */
    it("refuses a second cancellation and writes nothing further", async () => {
      const booking = await makeBooking();
      await cancelBookingByCustomer(config, sessionFor(customerId), {
        bookingId: booking.id,
      });
      const after = await eventsFor(booking.id);

      const second = await cancelBookingByCustomer(config, sessionFor(customerId), {
        bookingId: booking.id,
      });

      expect(second.ok).toBe(false);
      if (!second.ok) expect(second.refusal).toBe("not_cancellable_status");
      expect(await eventsFor(booking.id)).toHaveLength(after.length);
    });
  });
});
