import { fileURLToPath } from "node:url";
import path from "node:path";

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  airlineCutoffs,
  airports,
  bookings,
  createDb,
  custodyEvents,
  payments,
  paymentWebhookEvents,
  pricingRules,
  slots,
  users,
  type Database,
} from "@koolee/db";
import { TEST_AIRPORTS } from "../test-utils/airport-fixtures";

import { createCoreConfig, fixedClock, type CoreConfig } from "../config";
import type { OpsAlerter } from "../notifications/notifier";
import { FakePaymentProvider } from "../payments/fake";
import { WebhookVerificationError } from "../payments/types";
import { createBooking } from "./create-booking";
import { ensureAddress } from "./customers";
import {
  cancelBookingWithRefund,
  captureBookingPayment,
  captureDueBookings,
} from "./payment-lifecycle";
import { handlePaymentEvent } from "./webhooks";
import { generateBookingRef } from "../booking/ref";
import { pickupSnapshotOf } from "../test-utils/booking-fixtures";

/**
 * Phase 5 acceptance — the payment lifecycle, end to end over the
 * FakePaymentProvider (which models Stripe's authorize→capture→refund state
 * machine and its rejections):
 *
 *  - webhook path: valid signature → domain update; invalid signature →
 *    verification error before any side effect; duplicate event id → no-op;
 *  - capture at completion: provider capture + payments row + custody
 *    event; a capture FAILURE moves the booking to the exception state and
 *    alerts ops;
 *  - refund on cancellation: captured → full refund, authorized → void;
 *    a LEGACY slot-backed booking releases its seat, a windowed booking has
 *    none to release; all through the state machine.
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIntegration = TEST_DATABASE_URL ? describe : describe.skip;

if (!TEST_DATABASE_URL) {
  console.log(
    "[integration] TEST_DATABASE_URL not set — skipping payment-lifecycle tests.",
  );
}

const migrationsFolder = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../db/drizzle",
);

const HOUR = 3_600_000;

/** A valid clock-aligned one-hour pickup window ending `leadHours` before departure. */
function windowFor(departureAt: Date, leadHours = 20) {
  const end = new Date(
    Math.floor((departureAt.getTime() - leadHours * HOUR) / HOUR) * HOUR,
  );
  return { pickupWindowStart: new Date(end.getTime() - HOUR), pickupWindowEnd: end };
}

