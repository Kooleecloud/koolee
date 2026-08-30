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
  verificationTasks,
  type Database,
} from "@koolee/db";
import { TEST_AIRPORTS } from "../test-utils/airport-fixtures";

import type { AgentSession } from "../auth/types";
import { createCoreConfig, fixedClock, type CoreConfig } from "../config";
import { FakePaymentProvider } from "../payments/fake";
import { reportVisitException } from "../services/agent-visit";
import { applyTransition } from "../services/bookings";
import { createBooking } from "../services/create-booking";
import { ensureAddress } from "../services/customers";
import { RecordingEmitter, type DomainEvent, type EventEmitter } from "./emitter";
import { BOOKING_EXCEPTION_RAISED } from "./booking-events";

/**
 * B2 — the exception ops alert must cover every path into `exception`, not
 * just the Stripe webhook.
 *
 * What is actually pinned here:
 *  - the OPERATIONAL path (an agent flagging a problem at the door) emits,
 *    which it did not before this slice;
 *  - exactly ONE event per raise, carrying the unchanged wire name and
 *    payload shape the existing Inngest function consumes;
 *  - a losing concurrent transition emits nothing — no status change, no
 *    alert;
 *  - a THROWING emitter does not fail the transition. This is the rule that
 *    matters operationally: a queue outage must never stop an agent
 *    recording what happened at a customer's door.
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIntegration = TEST_DATABASE_URL ? describe : describe.skip;

if (!TEST_DATABASE_URL) {
  console.log(
    "[integration] TEST_DATABASE_URL not set — skipping exception-emit tests.",
  );
}

const migrationsFolder = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../db/drizzle",
);

/** Every emit fails, the way a queue outage does. */
class ThrowingEmitter implements EventEmitter {
  attempts = 0;

  async emit(_event: DomainEvent): Promise<void> {
    this.attempts += 1;
    throw new Error("queue unreachable");
  }
}

const HOUR = 3_600_000;
function windowFor(departureAt: Date, leadHours = 20) {
  const end = new Date(
    Math.floor((departureAt.getTime() - leadHours * HOUR) / HOUR) * HOUR,
  );
  return { pickupWindowStart: new Date(end.getTime() - HOUR), pickupWindowEnd: end };
}

