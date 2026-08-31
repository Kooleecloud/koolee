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
  pickupTasks,
  pricingRules,
  staffMembers,
  users,
  verificationTasks,
  type Database,
} from "@koolee/db";
import { TEST_AIRPORTS } from "../test-utils/airport-fixtures";

import { createCoreConfig, fixedClock, type CoreConfig } from "../config";
import { FakePaymentProvider } from "../payments/fake";
import {
  assignEnteringHorizon,
  autoAssignBooking,
  autoAssignOnPaid,
} from "./auto-assign";
import { ensureAddress } from "./customers";
import { getOpsDashboard, listBookingsBoard } from "./dispatch";
import {
  ensureBookingPaymentIntent,
  reconcileBookingPayment,
  type EnsurePaymentIntentInput,
} from "./payment-intent";

/**
 * F3 Phase 1 acceptance — assignment is DEFERRED to a horizon.
 *
 * Before this slice, paying for a June flight in March named an agent in
 * March: a task nobody could act on sat in somebody's list for three months,
 * against a roster that would have changed by the time it mattered.
 *
 * The two halves have to be proven together against a real database, because
 * both of the properties that make deferral safe are database properties:
 * the sweep's "no verification task" selection, and the 0019 unique index on
 * `verification_tasks(booking_id)` refereeing two sweeps that raced.
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIntegration = TEST_DATABASE_URL ? describe : describe.skip;

if (!TEST_DATABASE_URL) {
  console.log(
    "[integration] TEST_DATABASE_URL not set — skipping assignment-horizon tests.",
  );
}

const migrationsFolder = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../db/drizzle",
);

const HOUR = 3_600_000;

/** A clock-aligned one-hour pickup window ending `leadHours` before departure. */
function windowFor(departureAt: Date, leadHours = 20) {
  const end = new Date(
    Math.floor((departureAt.getTime() - leadHours * HOUR) / HOUR) * HOUR,
  );
  return { pickupWindowStart: new Date(end.getTime() - HOUR), pickupWindowEnd: end };
}

