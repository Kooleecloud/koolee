import { fileURLToPath } from "node:url";
import path from "node:path";

import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  airlineCutoffs,
  airports,
  bags,
  bookings,
  createDb,
  custodyEvents,
  payments,
  pricingRules,
  users,
  verificationTasks,
  type Database,
} from "@koolee/db";

import type { AgentSession } from "../auth/types";
import { createCoreConfig, fixedClock, type CoreConfig } from "../config";
import { NotFoundError } from "../errors";
import { FakePaymentProvider } from "../payments/fake";
import {
  arriveAtVisit,
  completeVerificationVisit,
  getVisitContext,
  recordBagSealed,
  recordIdentityVerified,
  reportVisitException,
} from "./agent-visit";
import { createBooking } from "./create-booking";
import { captureDueBookings } from "./payment-lifecycle";
import { ensureAddress } from "./customers";

/**
 * Phase 6 acceptance — the verification visit at the core level:
 *
 *  - full happy path: arrive → ID check → per-bag seal → complete →
 *    payment CAPTURED via the seam → booking advanced through the matrix;
 *  - every step's custody event carries the REAL agent actor id and the
 *    log stays append-only;
 *  - exception path: correct state + event with the reason;
 *  - assignment IS the authorization: someone else's task 404s.
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIntegration = TEST_DATABASE_URL ? describe : describe.skip;

if (!TEST_DATABASE_URL) {
  console.log("[integration] TEST_DATABASE_URL not set — skipping agent-visit tests.");
}

const migrationsFolder = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../db/drizzle",
);

const HOUR = 3_600_000;
/** A clock-aligned one-hour pickup window, mid-band and notice-safe. */
function windowFor(departureAt: Date, leadHours = 20) {
  const end = new Date(
    Math.floor((departureAt.getTime() - leadHours * HOUR) / HOUR) * HOUR,
  );
  return { pickupWindowStart: new Date(end.getTime() - HOUR), pickupWindowEnd: end };
}

