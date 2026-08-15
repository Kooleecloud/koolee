import { alias } from "drizzle-orm/pg-core";
import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  gte,
  ilike,
  inArray,
  isNull,
  lt,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import {
  airports,
  bags,
  bookings,
  custodyEvents,
  pickupTasks,
  staffMembers,
  users,
  verificationTasks,
  type Booking,
  type Database,
  type VerificationTask,
} from "@koolee/db";

import type { TransitionActor } from "../booking/state-machine";
import type { AdminSession } from "../auth/types";
import type { CoreConfig } from "../config";
import { airportLocalDayBounds } from "../slots/cutoff";
import { applyTransition } from "./bookings";
import { cancelBookingWithRefund } from "./payment-lifecycle";
import { getActiveStaffRole } from "./staff";

/**
 * Dispatch + oversight for the admin console.
 *
 * Hard rails:
 *  - manual actions NEVER edit history — every resolution is a state-machine
 *    transition plus an appended (compensating) custody event with a
 *    REQUIRED reason;
 *  - every function takes the admin session and stamps the real actor id;
 *  - numbers on the dashboard come from real queries, nothing hardcoded.
 */

export interface ActiveAgent {
  userId: string;
  email: string | null;
  fullName: string | null;
}

/** Active staff with the agent role — the assignable pool. */
export async function listActiveAgents(db: Database): Promise<ActiveAgent[]> {
  const rows = await db
    .select({ userId: staffMembers.userId, email: users.email, fullName: users.fullName })
    .from(staffMembers)
    .innerJoin(users, eq(users.id, staffMembers.userId))
    .where(and(eq(staffMembers.role, "agent"), eq(staffMembers.active, true)))
    .orderBy(users.email);
  return rows;
}

export interface AssignAgentInput {
  bookingId: string;
  agentUserId: string;
}

export type AssignAgentResult =
  | { ok: true; reassigned: boolean }
  | { ok: false; error: string };

/**
 * Assigns (or pre-completion reassigns) an agent to a booking's
 * verification AND pickup tasks — two entities, one assignee in v1.
 *
 * First assignment moves the booking `paid → agent_assigned` through the
 * matrix; a reassignment appends its own custody event. A completed
 * verification task can never be reassigned.
 *
 * `actor` is whoever is stamped on that custody event: an `AdminSession` when
 * a dispatcher clicks Assign, or `{ userId: null, role: null }` for the
 * automatic path (`autoAssignBooking`), which the custody schema already
 * models as a system-generated event. Being allowed to call this is decided
 * at the app edge — the admin app resolves an admin session before it can
 * reach here, and nothing customer-facing imports it.
 */