describeIntegration("payment lifecycle (integration)", () => {
  let sqlClient: ReturnType<typeof postgres>;
  let db: Database;
  let provider: FakePaymentProvider;
  let config: CoreConfig;
  let alerts: Array<{ severity: string; title: string }>;

  const now = new Date("2025-06-10T10:00:00Z");
  const departureAt = new Date("2025-06-12T22:00:00Z");
  // A clock-aligned one-hour window well inside the bookable band.
  const window = windowFor(departureAt);
  let userId: string;

  const actor = { userId: null, role: null };

  beforeAll(async () => {
    sqlClient = postgres(TEST_DATABASE_URL!, { max: 1, prepare: false });
    await migrate(drizzle(sqlClient), { migrationsFolder });
    db = createDb({ url: TEST_DATABASE_URL!, max: 5 });
  });

  afterAll(async () => {
    await sqlClient?.end();
  });

  beforeEach(async () => {
    provider = new FakePaymentProvider();
    alerts = [];
    const opsAlerter: OpsAlerter = {
      alert: async (event) => {
        alerts.push({ severity: event.severity, title: event.title });
      },
    };
    config = createCoreConfig({
      db,
      payments: provider,
      clock: fixedClock(now),
      opsAlerter,
    });

    await sqlClient.unsafe(`
      SET session_replication_role = replica;
      DELETE FROM custody_events;
      DELETE FROM payment_webhook_events;
      DELETE FROM payments;
      DELETE FROM bags;
      DELETE FROM bookings;
      DELETE FROM ticket_uploads;
      DELETE FROM slots;
      DELETE FROM slot_blocks;
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
      // Flat pricing: nothing here asserts on lead-time price changes.
      leadTimeMultipliers: [],
      discountRules: [],
      active: true,
    });

    const [user] = await db
      .insert(users)
      .values({ phone: "+15551119001", role: "customer" })
      .returning();
    userId = user!.id;
  });

  async function book() {
    const address = await ensureAddress(db, userId, {
      line1: "1 Test St",
      city: "New York",
      state: "NY",
      zip: "10001",
    });
    const result = await createBooking(config, {
      userId,
      pickupAddressId: address.id,
      quotedZip: "10001",
      ...window,
      flightNumber: "DL123",
      airlineIata: "DL",
      departureAirport: "JFK",
      departureAt,
      scope: "domestic",
      paxName: "Test Customer",
      bagCount: 1,
      distanceKm: 20,
    });
    return result;
  }

  /* ------------------------------------------------------------------ */
  /* Webhook path                                                        */
  /* ------------------------------------------------------------------ */

  it("valid signature → domain update; duplicate event id → no-op; invalid signature → rejected before side effects", async () => {
    const { booking, payment } = await book();
    expect(booking.status).toBe("paid");

    // A captured event over the full verify → handle path.
    const { payload, signature } = provider.simulateWebhook({
      id: "evt_test_000001",
      type: "payment.captured",
      providerRef: payment.authId,
    });
    const event = provider.verifyWebhook(payload, signature);
    const first = await handlePaymentEvent(config, event);
    expect(first.handled).toBe(true);

    const [paymentRow] = await db
      .select()
      .from(payments)
      .where(eq(payments.providerRef, payment.authId));
    expect(paymentRow!.status).toBe("captured");

    // Replay of the SAME event id: no-op, and the recorded state is intact.
    const replay = await handlePaymentEvent(config, event);
    expect(replay.note).toMatch(/replay/i);
    const recorded = await db.select().from(paymentWebhookEvents);
    expect(recorded).toHaveLength(1);

    // Invalid signature never reaches the handler.
    expect(() => provider.verifyWebhook(payload, "wrong-signature")).toThrow(
      WebhookVerificationError,
    );
  });

  it("auth cancellation pre-transit cancels the booking; once in transit it raises an exception instead", async () => {
    // Pre-transit: paid booking, auth cancelled provider-side → cancelled.
    const a = await book();
    const cancelEvent = provider.verifyWebhook(
      ...spread(
        provider.simulateWebhook({
          id: "evt_cancel_pre",
          type: "payment.cancelled",
          providerRef: a.payment.authId,
        }),
      ),
    );
    const outcome = await handlePaymentEvent(config, cancelEvent);
    expect(outcome.handled).toBe(true);
    const [bookingA] = await db
      .select()
      .from(bookings)
      .where(eq(bookings.id, a.booking.id));
    expect(bookingA!.status).toBe("cancelled");

    // In transit: same event class must land in `exception`, not cancel.
    const b = await book();
    for (const status of [
      "agent_assigned",
      "verified_sealed",
      "awaiting_pickup",
      "in_transit",
    ] as const) {
      await db.update(bookings).set({ status }).where(eq(bookings.id, b.booking.id));
    }
    const cancelEvent2 = provider.verifyWebhook(
      ...spread(
        provider.simulateWebhook({
          id: "evt_cancel_transit",
          type: "payment.cancelled",
          providerRef: b.payment.authId,
        }),
      ),
    );
    await handlePaymentEvent(config, cancelEvent2);
    const [bookingB] = await db
      .select()
      .from(bookings)
      .where(eq(bookings.id, b.booking.id));
    expect(bookingB!.status).toBe("exception");
  });

  /* ------------------------------------------------------------------ */
  /* Capture at completion                                               */
  /* ------------------------------------------------------------------ */

  it("captureBookingPayment captures via the seam, records the row + custody event", async () => {
    const { booking, payment } = await book();

    const result = await captureBookingPayment(config, {
      bookingId: booking.id,
      actor,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payment.status).toBe("captured");
    expect(result.payment.captureRef).toBe(result.captureRef);

    // Provider agrees.
    expect(provider.inspectAuth(payment.authId)?.state).toBe("captured");

    // Custody-relevant event appended.
    const events = await db
      .select()
      .from(custodyEvents)
      .where(eq(custodyEvents.bookingId, booking.id));
    expect(events.map((e) => e.eventType)).toContain("booking.payment_captured");
  });

  it("a FAILED capture is ops-visible: booking → exception through the matrix, ops alerted", async () => {
    const { booking, payment } = await book();
    // Cancelling the auth first makes the provider reject the capture —
    // the same failure Stripe returns for an expired/canceled intent.
    await provider.cancelAuth(payment.authId);

    const result = await captureBookingPayment(config, { bookingId: booking.id, actor });
    expect(result.ok).toBe(false);

    const [row] = await db.select().from(bookings).where(eq(bookings.id, booking.id));
    expect(row!.status).toBe("exception");

    const events = await db
      .select()
      .from(custodyEvents)
      .where(eq(custodyEvents.bookingId, booking.id));
    expect(events.map((e) => e.eventType)).toContain("booking.exception_raised");

    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.severity).toBe("critical");
  });

  /* ------------------------------------------------------------------ */
  /* Capture sweep — and the provider guard that caught a real outage     */
  /* ------------------------------------------------------------------ */

  it("the sweep captures only bookings whose bags are already in custody", async () => {
    // Still `paid` — nobody has collected these bags yet.
    const notCollected = await book();
    // Bags sealed and taken: this is the one that owes us money.
    const inCustody = await book();
    await db
      .update(bookings)
      .set({ status: "verified_sealed" })
      .where(eq(bookings.id, inCustody.booking.id));

    const swept = await captureDueBookings(config);
    expect(swept.captured).toEqual([inCustody.booking.id]);
    expect(swept.failed).toEqual([]);

    const [collectedRow] = await db
      .select()
      .from(payments)
      .where(eq(payments.bookingId, inCustody.booking.id));
    expect(collectedRow!.status).toBe("captured");

    const [untouchedRow] = await db
      .select()
      .from(payments)
      .where(eq(payments.bookingId, notCollected.booking.id));
    expect(untouchedRow!.status).toBe("authorized");

    // Idempotent: nothing left to capture on a second pass.
    expect(await captureDueBookings(config)).toEqual({ captured: [], failed: [] });
  });

  it("a provider that did not write the payment can NEVER mark it captured", async () => {
    // The outage this guards: the agent app has no Stripe key, so it wired the
    // FAKE provider and tried to capture a row written by Stripe. Without the
    // provider check that fake capture would have "succeeded" and marked the
    // booking paid while no money moved — strictly worse than failing.
    const { booking } = await book();
    await db
      .update(bookings)
      .set({ status: "verified_sealed" })
      .where(eq(bookings.id, booking.id));
    // Relabel the row as if a different provider had authorized it.
    await db
      .update(payments)
      .set({ provider: "stripe" })
      .where(eq(payments.bookingId, booking.id));

    // The sweep must not see it at all.
    expect(await captureDueBookings(config)).toEqual({ captured: [], failed: [] });

    const [row] = await db
      .select()
      .from(payments)
      .where(eq(payments.bookingId, booking.id));
    expect(row!.status).toBe("authorized");
    expect(row!.captureRef).toBeNull();
  });

  /* ------------------------------------------------------------------ */
  /* Refund on cancellation                                              */
  /* ------------------------------------------------------------------ */

  it("cancelling a booking with an un-captured auth voids it — a windowed booking has no seat to release", async () => {
    const { booking, payment } = await book();

    const result = await cancelBookingWithRefund(config, {
      bookingId: booking.id,
      actor,
      reason: "customer_cancelled",
    });
    expect(result).toEqual({ ok: true, money: "auth_cancelled" });

    expect(provider.inspectAuth(payment.authId)?.state).toBe("cancelled");
    const [paymentRow] = await db
      .select()
      .from(payments)
      .where(eq(payments.providerRef, payment.authId));
    expect(paymentRow!.status).toBe("cancelled");

    const [bookingRow] = await db
      .select()
      .from(bookings)
      .where(eq(bookings.id, booking.id));
    expect(bookingRow!.status).toBe("cancelled");

    // Windows are virtual: no slots row exists for this booking, and the
    // cancellation never touches the (empty) inventory table.
    expect(await db.select().from(slots)).toHaveLength(0);
  });

  it("cancelling a LEGACY slot-backed booking still releases exactly one seat", async () => {
    // Pre-cutover rows keep `slot_id` and NULL window columns; the release
    // code path in cancelBookingWithRefund still exists for them.
    const address = await ensureAddress(db, userId, {
      line1: "1 Test St",
      city: "New York",
      state: "NY",
      zip: "10001",
    });
    const [slot] = await db
      .insert(slots)
      .values({
        airportCode: "JFK",
        tier: "standard_4h",
        windowStart: new Date("2025-06-12T12:00:00Z"),
        windowEnd: new Date("2025-06-12T16:00:00Z"),
        capacity: 5,
        bookedCount: 1,
      })
      .returning();
    const [legacy] = await db
      .insert(bookings)
      .values({
        ref: generateBookingRef(),
        userId,
        status: "paid",
        flightNumber: "DL123",
        airlineIata: "DL",
        departureAirport: "JFK",
        departureAt,
        paxName: "Legacy Customer",
        ...pickupSnapshotOf(address),
        bagCount: 1,
        slotId: slot!.id,
        displayTz: "America/New_York",
        priceCents: 4900,
      })
      .returning();

    const result = await cancelBookingWithRefund(config, {
      bookingId: legacy!.id,
      actor,
      reason: "customer_cancelled",
    });
    // The hand-inserted legacy row has no payments row → money "none".
    expect(result).toEqual({ ok: true, money: "none" });

    const [bookingRow] = await db
      .select()
      .from(bookings)
      .where(eq(bookings.id, legacy!.id));
    expect(bookingRow!.status).toBe("cancelled");

    const [after] = await db.select().from(slots).where(eq(slots.id, slot!.id));
    expect(after!.bookedCount).toBe(0);
  });

  it("cancelling after capture refunds IN FULL (no fee rules exist) through the seam", async () => {
    const { booking } = await book();
    const captured = await captureBookingPayment(config, {
      bookingId: booking.id,
      actor,
    });
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;

    const result = await cancelBookingWithRefund(config, {
      bookingId: booking.id,
      actor,
      reason: "customer_cancelled",
    });
    expect(result).toEqual({ ok: true, money: "refunded" });

    const capture = provider.inspectCapture(captured.captureRef);
    expect(capture?.refundedCents).toBe(capture?.amountCents);

    const [paymentRow] = await db
      .select()
      .from(payments)
      .where(eq(payments.id, captured.payment.id));
    expect(paymentRow!.status).toBe("refunded");

    const events = await db
      .select()
      .from(custodyEvents)
      .where(eq(custodyEvents.bookingId, booking.id));
    expect(events.map((e) => e.eventType)).toContain("booking.payment_refunded");
  });

  it("cancellation is refused by the matrix once bags are in transit", async () => {
    const { booking } = await book();
    for (const status of [
      "agent_assigned",
      "verified_sealed",
      "awaiting_pickup",
      "in_transit",
    ] as const) {
      await db.update(bookings).set({ status }).where(eq(bookings.id, booking.id));
    }
    const result = await cancelBookingWithRefund(config, {
      bookingId: booking.id,
      actor,
    });
    expect(result.ok).toBe(false);
    // vi referenced so the import stays honest under isolated runs.
    void vi;
  });
});

function spread(pair: { payload: string; signature: string }): [string, string] {
  return [pair.payload, pair.signature];
}