describeIntegration("agent verification visit (integration)", () => {
  let sqlClient: ReturnType<typeof postgres>;
  let db: Database;
  let provider: FakePaymentProvider;
  let config: CoreConfig;

  const now = new Date("2025-06-10T10:00:00Z");
  const departureAt = new Date("2025-06-12T22:00:00Z");
  let customerId: string;
  let agentUserId: string;
  let agentSession: AgentSession;

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
      leadTimeMultipliers: [],
      discountRules: [],
      active: true,
    });

    const [customer] = await db
      .insert(users)
      .values({ phone: "+15551120001", role: "customer" })
      .returning();
    customerId = customer!.id;

    const [agent] = await db
      .insert(users)
      .values({ email: "visit.agent@koolee-test.example", role: "agent" })
      .returning();
    agentUserId = agent!.id;
    agentSession = { kind: "agent", role: "agent", userId: agentUserId };
  });

  /** Booking in `agent_assigned` with a verification task for our agent. */
  async function assignedBooking(bagCount = 2) {
    const address = await ensureAddress(db, customerId, {
      line1: "1 Test St",
      city: "New York",
      state: "NY",
      zip: "10001",
    });
    const { booking } = await createBooking(config, {
      userId: customerId,
      pickupAddressId: address.id,
      ...windowFor(departureAt),
      flightNumber: "DL123",
      airlineIata: "DL",
      departureAirport: "JFK",
      departureAt,
      scope: "domestic",
      paxName: "Test Customer",
      bagCount,
      distanceKm: 20,
    });
    // Dispatch (Phase 7 builds the UI; the rows are the mechanism).
    await db
      .update(bookings)
      .set({ status: "agent_assigned" })
      .where(eq(bookings.id, booking.id));
    const [task] = await db
      .insert(verificationTasks)
      .values({
        bookingId: booking.id,
        assigneeUserId: agentUserId,
        status: "assigned",
        scheduledStart: new Date("2025-06-12T12:00:00Z"),
        scheduledEnd: new Date("2025-06-12T16:00:00Z"),
      })
      .returning();
    return { booking, task: task! };
  }

  it("full visit: arrive → ID check → seal every bag → complete → capture → booking verified_sealed", async () => {
    const { booking, task } = await assignedBooking(2);

    let context = await arriveAtVisit(config, agentSession, { taskId: task.id, lat: 40.7, lng: -74.0 });
    expect(context.task.status).toBe("in_progress");
    expect(context.task.startedAt).not.toBeNull();

    // Arrival is idempotent — a retry doesn't duplicate the event.
    context = await arriveAtVisit(config, agentSession, { taskId: task.id });
    expect(
      context.timeline.filter((e) => e.eventType === "visit.arrived"),
    ).toHaveLength(1);

    context = await recordIdentityVerified(config, agentSession, { taskId: task.id });

    // Seal by ORDINAL, and re-read the list after each seal: the regression
    // this guards against is the visible one — an agent sealed the bag shown
    // as "Bag 1" and the seal reappeared under "Bag 3", because bags share a
    // `created_at` and the old `order by created_at` was a non-deterministic
    // tie that an UPDATE could reshuffle.
    const ordinalsBefore = context.bags.map((b) => b.ordinal);
    expect(ordinalsBefore).toEqual([1, 2]);

    for (const bag of [...context.bags]) {
      await recordBagSealed(config, agentSession, {
        taskId: task.id,
        bagId: bag.id,
        sealId: `SEAL-00${bag.ordinal}`,
        weightKg: 18.5,
        photoPath: `bags/${bag.id}/photo.jpg`,
      });

      // Position AND identity must survive the write.
      const after = await getVisitContext(db, agentSession, task.id);
      expect(after.bags.map((b) => b.ordinal)).toEqual(ordinalsBefore);
      expect(after.bags.map((b) => b.id)).toEqual(context.bags.map((b) => b.id));
      // The seal landed on the bag we named, not on a neighbour.
      expect(after.bags.find((b) => b.id === bag.id)!.sealId).toBe(`SEAL-00${bag.ordinal}`);
    }

    const result = await completeVerificationVisit(config, agentSession, {
      taskId: task.id,
      lat: 40.7,
      lng: -74.0,
    });
    // Completing a visit is CUSTODY ONLY now. The agent app holds no payment
    // credentials, so charging here used to fail every pickup — money is swept
    // separately by `captureDueBookings` from the app that owns Stripe.
    expect(result).toEqual({ ok: true });

    // Booking advanced through the matrix; task closed out.
    const [bookingRow] = await db.select().from(bookings).where(eq(bookings.id, booking.id));
    expect(bookingRow!.status).toBe("verified_sealed");
    const [taskRow] = await db
      .select()
      .from(verificationTasks)
      .where(eq(verificationTasks.id, task.id));
    expect(taskRow!.status).toBe("done");
    expect(taskRow!.completedAt).not.toBeNull();

    // Explicitly NOT captured by completing the visit: the authorization is
    // untouched and no money moved on this device.
    const [paymentRow] = await db
      .select()
      .from(payments)
      .where(eq(payments.bookingId, booking.id));
    expect(paymentRow!.status).toBe("authorized");
    expect(provider.inspectAuth(paymentRow!.providerRef)?.state).toBe("authorized");

    // …and the sweep, run where the provider lives, is what charges it.
    const swept = await captureDueBookings(config);
    expect(swept.captured).toEqual([booking.id]);
    expect(swept.failed).toEqual([]);

    const [afterSweep] = await db
      .select()
      .from(payments)
      .where(eq(payments.bookingId, booking.id));
    expect(afterSweep!.status).toBe("captured");
    expect(provider.inspectAuth(afterSweep!.providerRef)?.state).toBe("captured");

    // Idempotent: a second pass finds nothing left to do.
    expect(await captureDueBookings(config)).toEqual({ captured: [], failed: [] });

    // Bags carry seals, weights, photo paths.
    const bagRows = await db.select().from(bags).where(eq(bags.bookingId, booking.id));
    expect(bagRows.map((b) => b.sealId).sort()).toEqual(["SEAL-001", "SEAL-002"]);
    expect(bagRows.every((b) => b.photoUrls.length === 1)).toBe(true);

    // The custody trail tells the whole visit, in order, with the REAL
    // agent as actor on every step the agent performed.
    const events = await db
      .select()
      .from(custodyEvents)
      .where(eq(custodyEvents.bookingId, booking.id))
      .orderBy(asc(custodyEvents.createdAt));
    const types = events.map((e) => e.eventType);
    expect(types).toContain("visit.arrived");
    expect(types).toContain("visit.identity_verified");
    expect(types.filter((t) => t === "bag.sealed")).toHaveLength(2);
    expect(types).toContain("booking.verified_sealed");
    expect(types).toContain("booking.payment_captured");

    // Every step the AGENT performed carries the real agent actor.
    const agentEvents = events.filter((e) =>
      ["visit.arrived", "visit.identity_verified", "bag.sealed", "booking.verified_sealed"].includes(
        e.eventType,
      ),
    );
    for (const event of agentEvents) {
      expect(event.actorUserId, event.eventType).toBe(agentUserId);
      expect(event.actorRole, event.eventType).toBe("agent");
      expect(event.createdAt).toBeInstanceOf(Date);
    }

    // The capture is deliberately NOT the agent's: it is swept by the system,
    // so the custody trail must not attribute the charge to a person who was
    // standing at a door and never touched a card.
    const captureEvent = events.find((e) => e.eventType === "booking.payment_captured");
    expect(captureEvent!.actorUserId).toBeNull();
    expect(captureEvent!.actorRole).toBeNull();
    // GPS landed where provided; the seal photo is on the bag event.
    const sealed = events.find((e) => e.eventType === "bag.sealed");
    expect(sealed?.photoUrl).toMatch(/^bags\//);
    const arrived = events.find((e) => e.eventType === "visit.arrived");
    expect(arrived?.lat).toBeCloseTo(40.7);

    // Append-only stands: the trail cannot be rewritten.
    await expect(
      db.update(custodyEvents).set({ eventType: "tampered" }).where(eq(custodyEvents.id, events[0]!.id)),
    ).rejects.toThrow();
  });

  it("completion is refused while any bag is unsealed", async () => {
    const { task } = await assignedBooking(2);
    const context = await arriveAtVisit(config, agentSession, { taskId: task.id });
    await recordIdentityVerified(config, agentSession, { taskId: task.id });
    await recordBagSealed(config, agentSession, {
      taskId: task.id,
      bagId: context.bags[0]!.id,
      sealId: "SEAL-ONLY-ONE",
    });

    const result = await completeVerificationVisit(config, agentSession, {
      taskId: task.id,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/not sealed/);
  });

  it("exception path: booking → exception with the reason; task failed; actor recorded", async () => {
    const { booking, task } = await assignedBooking(1);
    await arriveAtVisit(config, agentSession, { taskId: task.id });

    const result = await reportVisitException(config, agentSession, {
      taskId: task.id,
      reason: "customer_not_home",
      note: "no answer after 10 minutes",
    });
    expect(result).toEqual({ ok: true });

    const [bookingRow] = await db.select().from(bookings).where(eq(bookings.id, booking.id));
    expect(bookingRow!.status).toBe("exception");
    const [taskRow] = await db
      .select()
      .from(verificationTasks)
      .where(eq(verificationTasks.id, task.id));
    expect(taskRow!.status).toBe("failed");

    const events = await db
      .select()
      .from(custodyEvents)
      .where(eq(custodyEvents.bookingId, booking.id));
    const exception = events.find((e) => e.eventType === "booking.exception_raised");
    expect(exception).toBeDefined();
    expect(exception!.actorUserId).toBe(agentUserId);
    expect(exception!.metadata).toMatchObject({
      reason: "customer_not_home",
      note: "no answer after 10 minutes",
    });
  });

  it("assignment is the authorization: another agent's task 404s at every step", async () => {
    const { task } = await assignedBooking(1);
    const [other] = await db
      .insert(users)
      .values({ email: "other.agent@koolee-test.example", role: "agent" })
      .returning();
    const otherSession: AgentSession = { kind: "agent", role: "agent", userId: other!.id };

    await expect(
      arriveAtVisit(config, otherSession, { taskId: task.id }),
    ).rejects.toThrow(NotFoundError);
    await expect(
      completeVerificationVisit(config, otherSession, { taskId: task.id }),
    ).rejects.toThrow(NotFoundError);
  });
});