export async function assignAgentToBooking(
  config: CoreConfig,
  actor: AdminSession | TransitionActor,
  input: AssignAgentInput,
): Promise<AssignAgentResult> {
  const { db } = config;

  // The assignee must be ACTIVE staff with the agent role — the same check
  // the agent app runs per request.
  const role = await getActiveStaffRole(db, input.agentUserId);
  if (role !== "agent") {
    return { ok: false, error: "That user is not an active agent." };
  }

  const booking = await db.query.bookings.findFirst({
    where: eq(bookings.id, input.bookingId),
  });
  if (!booking) return { ok: false, error: "Booking not found." };

  const existing = await db.query.verificationTasks.findFirst({
    where: eq(verificationTasks.bookingId, booking.id),
  });
  if (existing && (existing.status === "done" || existing.completedAt)) {
    return { ok: false, error: "The visit is already completed — nothing to reassign." };
  }

  // The booking carries its pickup window directly (legacy slot rows were
  // backfilled into these columns by migration 0012).
  const scheduledStart = booking.pickupWindowStart ?? null;
  const scheduledEnd = booking.pickupWindowEnd ?? null;

  const reassigned = Boolean(existing?.assigneeUserId);

  // Validate BEFORE touching tasks — otherwise a refused assignment would
  // leave orphan task rows in the agent's list.
  if (booking.status !== "paid" && !reassigned && booking.status !== "agent_assigned") {
    return {
      ok: false,
      error: `Booking is ${booking.status} — assignment applies to paid bookings.`,
    };
  }

  await db.transaction(async (tx) => {
    if (existing) {
      await tx
        .update(verificationTasks)
        .set({ assigneeUserId: input.agentUserId, status: "assigned" })
        .where(eq(verificationTasks.id, existing.id));
    } else {
      await tx.insert(verificationTasks).values({
        bookingId: booking.id,
        assigneeUserId: input.agentUserId,
        status: "assigned",
        scheduledStart,
        scheduledEnd,
      });
    }

    const existingPickup = await tx.query.pickupTasks.findFirst({
      where: eq(pickupTasks.bookingId, booking.id),
    });
    if (existingPickup) {
      if (existingPickup.status !== "done") {
        await tx
          .update(pickupTasks)
          .set({ assigneeUserId: input.agentUserId, status: "assigned" })
          .where(eq(pickupTasks.id, existingPickup.id));
      }
    } else {
      await tx.insert(pickupTasks).values({
        bookingId: booking.id,
        assigneeUserId: input.agentUserId,
        status: "assigned",
        scheduledStart,
        scheduledEnd,
      });
    }
  });

  if (booking.status === "paid") {
    const moved = await applyTransition(config, {
      bookingId: booking.id,
      event: "assign_agent",
      actor: { userId: actor.userId, role: actor.role },
      metadata: { agentUserId: input.agentUserId },
    });
    if (!moved.ok) return { ok: false, error: moved.error.message };
  } else if (reassigned) {
    // No status change on reassignment — but the change of hands is a
    // custody-relevant fact, appended like every correction.
    await db.insert(custodyEvents).values({
      bookingId: booking.id,
      actorUserId: actor.userId,
      actorRole: actor.role,
      eventType: "booking.agent_reassigned",
      metadata: { agentUserId: input.agentUserId },
    });
  }

  return { ok: true, reassigned };
}

export interface BookingAssignment {
  assigneeUserId: string | null;
  assigneeEmail: string | null;
  taskStatus: VerificationTask["status"] | null;
}

/** Current verification-task assignment for a booking (admin views). */
export async function getBookingAssignment(
  db: Database,
  bookingId: string,
): Promise<BookingAssignment> {
  const [row] = await db
    .select({
      assigneeUserId: verificationTasks.assigneeUserId,
      assigneeEmail: users.email,
      taskStatus: verificationTasks.status,
    })
    .from(verificationTasks)
    .leftJoin(users, eq(users.id, verificationTasks.assigneeUserId))
    .where(eq(verificationTasks.bookingId, bookingId))
    .limit(1);
  return row ?? { assigneeUserId: null, assigneeEmail: null, taskStatus: null };
}

export const EXCEPTION_RESOLUTIONS = [
  "cancel_and_refund",
  "resume_transit",
  "force_complete",
] as const;
export type ExceptionResolution = (typeof EXCEPTION_RESOLUTIONS)[number];

export interface ResolveExceptionInput {
  bookingId: string;
  resolution: ExceptionResolution;
  /** REQUIRED — recorded in the compensating custody event. */
  reason: string;
}

export type ResolveExceptionResult = { ok: true } | { ok: false; error: string };

/**
 * Resolves a booking in the exception state via the transitions the matrix
 * defines from `exception` — and nothing else:
 *  - `cancel_and_refund` → the Phase 5 path (matrix cancel + full refund /
 *    auth void);
 *  - `resume_transit` → back to `in_transit`;
 *  - `force_complete` → closed out as completed.
 *
 * Every path appends a compensating custody event carrying the reason and
 * the admin's real actor id. History is never edited.
 */