describeIntegration("assignment horizon (integration)", () => {
  let sqlClient: ReturnType<typeof postgres>;
  let db: Database;
  let provider: FakePaymentProvider;

  /** "Now" for every test in this file. */
  const now = new Date("2026-06-10T10:00:00Z");

  let userId: string;
  let agentId: string;
  let addressId: string;

  /** A runtime whose clock is `at` and whose horizon is `horizonHours`. */
  function configAt(at: Date, horizonHours?: number): CoreConfig {
    return createCoreConfig({
      db,
      payments: provider,
      clock: fixedClock(at),
      ...(horizonHours === undefined
        ? {}
        : { defaults: { assignmentHorizonHours: horizonHours } }),
    });
  }

  beforeAll(async () => {
    sqlClient = postgres(TEST_DATABASE_URL!, { max: 1, prepare: false });
    await migrate(drizzle(sqlClient), { migrationsFolder });
    db = createDb({ url: TEST_DATABASE_URL!, max: 8 });
  });

  afterAll(async () => {
    await sqlClient?.end();
  });

  beforeEach(async () => {
    provider = new FakePaymentProvider({ requiresClientConfirmation: true });

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
      DELETE FROM agent_zones;
      DELETE FROM staff_members;
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
      leadTimeMultipliers: [],
      discountRules: [],
      active: true,
    });

    const [customer] = await db
      .insert(users)
      .values({ phone: "+15551150001", role: "customer" })
      .returning();
    userId = customer!.id;

    const [agent] = await db
      .insert(users)
      .values({ email: "horizon.agent@koolee-test.example", role: "agent" })
      .returning();
    agentId = agent!.id;
    await db
      .insert(staffMembers)
      .values({ userId: agentId, role: "agent", active: true });
    await db.insert(agentZones).values({ agentUserId: agentId, zip: "10001" });

    const address = await ensureAddress(db, userId, {
      line1: "1 Test St",
      city: "New York",
      state: "NY",
      zip: "10001",
    });
    addressId = address.id;
  });

  function baseInput(
    departureAt: Date,
    overrides: Partial<EnsurePaymentIntentInput> = {},
  ): EnsurePaymentIntentInput {
    return {
      userId,
      pickupAddressId: addressId,
      quotedZip: "10001",
      ...windowFor(departureAt),
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

  /** Takes a booking all the way to `paid`, firing the real on-paid hook. */
  async function payFor(config: CoreConfig, departureAt: Date): Promise<string> {
    const intent = await ensureBookingPaymentIntent(config, baseInput(departureAt));
    if (intent.kind !== "ready")
      throw new Error(`expected ready intent, got ${intent.kind}`);
    provider.simulateClientConfirmation(intent.providerRef, "success");
    const recheck = await reconcileBookingPayment(config, {
      bookingId: intent.bookingId,
      userId,
    });
    expect(recheck.outcome).toBe("authorized");
    return intent.bookingId;
  }

  async function stateOf(bookingId: string) {
    const [booking, vTasks, pTasks, events] = await Promise.all([
      db.query.bookings.findFirst({ where: eq(bookings.id, bookingId) }),
      db
        .select()
        .from(verificationTasks)
        .where(eq(verificationTasks.bookingId, bookingId)),
      db.select().from(pickupTasks).where(eq(pickupTasks.bookingId, bookingId)),
      db.select().from(custodyEvents).where(eq(custodyEvents.bookingId, bookingId)),
    ]);
    return {
      status: booking?.status,
      windowStart: booking?.pickupWindowStart ?? null,
      vTasks,
      pTasks,
      assignEvents: events.filter((e) => e.eventType === "booking.agent_assigned"),
      /**
       * The tell for the bug this test caught: a sweep that lost the race
       * used to fall through to the UPDATE branch and move the booking to a
       * different agent, appending one of these. No custody row is wrong, but
       * an automatic path is not allowed to reassign anybody.
       */
      reassignEvents: events.filter((e) => e.eventType === "booking.agent_reassigned"),
    };
  }

  /* ---------------------------------------------------------------- */
  /* On-paid                                                           */
  /* ---------------------------------------------------------------- */

  it("assigns immediately when the window is already inside the horizon", async () => {
    // Departure ~2.5 days out ⇒ window ~1.6 days out ⇒ inside 48h.
    const bookingId = await payFor(configAt(now), new Date("2026-06-12T22:00:00Z"));

    const state = await stateOf(bookingId);
    expect(state.status).toBe("agent_assigned");
    expect(state.vTasks).toHaveLength(1);
    expect(state.pTasks).toHaveLength(1);
    expect(state.assignEvents).toHaveLength(1);
  });

  it("creates NOTHING beyond the horizon — no task pair, no custody event", async () => {
    // Departure three months out.
    const bookingId = await payFor(configAt(now), new Date("2026-09-12T22:00:00Z"));

    const state = await stateOf(bookingId);
    expect(state.status).toBe("paid");
    // The paired-creation invariant is preserved by deferring BOTH halves:
    // neither task exists, so the pair can never be half-made.
    expect(state.vTasks).toHaveLength(0);
    expect(state.pTasks).toHaveLength(0);
    expect(state.assignEvents).toHaveLength(0);
  });

  it("respects a SHORTENED horizon — the number is configuration, not a constant", async () => {
    // Window ~1.6 days out; a 6-hour horizon defers it, the 48h default would not.
    const bookingId = await payFor(configAt(now, 6), new Date("2026-06-12T22:00:00Z"));

    expect((await stateOf(bookingId)).status).toBe("paid");
    expect((await stateOf(bookingId)).vTasks).toHaveLength(0);
  });

  /* ---------------------------------------------------------------- */
  /* The sweep                                                         */
  /* ---------------------------------------------------------------- */

  it("assigns exactly once when the window enters the horizon", async () => {
    const departureAt = new Date("2026-09-12T22:00:00Z");
    const bookingId = await payFor(configAt(now), departureAt);
    expect((await stateOf(bookingId)).status).toBe("paid");

    const windowStart = windowFor(departureAt).pickupWindowStart;

    // Still outside: the sweep must not touch it.
    const early = await assignEnteringHorizon(
      configAt(new Date(windowStart.getTime() - 50 * HOUR)),
    );
    expect(early.considered).toBe(0);
    expect((await stateOf(bookingId)).status).toBe("paid");

    // Now inside.
    const swept = await assignEnteringHorizon(
      configAt(new Date(windowStart.getTime() - 47 * HOUR)),
    );
    expect(swept.assigned).toEqual([bookingId]);

    const state = await stateOf(bookingId);
    expect(state.status).toBe("agent_assigned");
    expect(state.vTasks).toHaveLength(1);
    expect(state.pTasks).toHaveLength(1);
    expect(state.assignEvents).toHaveLength(1);
    // System actor — nobody clicked anything.
    expect(state.assignEvents[0]?.actorUserId).toBeNull();
  });

  it("concurrent sweeps assign exactly once — the unique index referees", async () => {
    const departureAt = new Date("2026-09-12T22:00:00Z");
    const bookingId = await payFor(configAt(now), departureAt);
    const windowStart = windowFor(departureAt).pickupWindowStart;
    const at = new Date(windowStart.getTime() - 47 * HOUR);

    const runs = await Promise.all(
      Array.from({ length: 4 }, () => assignEnteringHorizon(configAt(at))),
    );

    // Every run SAW it (they all selected before any of them wrote); exactly
    // one WROTE it, and the losers report `raced`, not an error.
    expect(runs.every((r) => r.considered === 1)).toBe(true);
    expect(runs.flatMap((r) => r.assigned)).toEqual([bookingId]);

    const state = await stateOf(bookingId);
    expect(state.status).toBe("agent_assigned");
    expect(state.vTasks).toHaveLength(1);
    expect(state.pTasks).toHaveLength(1);
    expect(state.assignEvents).toHaveLength(1);
    // The regression this test actually found: three of four runs reported
    // success, because the "never reassigns" check sat OUTSIDE the
    // transaction — several round trips before the write. A straggler passed
    // the check, watched the winner commit, and then took the UPDATE branch.
    // The unique index cannot referee that, because nobody inserts.
    expect(state.reassignEvents).toHaveLength(0);
  });

  it("a sweep re-run over an already-assigned booking is a no-op", async () => {
    const departureAt = new Date("2026-09-12T22:00:00Z");
    const bookingId = await payFor(configAt(now), departureAt);
    const at = new Date(windowFor(departureAt).pickupWindowStart.getTime() - 47 * HOUR);

    await assignEnteringHorizon(configAt(at));
    const second = await assignEnteringHorizon(configAt(at));

    // Invisible to the second sweep BY CONSTRUCTION: it selects only bookings
    // with no verification-task row.
    expect(second.considered).toBe(0);
    expect((await stateOf(bookingId)).assignEvents).toHaveLength(1);
  });

  it("an admin assigning early is left alone — the sweep never reassigns", async () => {
    const departureAt = new Date("2026-09-12T22:00:00Z");
    const bookingId = await payFor(configAt(now), departureAt);

    // Manual early assignment, months before the horizon. The existing
    // assign path is unchanged and still works.
    const manual = await autoAssignBooking(configAt(now), {
      bookingId,
      actor: { userId: agentId, role: "admin" },
    });
    expect(manual.ok).toBe(true);

    const at = new Date(windowFor(departureAt).pickupWindowStart.getTime() - 47 * HOUR);
    const swept = await assignEnteringHorizon(configAt(at));

    expect(swept.considered).toBe(0);
    const state = await stateOf(bookingId);
    expect(state.status).toBe("agent_assigned");
    expect(state.assignEvents).toHaveLength(1);
    // The admin's actor id survived — the sweep did not overwrite the record.
    expect(state.assignEvents[0]?.actorUserId).toBe(agentId);
  });

  it("reports a booking nobody covers as uncovered rather than assigning", async () => {
    const departureAt = new Date("2026-09-12T22:00:00Z");
    const bookingId = await payFor(configAt(now), departureAt);
    await db.delete(agentZones);

    const at = new Date(windowFor(departureAt).pickupWindowStart.getTime() - 47 * HOUR);
    const swept = await assignEnteringHorizon(configAt(at));

    expect(swept.uncovered).toEqual([bookingId]);
    expect(swept.assigned).toEqual([]);
    expect((await stateOf(bookingId)).status).toBe("paid");
  });

  /* ---------------------------------------------------------------- */
  /* At-risk honesty                                                   */
  /* ---------------------------------------------------------------- */

  it("a beyond-horizon booking is never shown as a problem", async () => {
    const departureAt = new Date("2026-09-12T22:00:00Z");
    const bookingId = await payFor(configAt(now), departureAt);
    const windowStart = windowFor(departureAt).pickupWindowStart;

    // Read the board on the DAY of the pickup but with a 1-hour horizon, so
    // the booking is both "today" and legitimately unassigned.
    const readAt = new Date(windowStart.getTime() - 6 * HOUR);

    const deferred = await listBookingsBoard(
      db,
      {},
      { now: readAt, assignmentHorizonHours: 1 },
    );
    expect(deferred.find((r) => r.booking.id === bookingId)).toMatchObject({
      atRisk: false,
      atRiskReason: null,
    });

    const deferredDash = await getOpsDashboard(db, "America/New_York", {
      now: readAt,
      assignmentHorizonHours: 1,
    });
    expect(deferredDash.unassignedToday).toBe(0);

    // The SAME row, the same instant, with a horizon that covers it: now it
    // is genuinely unassigned and the console says so. The distinction is the
    // horizon and nothing else.
    const inHorizon = await listBookingsBoard(
      db,
      {},
      { now: readAt, assignmentHorizonHours: 48 },
    );
    expect(inHorizon.find((r) => r.booking.id === bookingId)).toMatchObject({
      atRisk: true,
      atRiskReason: "no_agent",
    });

    const inHorizonDash = await getOpsDashboard(db, "America/New_York", {
      now: readAt,
      assignmentHorizonHours: 48,
    });
    expect(inHorizonDash.unassignedToday).toBe(1);
  });

  it("still flags an inside-horizon booking nobody covers", async () => {
    await db.delete(agentZones);
    const departureAt = new Date("2026-06-12T22:00:00Z");
    const bookingId = await payFor(configAt(now), departureAt);
    expect((await stateOf(bookingId)).status).toBe("paid");

    const readAt = new Date(
      windowFor(departureAt).pickupWindowStart.getTime() - 6 * HOUR,
    );
    const board = await listBookingsBoard(db, {}, { now: readAt });
    expect(board.find((r) => r.booking.id === bookingId)).toMatchObject({
      atRisk: true,
      atRiskReason: "no_agent",
    });
  });

  /* ---------------------------------------------------------------- */
  /* Consequences                                                      */
  /* ---------------------------------------------------------------- */

  it("a deferred booking is still reminder-worthy: the reminder anchors on the window", async () => {
    // `booking-pickup-reminder` sleeps until 2h before `pickupStartAt` (from
    // the `booking/confirmed` event) and then re-reads the status against
    // REMINDER_WORTHY = {paid, agent_assigned}. Deferral changes which of
    // those two the booking is in and nothing else — and at any horizon above
    // two hours the sweep has already run by then anyway.
    const bookingId = await payFor(configAt(now), new Date("2026-09-12T22:00:00Z"));
    const state = await stateOf(bookingId);
    expect(state.status).toBe("paid");
    expect(["paid", "agent_assigned"]).toContain(state.status);
  });

  it("the on-paid hook never throws, whatever the horizon", async () => {
    await expect(
      autoAssignOnPaid(configAt(now), "00000000-0000-0000-0000-000000000000"),
    ).resolves.toBeUndefined();
  });
});
