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
  bookings,
  createDb,
  custodyEvents,
  payments,
  pickupTasks,
  pricingRules,
  slots,
  staffMembers,
  users,
  verificationTasks,
  type Database,
} from "@koolee/db";

import type { AdminSession } from "../auth/types";
import { createCoreConfig, fixedClock, type CoreConfig } from "../config";
import { FakePaymentProvider } from "../payments/fake";
import { applyTransition } from "./bookings";
import { createBooking } from "./create-booking";
import { ensureAddress } from "./customers";
import {
  assignAgentToBooking,
  getBookingAssignment,
  getOpsDashboard,
  listActiveAgents,
  listBookingsBoard,
  resolveExceptionBooking,
} from "./dispatch";
import { listAssignedTasks } from "./tasks";
import { requireStaffRole } from "./staff";

/**
 * Phase 7 acceptance — dispatch + manual overrides at the core level:
 *
 *  - assignment: paid → agent_assigned via the matrix, both tasks created
 *    with the booking's pickup window, the booking appears in THAT agent's
 *    scoped list;
 *  - reassignment: tasks move, a `booking.agent_reassigned` custody event is
 *    appended, and a completed visit can never be reassigned;
 *  - exception resolution: every path is a legal matrix transition plus a
 *    compensating custody event carrying the admin's real id and a REQUIRED
 *    reason — history is never edited;
 *  - dashboard/board numbers come from real rows.
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIntegration = TEST_DATABASE_URL ? describe : describe.skip;

if (!TEST_DATABASE_URL) {
  console.log("[integration] TEST_DATABASE_URL not set — skipping dispatch tests.");
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

describeIntegration("admin dispatch + overrides (integration)", () => {
  let sqlClient: ReturnType<typeof postgres>;
  let db: Database;
  let provider: FakePaymentProvider;
  let config: CoreConfig;

  // `now` sits on the pickup window's day (so the "today" queries see it)
  // and within the 12h at-risk horizon of its start.
  const now = new Date("2025-06-12T12:30:00Z");
  const departureAt = new Date("2025-06-12T22:00:00Z");
  // 15:00–16:00Z — the last bookable hour before the 6h operations reserve,
  // and the only one satisfying the 2h booking notice from `now`.
  const window = windowFor(departureAt, 6);
  let customerId: string;
  let agentA: string;
  let agentB: string;
  let inactiveAgent: string;
  let adminId: string;
  let adminSession: AdminSession;

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
      discountRules: [],
      active: true,
    });

    const [customer] = await db
      .insert(users)
      .values({ phone: "+15551130001", role: "customer" })
      .returning();
    customerId = customer!.id;

    const staff = await db
      .insert(users)
      .values([
        { email: "dispatch.a@koolee-test.example", role: "agent", fullName: "Agent A" },
        { email: "dispatch.b@koolee-test.example", role: "agent", fullName: "Agent B" },
        { email: "dispatch.gone@koolee-test.example", role: "agent" },
        { email: "dispatch.admin@koolee-test.example", role: "admin" },
      ])
      .returning();
    agentA = staff[0]!.id;
    agentB = staff[1]!.id;
    inactiveAgent = staff[2]!.id;
    adminId = staff[3]!.id;
    await db.insert(staffMembers).values([
      { userId: agentA, role: "agent", active: true },
      { userId: agentB, role: "agent", active: true },
      { userId: inactiveAgent, role: "agent", active: false },
      { userId: adminId, role: "admin", active: true },
    ]);
    adminSession = { kind: "admin", role: "admin", userId: adminId };
  });

  /** A paid booking (createBooking authorizes through the fake provider). */
  async function paidBooking() {
    const address = await ensureAddress(db, customerId, {
      line1: "1 Test St",
      city: "New York",
      state: "NY",
      zip: "10001",
    });
    const { booking } = await createBooking(config, {
      userId: customerId,
      pickupAddressId: address.id,
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
    return booking;
  }

  async function eventTypes(bookingId: string) {
    const rows = await db
      .select()
      .from(custodyEvents)
      .where(eq(custodyEvents.bookingId, bookingId))
      .orderBy(asc(custodyEvents.createdAt));
    return rows;
  }

  /* ------------------------------------------------------------------ */
  /* Assignment                                                          */
  /* ------------------------------------------------------------------ */

  it("assign: paid → agent_assigned, both tasks scheduled to the booking's pickup window, visible in the agent's scoped list", async () => {
    const booking = await paidBooking();

    const result = await assignAgentToBooking(config, adminSession, {
      bookingId: booking.id,
      agentUserId: agentA,
    });
    expect(result).toEqual({ ok: true, reassigned: false });

    const [row] = await db.select().from(bookings).where(eq(bookings.id, booking.id));
    expect(row!.status).toBe("agent_assigned");

    // Both task kinds exist, carry the booking's pickup window (copied from
    // bookings.pickupWindowStart/End — no slots join), and belong to agent A.
    const [verification] = await db
      .select()
      .from(verificationTasks)
      .where(eq(verificationTasks.bookingId, booking.id));
    const [pickup] = await db
      .select()
      .from(pickupTasks)
      .where(eq(pickupTasks.bookingId, booking.id));
    for (const task of [verification!, pickup!]) {
      expect(task.assigneeUserId).toBe(agentA);
      expect(task.status).toBe("assigned");
      expect(task.scheduledStart?.toISOString()).toBe("2025-06-12T15:00:00.000Z");
      expect(task.scheduledEnd?.toISOString()).toBe("2025-06-12T16:00:00.000Z");
    }

    // Scoped visibility: A sees it, B does not.
    const forA = await listAssignedTasks(db, agentA);
    const forB = await listAssignedTasks(db, agentB);
    expect(forA.verification.map((t) => t.bookingId)).toEqual([booking.id]);
    expect(forB.verification).toHaveLength(0);

    // The transition is on the custody log with the ADMIN as actor.
    const events = await eventTypes(booking.id);
    const assigned = events.find((e) => e.eventType === "booking.agent_assigned");
    expect(assigned).toBeDefined();
    expect(assigned!.actorUserId).toBe(adminId);
    expect(assigned!.actorRole).toBe("admin");
    expect(assigned!.metadata).toMatchObject({ agentUserId: agentA });

    const assignment = await getBookingAssignment(db, booking.id);
    expect(assignment).toEqual({
      assigneeUserId: agentA,
      assigneeEmail: "dispatch.a@koolee-test.example",
      taskStatus: "assigned",
    });
  });

  it("reassign: tasks move to the new agent, a booking.agent_reassigned event is appended, no duplicates", async () => {
    const booking = await paidBooking();
    await assignAgentToBooking(config, adminSession, {
      bookingId: booking.id,
      agentUserId: agentA,
    });

    const result = await assignAgentToBooking(config, adminSession, {
      bookingId: booking.id,
      agentUserId: agentB,
    });
    expect(result).toEqual({ ok: true, reassigned: true });

    // Moved, not duplicated.
    const tasks = await db
      .select()
      .from(verificationTasks)
      .where(eq(verificationTasks.bookingId, booking.id));
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.assigneeUserId).toBe(agentB);
    expect((await listAssignedTasks(db, agentA)).verification).toHaveLength(0);
    expect((await listAssignedTasks(db, agentB)).verification).toHaveLength(1);

    // Status unchanged; the change of hands is an appended custody fact.
    const [row] = await db.select().from(bookings).where(eq(bookings.id, booking.id));
    expect(row!.status).toBe("agent_assigned");
    const events = await eventTypes(booking.id);
    const reassigned = events.find((e) => e.eventType === "booking.agent_reassigned");
    expect(reassigned).toBeDefined();
    expect(reassigned!.actorUserId).toBe(adminId);
    expect(reassigned!.metadata).toMatchObject({ agentUserId: agentB });
  });

  it("a completed visit can never be reassigned", async () => {
    const booking = await paidBooking();
    await assignAgentToBooking(config, adminSession, {
      bookingId: booking.id,
      agentUserId: agentA,
    });
    await db
      .update(verificationTasks)
      .set({ status: "done", completedAt: now })
      .where(eq(verificationTasks.bookingId, booking.id));

    const result = await assignAgentToBooking(config, adminSession, {
      bookingId: booking.id,
      agentUserId: agentB,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/completed/);
  });

  it("refuses inactive agents, non-agent staff, and non-paid first assignments — without leaving orphan tasks", async () => {
    const booking = await paidBooking();

    for (const badAssignee of [inactiveAgent, adminId, customerId]) {
      const result = await assignAgentToBooking(config, adminSession, {
        bookingId: booking.id,
        agentUserId: badAssignee,
      });
      expect(result.ok).toBe(false);
    }

    // First assignment is only legal from `paid`.
    await db
      .update(bookings)
      .set({ status: "in_transit" })
      .where(eq(bookings.id, booking.id));
    const result = await assignAgentToBooking(config, adminSession, {
      bookingId: booking.id,
      agentUserId: agentA,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/in_transit/);

    // None of the refused attempts created task rows.
    expect(
      await db
        .select()
        .from(verificationTasks)
        .where(eq(verificationTasks.bookingId, booking.id)),
    ).toHaveLength(0);
  });

  it("listActiveAgents returns only active agent-role staff", async () => {
    const agents = await listActiveAgents(db);
    expect(agents.map((a) => a.userId).sort()).toEqual([agentA, agentB].sort());
  });

  it("non-admin staff are blocked from the admin role check the actions run", async () => {
    await expect(requireStaffRole(db, agentA, ["admin"])).rejects.toThrow();
    await expect(requireStaffRole(db, adminId, ["admin"])).resolves.toBeDefined();
  });

  /* ------------------------------------------------------------------ */
  /* Exception resolution                                                */
  /* ------------------------------------------------------------------ */

  /** A booking sitting in `exception` (assigned, then a raised exception). */
  async function exceptionBooking() {
    const booking = await paidBooking();
    await assignAgentToBooking(config, adminSession, {
      bookingId: booking.id,
      agentUserId: agentA,
    });
    const moved = await applyTransition(config, {
      bookingId: booking.id,
      event: "raise_exception",
      actor: { userId: agentA, role: "agent" },
      metadata: { reason: "customer_not_home" },
    });
    expect(moved.ok).toBe(true);
    return booking;
  }

  it("resume_transit: exception → in_transit with a compensating event carrying the reason + admin actor", async () => {
    const booking = await exceptionBooking();

    const result = await resolveExceptionBooking(config, adminSession, {
      bookingId: booking.id,
      resolution: "resume_transit",
      reason: "customer reached, bags recovered",
    });
    expect(result).toEqual({ ok: true });

    const [row] = await db.select().from(bookings).where(eq(bookings.id, booking.id));
    expect(row!.status).toBe("in_transit");

    const events = await eventTypes(booking.id);
    const resolved = events.find(
      (e) => e.eventType === "booking.exception_resolved_resumed",
    );
    expect(resolved).toBeDefined();
    expect(resolved!.actorUserId).toBe(adminId);
    expect(resolved!.actorRole).toBe("admin");
    expect(resolved!.metadata).toMatchObject({
      source: "admin_exception_resolution",
      reason: "customer reached, bags recovered",
    });
    // The original exception event is still there — append-only, no edits.
    expect(events.some((e) => e.eventType === "booking.exception_raised")).toBe(true);
  });

  it("force_complete: exception → completed with the compensating event", async () => {
    const booking = await exceptionBooking();

    const result = await resolveExceptionBooking(config, adminSession, {
      bookingId: booking.id,
      resolution: "force_complete",
      reason: "bags confirmed delivered by airline",
    });
    expect(result).toEqual({ ok: true });

    const [row] = await db.select().from(bookings).where(eq(bookings.id, booking.id));
    expect(row!.status).toBe("completed");
    const events = await eventTypes(booking.id);
    expect(
      events.find((e) => e.eventType === "booking.exception_resolved_completed")
        ?.metadata,
    ).toMatchObject({ reason: "bags confirmed delivered by airline" });
  });

  it("cancel_and_refund: exception → cancelled, auth voided through the seam — windowed bookings hold no seat", async () => {
    const booking = await exceptionBooking();

    const result = await resolveExceptionBooking(config, adminSession, {
      bookingId: booking.id,
      resolution: "cancel_and_refund",
      reason: "customer requested cancellation after missed visit",
    });
    expect(result).toEqual({ ok: true });

    const [row] = await db.select().from(bookings).where(eq(bookings.id, booking.id));
    expect(row!.status).toBe("cancelled");

    // Payment was authorized (never captured) → the auth is voided.
    const [payment] = await db
      .select()
      .from(payments)
      .where(eq(payments.bookingId, booking.id));
    expect(payment!.status).toBe("cancelled");
    expect(provider.inspectAuth(payment!.providerRef)?.state).toBe("cancelled");

    // Windows are virtual: this suite creates no slot rows, and the admin
    // cancel touches none. (Legacy slot-backed release is pinned in the
    // payment-lifecycle suite.)
    expect(await db.select().from(slots)).toHaveLength(0);

    const events = await eventTypes(booking.id);
    expect(events.some((e) => e.eventType === "booking.cancelled")).toBe(true);
    expect(events.some((e) => e.eventType === "booking.payment_auth_cancelled")).toBe(
      true,
    );
  });

  it("a reason is required, and resolutions on non-exception bookings are rejected by the matrix", async () => {
    const booking = await exceptionBooking();
    const noReason = await resolveExceptionBooking(config, adminSession, {
      bookingId: booking.id,
      resolution: "resume_transit",
      reason: "   ",
    });
    expect(noReason.ok).toBe(false);
    if (!noReason.ok) expect(noReason.error).toMatch(/reason/i);

    const paid = await paidBooking();
    const wrongState = await resolveExceptionBooking(config, adminSession, {
      bookingId: paid.id,
      resolution: "resume_transit",
      reason: "should not apply",
    });
    expect(wrongState.ok).toBe(false);

    // Neither refusal touched the bookings.
    const [exceptionRow] = await db
      .select()
      .from(bookings)
      .where(eq(bookings.id, booking.id));
    expect(exceptionRow!.status).toBe("exception");
    const [paidRow] = await db.select().from(bookings).where(eq(bookings.id, paid.id));
    expect(paidRow!.status).toBe("paid");
  });

  /* ------------------------------------------------------------------ */
  /* Dashboard + board                                                   */
  /* ------------------------------------------------------------------ */

  it("dashboard counts and board rows come from real rows; unassigned paid bookings inside the horizon are at risk", async () => {
    const assigned = await paidBooking();
    await assignAgentToBooking(config, adminSession, {
      bookingId: assigned.id,
      agentUserId: agentA,
    });
    const unassigned = await paidBooking();
    const exception = await exceptionBooking();

    const dashboard = await getOpsDashboard(db, "America/New_York", now);
    const byStatus = Object.fromEntries(
      dashboard.todayByStatus.map((r) => [r.status, r.count]),
    );
    expect(byStatus["agent_assigned"]).toBe(1);
    expect(byStatus["paid"]).toBe(1);
    expect(byStatus["exception"]).toBe(1);
    expect(dashboard.unassignedToday).toBe(1);
    expect(dashboard.exceptionsOpen).toBe(1);

    const board = await listBookingsBoard(db, {}, now);
    expect(board).toHaveLength(3);
    const rowFor = (id: string) => board.find((r) => r.booking.id === id)!;
    // Paid + unassigned + window starts within the 12h horizon → at risk.
    expect(rowFor(unassigned.id).atRisk).toBe(true);
    expect(rowFor(unassigned.id).assigneeUserId).toBeNull();
    // Assigned and exception rows are not "at risk" (they're past paid).
    expect(rowFor(assigned.id).atRisk).toBe(false);
    expect(rowFor(assigned.id).assigneeEmail).toBe("dispatch.a@koolee-test.example");
    expect(rowFor(exception.id).atRisk).toBe(false);

    // Filters narrow by status.
    const exceptionsOnly = await listBookingsBoard(db, { statuses: ["exception"] }, now);
    expect(exceptionsOnly.map((r) => r.booking.id)).toEqual([exception.id]);

    // Multi-select is an OR within the dimension.
    const twoStatuses = await listBookingsBoard(
      db,
      { statuses: ["exception", "paid"] },
      now,
    );
    expect(new Set(twoStatuses.map((r) => r.booking.id))).toEqual(
      new Set([exception.id, unassigned.id]),
    );

    // An empty array clears the filter — it never means "match nothing".
    const cleared = await listBookingsBoard(db, { statuses: [], airports: [] }, now);
    expect(cleared).toHaveLength(3);
  });
});