export async function resolveExceptionBooking(
  config: CoreConfig,
  session: AdminSession,
  input: ResolveExceptionInput,
): Promise<ResolveExceptionResult> {
  const reason = input.reason.trim();
  if (!reason) return { ok: false, error: "A reason is required." };

  const actor = { userId: session.userId, role: session.role };

  if (input.resolution === "cancel_and_refund") {
    const result = await cancelBookingWithRefund(config, {
      bookingId: input.bookingId,
      actor,
      reason,
    });
    return result.ok ? { ok: true } : { ok: false, error: result.error };
  }

  const event = input.resolution === "resume_transit" ? "resume_transit" : "force_complete";
  const moved = await applyTransition(config, {
    bookingId: input.bookingId,
    event,
    actor,
    metadata: { source: "admin_exception_resolution", reason },
  });
  return moved.ok ? { ok: true } : { ok: false, error: moved.error.message };
}

/* ------------------------------------------------------------------ */
/* Ops dashboard + board                                                */
/* ------------------------------------------------------------------ */

export interface OpsDashboard {
  /** Bookings whose pickup window starts today, by status. */
  todayByStatus: Array<{ status: Booking["status"]; count: number }>;
  /** Paid bookings with a window today and no assigned verification task. */
  unassignedToday: number;
  /** All bookings currently in the exception state. */
  exceptionsOpen: number;
}

/**
 * Real queries only — nothing on the ops landing page is hardcoded.
 *
 * `tz` is the zone "today" is read in, and it is required for the same reason
 * `BoardFilter.day` requires one: the server runs in UTC in production, so a
 * server-local midnight would cut an Eastern day at 8 PM the evening before
 * and these counts would disagree with the board's own "today" badges.
 */
export async function getOpsDashboard(
  db: Database,
  tz: string,
  now: Date = new Date(),
): Promise<OpsDashboard> {
  const { start: dayStart, end: dayEnd } = airportLocalDayBounds(now, tz);

  const todayByStatus = await db
    .select({ status: bookings.status, count: count() })
    .from(bookings)
    .where(
      and(
        gte(bookings.pickupWindowStart, dayStart),
        lt(bookings.pickupWindowStart, dayEnd),
      ),
    )
    .groupBy(bookings.status);

  const [unassigned] = await db
    .select({ count: count() })
    .from(bookings)
    .leftJoin(verificationTasks, eq(verificationTasks.bookingId, bookings.id))
    .where(
      and(
        eq(bookings.status, "paid"),
        gte(bookings.pickupWindowStart, dayStart),
        lt(bookings.pickupWindowStart, dayEnd),
        isNull(verificationTasks.assigneeUserId),
      ),
    );

  const [exceptions] = await db
    .select({ count: count() })
    .from(bookings)
    .where(eq(bookings.status, "exception"));

  return {
    todayByStatus: todayByStatus.map((row) => ({
      status: row.status,
      count: Number(row.count),
    })),
    unassignedToday: Number(unassigned?.count ?? 0),
    exceptionsOpen: Number(exceptions?.count ?? 0),
  };
}

export interface BoardRow {
  booking: Booking;
  slotStart: Date | null;
  assigneeUserId: string | null;
  assigneeEmail: string | null;
  /**
   * The agent's display name. Null for staff who never set one — the board
   * falls back to the email, which is always present for staff.
   */
  assigneeName: string | null;
  taskStatus: VerificationTask["status"] | null;
  /**
   * The booking's display zone, carried per row because the board is the one
   * screen that shows bookings from every airport at once. A single console
   * zone would silently mislabel every row from a non-Eastern airport the day
   * one is added, and nothing about the code would look wrong.
   */
  tz: string;
  /**
   * Simple derived flag, not a scheduling engine: paid, unassigned, and the
   * pickup window starts within the next 12 hours (or already started).
   */
  atRisk: boolean;
}

