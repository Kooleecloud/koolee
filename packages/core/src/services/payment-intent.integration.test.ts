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
  pricingRules,
  users,
  type Database,
} from "@koolee/db";

import { createCoreConfig, fixedClock, type CoreConfig } from "../config";
import { NotFoundError } from "../errors";
import { FakePaymentProvider } from "../payments/fake";
import { ensureAddress } from "./customers";
import {
  ensureBookingPaymentIntent,
  reconcileBookingPayment,
  setBookingContactPhone,
  type EnsurePaymentIntentInput,
} from "./payment-intent";
import { quoteBookingPrice } from "./quote";
import { handlePaymentEvent } from "./webhooks";

/**
 * The real-checkout slice: one PaymentIntent per funnel draft, amounts from
 * the pricing engine, matrix-only advancement, and the return page's
 * server-side status re-check — all over the FakePaymentProvider in its
 * Stripe-parity mode (`requiresClientConfirmation`), so the flow under test
 * is authorize → browser confirmation → webhook OR re-check, exactly like
 * production, with zero live calls.
 *
 * The existing "failed authorization cannot reach paid" pins live in the
 * create-booking and payment-lifecycle suites; the cases here EXTEND them to
 * the deferred-confirmation flow rather than duplicating them.
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIntegration = TEST_DATABASE_URL ? describe : describe.skip;

if (!TEST_DATABASE_URL) {
  console.log("[integration] TEST_DATABASE_URL not set — skipping payment-intent tests.");
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

describeIntegration("payment intent lifecycle (integration)", () => {
  let sqlClient: ReturnType<typeof postgres>;
  let db: Database;
  let provider: FakePaymentProvider;
  let config: CoreConfig;

  const now = new Date("2025-06-10T10:00:00Z");
  const departureAt = new Date("2025-06-12T22:00:00Z");
  // A clock-aligned one-hour window well inside the bookable band.
  const window = windowFor(departureAt);
  let userId: string;
  let otherUserId: string;
  let addressId: string;

  beforeAll(async () => {
    sqlClient = postgres(TEST_DATABASE_URL!, { max: 1, prepare: false });
    await migrate(drizzle(sqlClient), { migrationsFolder });
    db = createDb({ url: TEST_DATABASE_URL!, max: 5 });
  });

  afterAll(async () => {
    await sqlClient?.end();
  });

  beforeEach(async () => {
    provider = new FakePaymentProvider({ requiresClientConfirmation: true });
    config = createCoreConfig({
      db,
      payments: provider,
      clock: fixedClock(now),
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

    await db.insert(airports).values({
      code: "JFK",
      name: "John F. Kennedy International",
      tz: "America/New_York",
    });
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
      // Promo used by the amount-drift case below.
      discountRules: [{ kind: "percent_off", code: "SAVE10", percent: 10 }],
      active: true,
    });

    const [user] = await db
      .insert(users)
      .values({ phone: "+15551119002", role: "customer" })
      .returning();
    userId = user!.id;
    const [other] = await db
      .insert(users)
      .values({ phone: "+15551119003", role: "customer" })
      .returning();
    otherUserId = other!.id;

    const address = await ensureAddress(db, userId, {
      line1: "1 Test St",
      city: "New York",
      state: "NY",
      zip: "10001",
    });
    addressId = address.id;
  });

  function baseInput(
    overrides: Partial<EnsurePaymentIntentInput> = {},
  ): EnsurePaymentIntentInput {
    return {
      userId,
      pickupAddressId: addressId,
      ...window,
      flightNumber: "DL123",
      airlineIata: "DL",
      departureAirport: "JFK",
      departureAt,
      scope: "domestic",
      paxName: "Test Customer",
      bagCount: 1,
      distanceKm: 20,
      contactPhone: null,
      ...overrides,
    };
  }

  async function bookingRow(id: string) {
    const [row] = await db.select().from(bookings).where(eq(bookings.id, id));
    return row!;
  }

  async function paymentRow(bookingId: string) {
    const [row] = await db
      .select()
      .from(payments)
      .where(eq(payments.bookingId, bookingId));
    return row!;
  }

  /* ------------------------------------------------------------------ */
  /* One intent per draft                                                 */
  /* ------------------------------------------------------------------ */

  it("creates ONE intent per draft: the amount comes from the pricing engine and a revisit reuses it", async () => {
    const first = await ensureBookingPaymentIntent(config, baseInput());
    expect(first.kind).toBe("ready");
    if (first.kind !== "ready") return;
    expect(first.reused).toBe(false);
    expect(first.clientSecret).toContain("_secret_fake");

    // Amount is the engine's, to the cent.
    const { breakdown } = await quoteBookingPrice(config, {
      pickupWindowEnd: window.pickupWindowEnd,
      departureAt,
      bagCount: 1,
      distanceKm: 20,
    });
    expect(first.amountCents).toBe(breakdown.totalCents);

    // Booking stays a draft; payments row is honestly pending.
    expect((await bookingRow(first.bookingId)).status).toBe("draft");
    expect((await paymentRow(first.bookingId)).status).toBe("pending");

    // Revisit with the cookie's remembered id: same intent, nothing new minted.
    const second = await ensureBookingPaymentIntent(
      config,
      baseInput({ existingBookingId: first.bookingId }),
    );
    expect(second.kind).toBe("ready");
    if (second.kind !== "ready") return;
    expect(second.reused).toBe(true);
    expect(second.providerRef).toBe(first.providerRef);
    expect(second.bookingId).toBe(first.bookingId);
    expect(provider.listAuths()).toHaveLength(1);

    // Revisit with a LOST cookie key: the fingerprint fallback (which now
    // matches on pickupWindowStart/End) still reuses the SAME draft booking —
    // intent reuse never creates a second booking row.
    const third = await ensureBookingPaymentIntent(config, baseInput());
    expect(third.kind).toBe("ready");
    if (third.kind !== "ready") return;
    expect(third.providerRef).toBe(first.providerRef);
    expect(third.bookingId).toBe(first.bookingId);
    expect(provider.listAuths()).toHaveLength(1);

    const allBookings = await db.select().from(bookings);
    expect(allBookings).toHaveLength(1);
  });

  it("pure amount drift (promo applied) updates the SAME intent through the seam", async () => {
    const first = await ensureBookingPaymentIntent(config, baseInput());
    expect(first.kind).toBe("ready");
    if (first.kind !== "ready") return;

    const second = await ensureBookingPaymentIntent(
      config,
      baseInput({ existingBookingId: first.bookingId, promoCode: "SAVE10" }),
    );
    expect(second.kind).toBe("ready");
    if (second.kind !== "ready") return;

    const { breakdown } = await quoteBookingPrice(config, {
      pickupWindowEnd: window.pickupWindowEnd,
      departureAt,
      bagCount: 1,
      distanceKm: 20,
      promoCode: "SAVE10",
    });
    expect(second.reused).toBe(true);
    expect(second.amountUpdated).toBe(true);
    expect(second.providerRef).toBe(first.providerRef);
    expect(second.amountCents).toBe(breakdown.totalCents);
    expect(second.amountCents).toBeLessThan(first.amountCents);

    // Provider, payments row and booking price all agree.
    expect(provider.inspectAuth(first.providerRef)?.amountCents).toBe(
      breakdown.totalCents,
    );
    expect((await paymentRow(first.bookingId)).amountCents).toBe(breakdown.totalCents);
    expect((await bookingRow(first.bookingId)).priceCents).toBe(breakdown.totalCents);
    expect(provider.listAuths()).toHaveLength(1);
  });

  it("a STRUCTURAL draft change (different window) cancels the stale booking (intent voided) and mints a fresh one", async () => {
    const first = await ensureBookingPaymentIntent(config, baseInput());
    expect(first.kind).toBe("ready");
    if (first.kind !== "ready") return;

    // The customer picks a different (still valid) hour: the booking row
    // itself is stale, not just its amount.
    const otherWindow = windowFor(departureAt, 21);
    const second = await ensureBookingPaymentIntent(
      config,
      baseInput({ existingBookingId: first.bookingId, ...otherWindow }),
    );
    expect(second.kind).toBe("ready");
    if (second.kind !== "ready") return;
    expect(second.bookingId).not.toBe(first.bookingId);
    expect(second.providerRef).not.toBe(first.providerRef);

    // Stale draft: cancelled through the matrix, intent voided.
    expect((await bookingRow(first.bookingId)).status).toBe("cancelled");
    expect(provider.inspectAuth(first.providerRef)?.state).toBe("cancelled");
    expect((await paymentRow(first.bookingId)).status).toBe("cancelled");

    // Fresh draft carries the new window; exactly the cancelled + fresh rows exist.
    const fresh = await bookingRow(second.bookingId);
    expect(fresh.pickupWindowStart?.toISOString()).toBe(
      otherWindow.pickupWindowStart.toISOString(),
    );
    expect(fresh.pickupWindowEnd?.toISOString()).toBe(
      otherWindow.pickupWindowEnd.toISOString(),
    );
    expect(await db.select().from(bookings)).toHaveLength(2);

    const { breakdown } = await quoteBookingPrice(config, {
      pickupWindowEnd: otherWindow.pickupWindowEnd,
      departureAt,
      bagCount: 1,
      distanceKm: 20,
    });
    expect(second.amountCents).toBe(breakdown.totalCents);
  });

  it("an already-authorized intent (webhook raced ahead) routes to the return path instead of re-mounting", async () => {
    const first = await ensureBookingPaymentIntent(config, baseInput());
    expect(first.kind).toBe("ready");
    if (first.kind !== "ready") return;

    provider.simulateClientConfirmation(first.providerRef, "success");
    const { payload, signature } = provider.simulateWebhook({
      type: "payment.authorized",
      providerRef: first.providerRef,
    });
    await handlePaymentEvent(config, provider.verifyWebhook(payload, signature));
    expect((await bookingRow(first.bookingId)).status).toBe("paid");

    const revisit = await ensureBookingPaymentIntent(
      config,
      baseInput({ existingBookingId: first.bookingId }),
    );
    expect(revisit).toEqual({ kind: "already_authorized", bookingId: first.bookingId });
  });

  it("instant-auth provider (dev default) reports already_authorized from the same seam", async () => {
    const instant = new FakePaymentProvider();
    const instantConfig = createCoreConfig({
      db,
      payments: instant,
      clock: fixedClock(now),
    });

    const result = await ensureBookingPaymentIntent(instantConfig, baseInput());
    expect(result.kind).toBe("already_authorized");
    if (result.kind !== "already_authorized") return;
    expect((await bookingRow(result.bookingId)).status).toBe("paid");
  });

  /* ------------------------------------------------------------------ */
  /* The matrix stays the only mover                                      */
  /* ------------------------------------------------------------------ */

  it("the authorized WEBHOOK advances the deferred-confirmation booking to paid (extends the existing pin)", async () => {
    const first = await ensureBookingPaymentIntent(config, baseInput());
    expect(first.kind).toBe("ready");
    if (first.kind !== "ready") return;

    provider.simulateClientConfirmation(first.providerRef, "success");
    const { payload, signature } = provider.simulateWebhook({
      type: "payment.authorized",
      providerRef: first.providerRef,
    });
    const outcome = await handlePaymentEvent(
      config,
      provider.verifyWebhook(payload, signature),
    );
    expect(outcome.handled).toBe(true);

    expect((await bookingRow(first.bookingId)).status).toBe("paid");
    expect((await paymentRow(first.bookingId)).status).toBe("authorized");
  });

  it("a FAILED confirmation cannot reach paid: the booking stays draft and the same intent stays retryable", async () => {
    const first = await ensureBookingPaymentIntent(config, baseInput());
    expect(first.kind).toBe("ready");
    if (first.kind !== "ready") return;

    provider.simulateClientConfirmation(first.providerRef, "failure");

    // The provider also reports the failure — recording it must not move the booking.
    const { payload, signature } = provider.simulateWebhook({
      type: "payment.failed",
      providerRef: first.providerRef,
    });
    await handlePaymentEvent(config, provider.verifyWebhook(payload, signature));
    expect((await bookingRow(first.bookingId)).status).toBe("draft");

    // The return page tells the customer to retry; nothing advanced.
    const outcome = await reconcileBookingPayment(config, {
      bookingId: first.bookingId,
      userId,
    });
    expect(outcome.outcome).toBe("not_completed");
    expect((await bookingRow(first.bookingId)).status).toBe("draft");
  });

  /* ------------------------------------------------------------------ */
  /* Return-page status re-check                                          */
  /* ------------------------------------------------------------------ */

  it("re-check after a successful confirmation advances draft → paid through the matrix, idempotently", async () => {
    const first = await ensureBookingPaymentIntent(config, baseInput());
    expect(first.kind).toBe("ready");
    if (first.kind !== "ready") return;

    provider.simulateClientConfirmation(first.providerRef, "success");

    const outcome = await reconcileBookingPayment(config, {
      bookingId: first.bookingId,
      userId,
    });
    expect(outcome.outcome).toBe("authorized");
    expect((await bookingRow(first.bookingId)).status).toBe("paid");
    expect((await paymentRow(first.bookingId)).status).toBe("authorized");

    const trail = await db
      .select()
      .from(custodyEvents)
      .where(eq(custodyEvents.bookingId, first.bookingId));
    const authorizedEvents = trail.filter(
      (e) => e.eventType === "booking.payment_authorized",
    );
    expect(authorizedEvents).toHaveLength(1);
    expect(authorizedEvents[0]!.metadata).toMatchObject({
      source: "return_page_recheck",
    });

    // Refresh of the return page: success again, still exactly one event.
    const again = await reconcileBookingPayment(config, {
      bookingId: first.bookingId,
      userId,
    });
    expect(again.outcome).toBe("authorized");
    const trailAfter = await db
      .select()
      .from(custodyEvents)
      .where(eq(custodyEvents.bookingId, first.bookingId));
    expect(
      trailAfter.filter((e) => e.eventType === "booking.payment_authorized"),
    ).toHaveLength(1);
  });

  it("re-check maps processing → processing without touching the booking", async () => {
    const first = await ensureBookingPaymentIntent(config, baseInput());
    expect(first.kind).toBe("ready");
    if (first.kind !== "ready") return;

    provider.simulateClientConfirmation(first.providerRef, "processing");

    const outcome = await reconcileBookingPayment(config, {
      bookingId: first.bookingId,
      userId,
    });
    expect(outcome.outcome).toBe("processing");
    expect((await bookingRow(first.bookingId)).status).toBe("draft");
    expect((await paymentRow(first.bookingId)).status).toBe("pending");
  });

  it("re-check maps a dead (cancelled) intent → failed and records it", async () => {
    const first = await ensureBookingPaymentIntent(config, baseInput());
    expect(first.kind).toBe("ready");
    if (first.kind !== "ready") return;

    await provider.cancelAuth(first.providerRef);

    const outcome = await reconcileBookingPayment(config, {
      bookingId: first.bookingId,
      userId,
    });
    expect(outcome.outcome).toBe("failed");
    expect((await bookingRow(first.bookingId)).status).toBe("draft");
    expect((await paymentRow(first.bookingId)).status).toBe("cancelled");
  });

  it("re-check after the WEBHOOK already advanced the booking succeeds without a duplicate event", async () => {
    const first = await ensureBookingPaymentIntent(config, baseInput());
    expect(first.kind).toBe("ready");
    if (first.kind !== "ready") return;

    provider.simulateClientConfirmation(first.providerRef, "success");
    const { payload, signature } = provider.simulateWebhook({
      type: "payment.authorized",
      providerRef: first.providerRef,
    });
    await handlePaymentEvent(config, provider.verifyWebhook(payload, signature));

    const outcome = await reconcileBookingPayment(config, {
      bookingId: first.bookingId,
      userId,
    });
    expect(outcome.outcome).toBe("authorized");

    const trail = await db
      .select()
      .from(custodyEvents)
      .where(eq(custodyEvents.bookingId, first.bookingId));
    expect(
      trail.filter((e) => e.eventType === "booking.payment_authorized"),
    ).toHaveLength(1);
  });

  it("re-check enforces ownership with a 404-shaped error", async () => {
    const first = await ensureBookingPaymentIntent(config, baseInput());
    expect(first.kind).toBe("ready");
    if (first.kind !== "ready") return;

    await expect(
      reconcileBookingPayment(config, {
        bookingId: first.bookingId,
        userId: otherUserId,
      }),
    ).rejects.toThrow(NotFoundError);
  });

  /* ------------------------------------------------------------------ */
  /* Contact phone attach                                                 */
  /* ------------------------------------------------------------------ */

  it("setBookingContactPhone updates the owner's draft and refuses everyone/everything else", async () => {
    const first = await ensureBookingPaymentIntent(config, baseInput());
    expect(first.kind).toBe("ready");
    if (first.kind !== "ready") return;

    const updated = await setBookingContactPhone(config, {
      bookingId: first.bookingId,
      userId,
      contactPhone: "+12125550100",
    });
    expect(updated.contactPhone).toBe("+12125550100");

    // Foreign session: 404-shaped, row untouched.
    await expect(
      setBookingContactPhone(config, {
        bookingId: first.bookingId,
        userId: otherUserId,
        contactPhone: "+13135550100",
      }),
    ).rejects.toThrow(NotFoundError);
    expect((await bookingRow(first.bookingId)).contactPhone).toBe("+12125550100");

    // Once paid, the draft-only guard refuses.
    provider.simulateClientConfirmation(first.providerRef, "success");
    await reconcileBookingPayment(config, { bookingId: first.bookingId, userId });
    await expect(
      setBookingContactPhone(config, {
        bookingId: first.bookingId,
        userId,
        contactPhone: "+14145550100",
      }),
    ).rejects.toThrow(NotFoundError);
  });
});