describeIntegration("booking/exception_raised emission (integration)", () => {
  let sqlClient: ReturnType<typeof postgres>;
  let db: Database;
  let emitter: RecordingEmitter;
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
    emitter = new RecordingEmitter();
    config = createCoreConfig({
      db,
      payments: new FakePaymentProvider(),
      clock: fixedClock(now),
      emitter,
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

    const [customer] = await db
      .insert(users)
      .values({ phone: "+15551190001", role: "customer" })
      .returning();
    customerId = customer!.id;

    const [agent] = await db
      .insert(users)
      .values({ email: "emit.agent@koolee-test.example", role: "agent" })
      .returning();
    agentUserId = agent!.id;
    agentSession = { kind: "agent", role: "agent", userId: agentUserId };
  });

  /** Booking in `agent_assigned` with a verification task for our agent. */
  async function assignedBooking() {
    const address = await ensureAddress(db, customerId, {
      line1: "1 Emit St",
      city: "New York",
      state: "NY",
      zip: "10001",
    });
    const { booking } = await createBooking(config, {
      userId: customerId,
      pickupAddressId: address.id,
      quotedZip: address.zip,
      ...windowFor(departureAt),
      flightNumber: "DL123",
      airlineIata: "DL",
      departureAirport: "JFK",
      departureAt,
      scope: "domestic",
      paxName: "Emit Customer",
      bagCount: 2,
      distanceKm: 20,
    });
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

  it("a field exception raised by an agent emits exactly one event", async () => {
    const { booking, task } = await assignedBooking();

    const result = await reportVisitException(config, agentSession, {
      taskId: task.id,
      reason: "customer_not_home",
      note: "No answer at the door after 10 minutes.",
    });
    expect(result.ok).toBe(true);

    const events = emitter.byName(BOOKING_EXCEPTION_RAISED);
    expect(events).toHaveLength(1);
    expect(events[0]!.data).toEqual({
      bookingId: booking.id,
      // Reason and note, joined — what ops reads in the alert body.
      reason: "customer_not_home — No answer at the door after 10 minutes.",
      raisedByUserId: agentUserId,
    });
  });

  it("dedupes on the custody event id, so two raises are two distinct events", async () => {
    const { booking, task } = await assignedBooking();

    await reportVisitException(config, agentSession, {
      taskId: task.id,
      reason: "customer_not_home",
    });
    // Back out of exception the way ops would, then raise again.
    await applyTransition(config, {
      bookingId: booking.id,
      event: "resume_transit",
      actor: { userId: agentUserId, role: "agent" },
    });
    await applyTransition(config, {
      bookingId: booking.id,
      event: "raise_exception",
      actor: { userId: agentUserId, role: "agent" },
      metadata: { reason: "bags_refused" },
    });

    const ids = emitter.byName(BOOKING_EXCEPTION_RAISED).map((e) => e.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    for (const id of ids) {
      expect(id).toMatch(new RegExp(`^booking-exception:${booking.id}:`));
    }
  });

  it("emits nothing when the transition is illegal — no move, no alert", async () => {
    const { booking, task } = await assignedBooking();
    const first = await reportVisitException(config, agentSession, {
      taskId: task.id,
      reason: "customer_id_mismatch",
    });
    expect(first.ok).toBe(true);
    emitter.clear();

    // `exception` does not accept `raise_exception`.
    const again = await applyTransition(config, {
      bookingId: booking.id,
      event: "raise_exception",
      actor: { userId: agentUserId, role: "agent" },
    });

    expect(again.ok).toBe(false);
    expect(emitter.emitted).toHaveLength(0);
  });

  it("a throwing emitter does not fail the transition", async () => {
    const throwing = new ThrowingEmitter();
    const outageConfig = createCoreConfig({
      db,
      payments: new FakePaymentProvider(),
      clock: fixedClock(now),
      emitter: throwing,
    });
    const { booking, task } = await assignedBooking();

    const result = await reportVisitException(outageConfig, agentSession, {
      taskId: task.id,
      reason: "bags_refused",
    });

    expect(result.ok).toBe(true);
    expect(throwing.attempts).toBe(1);

    // The facts that matter are on disk regardless of the queue.
    const row = await db.query.bookings.findFirst({ where: eq(bookings.id, booking.id) });
    expect(row?.status).toBe("exception");

    const events = await db
      .select()
      .from(custodyEvents)
      .where(eq(custodyEvents.bookingId, booking.id));
    expect(events.some((e) => e.eventType === "booking.exception_raised")).toBe(true);

    const [failedTask] = await db
      .select()
      .from(verificationTasks)
      .where(eq(verificationTasks.id, task.id));
    expect(failedTask?.status).toBe("failed");
  });

  it("an admin override's note becomes the reason — it writes note, never reason", async () => {
    const { booking, task } = await assignedBooking();
    void task;

    // Exactly what apps/admin/src/app/bookings/actions.ts sends.
    await applyTransition(config, {
      bookingId: booking.id,
      event: "raise_exception",
      actor: { userId: agentUserId, role: "admin" },
      metadata: { source: "admin_manual_override", note: "Customer called to cancel." },
    });

    const [event] = emitter.byName(BOOKING_EXCEPTION_RAISED);
    expect(event!.data).toMatchObject({ reason: "Customer called to cancel." });
  });

  it("falls back to a generic sentence when the metadata says nothing", async () => {
    const { booking } = await assignedBooking();

    await applyTransition(config, {
      bookingId: booking.id,
      event: "raise_exception",
      metadata: { source: "admin_manual_override" },
    });

    const [event] = emitter.byName(BOOKING_EXCEPTION_RAISED);
    expect(event!.data).toMatchObject({
      reason: "Booking moved to exception by raise_exception.",
    });
  });

  it("a system-raised exception (no actor) omits raisedByUserId rather than sending null", async () => {
    const { booking, task } = await assignedBooking();
    void task;

    await applyTransition(config, {
      bookingId: booking.id,
      event: "raise_exception",
      metadata: { reason: "payment_capture_failed", detail: "card declined" },
    });

    const [event] = emitter.byName(BOOKING_EXCEPTION_RAISED);
    expect(event!.data).toEqual({
      bookingId: booking.id,
      reason: "payment_capture_failed — card declined",
    });
  });
});