export interface BoardFilter {
  /**
   * OR within the dimension, AND across dimensions — the board's status and
   * airport pickers are multi-select. An empty (or omitted) array means "no
   * constraint", never "match nothing": an operator who unticks every box is
   * clearing the filter, not asking for an empty board.
   */
  statuses?: Booking["status"][];
  airports?: ("JFK" | "LGA" | "EWR")[];
  /**
   * Restrict to pickup windows starting on the calendar day `on` falls in,
   * *as read at the airport*. The timezone is required rather than defaulted
   * because the server runs in UTC in production: a plain `setHours(0,0,0,0)`
   * would cut an Eastern day at 8 PM the evening before, and the board would
   * disagree with its own "today" badges.
   */
  day?: { on: Date; tz: string };
  /**
   * One box, three identifiers an operator actually has in front of them: the
   * six-character booking ref they read out on a call, a phone number, or a
   * seal serial off a bag. OR across the three, AND with every other
   * dimension. Blank or whitespace is no constraint.
   */
  search?: string;
  sort?: BoardSort;
  limit?: number;
}

export const BOARD_SORT_KEYS = [
  "window",
  "booked",
  "departure",
  "status",
  "agent",
] as const;
export type BoardSortKey = (typeof BOARD_SORT_KEYS)[number];
export interface BoardSort {
  key: BoardSortKey;
  direction: "asc" | "desc";
}

const AT_RISK_HORIZON_MS = 12 * 60 * 60 * 1000;

/** Minimum digits before a search term is tried against a phone column. */
const MIN_PHONE_DIGITS = 3;

/**
 * The three things an operator can be holding when they need a booking.
 *
 * Deliberately NOT a general text search: passenger name and address are
 * readable on the board already, and matching them here would turn a lookup
 * into a fishing expedition over customer PII.
 */
function searchCondition(db: Database, term: string): SQL | undefined {
  const trimmed = term.trim();
  if (!trimmed) return undefined;

  const like = `%${trimmed}%`;
  const digits = trimmed.replace(/\D/g, "");
  const phoneLike = `%${digits}%`;
  const customer = alias(users, "search_customer");

  const clauses: (SQL | undefined)[] = [
    // The short ref is a display convention over the uuid (last six hex),
    // so it is matched by suffix rather than looked up as an identifier.
    sql`right(${bookings.id}::text, 6) ilike ${like}`,
    exists(
      db
        .select({ one: sql`1` })
        .from(bags)
        .where(and(eq(bags.bookingId, bookings.id), ilike(bags.sealId, like))),
    ),
  ];

  if (digits.length >= MIN_PHONE_DIGITS) {
    // Stored E.164 ("+13322602829") will not contain a term the operator
    // typed with dashes or spaces, so phones are matched on digits only.
    clauses.push(
      ilike(bookings.contactPhone, phoneLike),
      exists(
        db
          .select({ one: sql`1` })
          .from(customer)
          .where(and(eq(customer.id, bookings.userId), ilike(customer.phone, phoneLike))),
      ),
    );
  }

  return or(...clauses.filter((c): c is SQL => c !== undefined));
}

/** Column ordering, plus a stable tiebreak so pagination cannot shuffle. */
function orderFor(sort: BoardSort | undefined): SQL[] {
  const direction = sort?.direction === "desc" ? desc : asc;
  const nulls = sort?.direction === "desc" ? sql`desc nulls last` : sql`asc nulls last`;

  switch (sort?.key) {
    case "booked":
      // When the booking came in. `created_at` is never null, so no nulls
      // clause — an ordinary column sort.
      return [direction(bookings.createdAt), asc(bookings.id)];
    case "departure":
      return [direction(bookings.departureAt), asc(bookings.id)];
    case "status":
      return [direction(bookings.status), sql`${bookings.pickupWindowStart} ${nulls}`];
    case "agent":
      // Unassigned rows sort last either way — they are the ones an operator
      // is looking for, and burying them under a page of assigned work is the
      // opposite of useful.
      return [sql`${users.email} ${nulls}`, sql`${bookings.pickupWindowStart} asc nulls last`];
    case "window":
    default:
      return [sql`${bookings.pickupWindowStart} ${nulls}`, asc(bookings.id)];
  }
}

/** The dispatch board: bookings + slot + assignment, filterable. */
export async function listBookingsBoard(
  db: Database,
  filter: BoardFilter = {},
  now: Date = new Date(),
): Promise<BoardRow[]> {
  const conditions = [
    filter.statuses?.length ? inArray(bookings.status, filter.statuses) : undefined,
    filter.airports?.length
      ? inArray(bookings.departureAirport, filter.airports)
      : undefined,
    filter.search ? searchCondition(db, filter.search) : undefined,
  ].filter((c): c is NonNullable<typeof c> => c !== undefined);

  if (filter.day) {
    const { start, end } = airportLocalDayBounds(filter.day.on, filter.day.tz);
    conditions.push(
      gte(bookings.pickupWindowStart, start),
      lt(bookings.pickupWindowStart, end),
    );
  }

  const rows = await db
    .select({
      booking: bookings,
      slotStart: bookings.pickupWindowStart,
      assigneeUserId: verificationTasks.assigneeUserId,
      assigneeEmail: users.email,
      assigneeName: users.fullName,
      taskStatus: verificationTasks.status,
      tz: airports.tz,
    })
    .from(bookings)
    .leftJoin(verificationTasks, eq(verificationTasks.bookingId, bookings.id))
    .leftJoin(users, eq(users.id, verificationTasks.assigneeUserId))
    .innerJoin(airports, eq(airports.code, bookings.departureAirport))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(...orderFor(filter.sort))
    .limit(filter.limit ?? 200);

  return rows.map((row) => ({
    booking: row.booking,
    slotStart: row.slotStart,
    assigneeUserId: row.assigneeUserId,
    assigneeEmail: row.assigneeEmail,
    assigneeName: row.assigneeName,
    taskStatus: row.taskStatus,
    tz: row.tz,
    atRisk:
      row.booking.status === "paid" &&
      !row.assigneeUserId &&
      row.slotStart !== null &&
      row.slotStart.getTime() - now.getTime() < AT_RISK_HORIZON_MS,
  }));
}

/* ------------------------------------------------------------------ */
/* Agent workload                                                       */
/* ------------------------------------------------------------------ */

/**
 * Task statuses that still represent work an agent has to do.
 *
 * `done` and `failed` are both finished — a failed visit has already been
 * handed to the exception flow, and counting it as load would keep an agent
 * artificially "busy" for the rest of the shift.
 */
const OPEN_TASK_STATUSES = ["pending", "assigned", "in_progress"] as const;

export interface AgentWorkload extends ActiveAgent {
  /** Open verification + pickup tasks scheduled for the requested day. */
  openTasks: number;
}

/**
 * How loaded each assignable agent is on a given day.
 *
 * Counts both task kinds because one agent covers both in v1 — a verification
 * visit and a pickup run are two separate demands on the same person's
 * morning. Agents with nothing on appear with `openTasks: 0` rather than
 * dropping out, since an empty agent is exactly who dispatch is looking for.
 *
 * The day is airport-local for the same reason the board's is: a UTC server
 * would cut an Eastern day at 8 PM the evening before.
 */
export async function listAgentWorkload(
  db: Database,
  day: { on: Date; tz: string },
): Promise<AgentWorkload[]> {
  const { start, end } = airportLocalDayBounds(day.on, day.tz);

  const scheduledInDay = (table: typeof verificationTasks | typeof pickupTasks) =>
    db
      .select({ userId: table.assigneeUserId, count: count() })
      .from(table)
      .where(
        and(
          inArray(table.status, [...OPEN_TASK_STATUSES]),
          gte(table.scheduledStart, start),
          lt(table.scheduledStart, end),
        ),
      )
      .groupBy(table.assigneeUserId);

  const [agents, verificationCounts, pickupCounts] = await Promise.all([
    listActiveAgents(db),
    scheduledInDay(verificationTasks),
    scheduledInDay(pickupTasks),
  ]);

  const load = new Map<string, number>();
  for (const row of [...verificationCounts, ...pickupCounts]) {
    if (!row.userId) continue;
    load.set(row.userId, (load.get(row.userId) ?? 0) + Number(row.count));
  }

  return agents.map((agent) => ({ ...agent, openTasks: load.get(agent.userId) ?? 0 }));
}
