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
  lte,
  or,
  sql,
  type Column,
  type SQL,
} from "drizzle-orm";
import {
  airports,
  bags,
  bookings,
  custodyEvents,
  driverShifts,
  pickupTasks,
  staffMembers,
  trucks,
  users,
  verificationTasks,
  type Booking,
  type Database,
  type VerificationTask,
} from "@koolee/db";

import type { TransitionActor } from "../booking/state-machine";
import type { AdminSession } from "../auth/types";
import { DEFAULTS, type CoreConfig } from "../config";
import { emitAgentAssigned } from "../events/booking-events";
import { airportLocalDayBounds } from "../slots/cutoff";
import { withinAssignmentHorizon } from "./assignment-horizon";
import { applyTransition } from "./bookings";
import { OPEN_TASK_STATUSES } from "./tasks";
import { assignmentGate } from "./actionability";
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
  /**
   * Refuse if somebody else got there first, instead of reassigning.
   *
   * For the AUTOMATIC callers (`autoAssignBooking`, and through it the
   * on-paid hook and the horizon sweep), whose documented rule is that they
   * never reassign. That rule used to be enforced by a check in
   * `autoAssignBooking` that ran BEFORE the zone lookup and the load counts —
   * several round trips before the write — so a second sweep could pass the
   * check, watch the first one commit, and then take the UPDATE branch here
   * and move the booking to a different agent. The 0019 unique index does not
   * referee that, because nobody inserts.
   *
   * With this set the decision is re-made INSIDE the transaction, where it
   * can see a committed winner. Two writers that both read before either
   * commits still both INSERT, and there the unique index does referee.
   *
   * A dispatcher clicking Assign leaves it unset: reassignment is exactly
   * what they mean.
   */
  neverReassign?: boolean;
}

export type AssignAgentResult =
  | { ok: true; reassigned: boolean }
  /** `conflict`: a concurrent writer created the task first (0019 unique index). */
  | { ok: false; error: string; conflict?: boolean };

/** Postgres SQLSTATE from a raw or drizzle-wrapped error (walks `.cause`). */
function pgErrorCode(err: unknown): string | undefined {
  let cur: unknown = err;
  while (cur) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === "string") return code;
    cur = (cur as { cause?: unknown }).cause;
  }
  return undefined;
}

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

  /*
   * ONE GATE, and it used to be this one line plus a hole.
   *
   * The visit-complete check was here and correct; what was missing was the
   * BOOKING's own standing. A cancelled booking could be assigned an agent —
   * and worse, a cancelled booking that already HAD one skipped the status
   * check below entirely, because that branch only runs for a first
   * assignment. `assignmentGate` answers both, in the same module the rest of
   * the app asks "can this booking still be acted on".
   */
  const gate = assignmentGate(
    "verification",
    booking,
    Boolean(existing && (existing.status === "done" || existing.completedAt)),
  );
  if (!gate.allowed) return { ok: false, error: gate.reason! };

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

  /** Thrown inside the transaction; converted to a `conflict` result below. */
  class ConcurrentAssignment extends Error {}

  try {
    await db.transaction(async (tx) => {
      // Re-read under the transaction. `existing` above was read before the
      // zone lookup and the load counts, which is several round trips of
      // opportunity for a concurrent writer to finish.
      const current = await tx.query.verificationTasks.findFirst({
        where: eq(verificationTasks.bookingId, booking.id),
      });
      if (input.neverReassign && current?.assigneeUserId) {
        throw new ConcurrentAssignment();
      }

      if (current) {
        await tx
          .update(verificationTasks)
          .set({ assigneeUserId: input.agentUserId, status: "assigned" })
          .where(eq(verificationTasks.id, current.id));
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
  } catch (error) {
    // Lost the race to a writer that had already COMMITTED — seen by the
    // re-read inside the transaction.
    if (error instanceof ConcurrentAssignment) {
      return {
        ok: false,
        error: "Already assigned by a concurrent writer.",
        conflict: true,
      };
    }
    // Lost the race to a writer that had NOT yet committed: both passed the
    // existence check, both inserted, and the 0019 unique index refused the
    // second. The winner owns the assignment — report "already assigned",
    // never a failure of the payment path.
    if (pgErrorCode(error) === "23505") {
      return {
        ok: false,
        error: "Already assigned by a concurrent writer.",
        conflict: true,
      };
    }
    throw error;
  }

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

  /*
   * "Your agent is <name>" — emitted HERE rather than from `applyTransition`,
   * because this is the fact and the transition is not.
   *
   * Two paths reach this line and only one of them moves the booking: the
   * on-paid transition above, and a reassignment that changes nothing but who
   * is coming. A customer told once and then never again when a different
   * person is sent has been told something false, so the emit sits at the
   * write that decided WHO — the single write path shared by the manual
   * assign and `autoAssignBooking`.
   *
   * The dedupe key is (booking, agent), so ops re-picking the same agent is
   * not news and picking a different one is. Never throws.
   */
  await emitAgentAssigned(config.emitter, {
    bookingId: booking.id,
    agentUserId: input.agentUserId,
  });

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

  const event =
    input.resolution === "resume_transit" ? "resume_transit" : "force_complete";
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

/**
 * Everything the console needs to tell "nobody has done this yet" apart from
 * "the system has correctly not started this yet".
 *
 * `assignmentHorizonHours` is passed rather than defaulted for the same reason
 * `tz` is: a wrong value here is not a crash, it is a badge that quietly lies.
 * Callers read it from `config.defaults` so the console and the sweep cannot
 * disagree about where the line is.
 */
export interface BoardContext {
  /** Read as "now". Defaults to the real clock. */
  now?: Date;
  /** See `CoreDefaults.assignmentHorizonHours`. Defaults to `DEFAULTS`. */
  assignmentHorizonHours?: number;
}

export interface OpsDashboard {
  /** Bookings whose pickup window starts today, by status. */
  todayByStatus: Array<{ status: Booking["status"]; count: number }>;
  /**
   * Paid bookings with a window today, INSIDE the assignment horizon, and no
   * assigned verification task.
   *
   * The horizon clause is not redundant with "today": at the default 48 hours
   * every window today is inside it, but the horizon is configuration. Set
   * `ASSIGNMENT_HORIZON_HOURS=6` and tonight's 11 PM pickup is legitimately
   * unassigned at 9 AM — counting it here would page an operator about work
   * the sweep is going to do at 5 PM.
   */
  unassignedToday: number;
  /**
   * Sealed bookings with a window today whose bags nobody is coming for —
   * `verified_sealed` or `awaiting_pickup`, with no pickup task attached to a
   * driver shift.
   *
   * A SEPARATE count from `unassignedToday`, not folded into it. The two are
   * different failures with different fixes: one needs an agent sent to a
   * door, the other needs a van. Merging them would make one badge mean two
   * things and hide whichever is rarer.
   */
  awaitingDriverToday: number;
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
  ctx: BoardContext = {},
): Promise<OpsDashboard> {
  const now = ctx.now ?? new Date();
  const horizonHours = ctx.assignmentHorizonHours ?? DEFAULTS.assignmentHorizonHours;
  const horizonEnd = new Date(now.getTime() + horizonHours * 3_600_000);
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
        // Unassigned BY DESIGN beyond the horizon — not a problem to count.
        lte(bookings.pickupWindowStart, horizonEnd),
        isNull(verificationTasks.assigneeUserId),
      ),
    );

  const [awaitingDriver] = await db
    .select({ count: count() })
    .from(bookings)
    .leftJoin(pickupTasks, eq(pickupTasks.bookingId, bookings.id))
    .where(
      and(
        inArray(bookings.status, [...DRIVER_AWAITED_STATUSES]),
        gte(bookings.pickupWindowStart, dayStart),
        lt(bookings.pickupWindowStart, dayEnd),
        isNull(pickupTasks.driverShiftId),
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
    awaitingDriverToday: Number(awaitingDriver?.count ?? 0),
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
  /** Which shift holds this booking's pickup, once a driver is chosen. */
  driverShiftId: string | null;
  driverName: string | null;
  truckName: string | null;
  pickupTaskStatus: string | null;
  /**
   * Simple derived flag, not a scheduling engine. True for either reason
   * below; `atRiskReason` says which.
   */
  atRisk: boolean;
  /**
   * WHY it is at risk, because the two need different actions:
   *  - `no_agent`  — paid, nobody assigned to verify, window inside 12 hours.
   *  - `no_driver` — sealed and waiting, no driver chosen, departure inside 12
   *    hours. This one used to be invisible: every at-risk surface read
   *    `verification_tasks` only, so a booking with its bags sealed on a
   *    doorstep and nobody coming for them looked healthy on the board.
   */
  atRiskReason: AtRiskReason | null;
}

export type AtRiskReason = "no_agent" | "no_driver";

/** Statuses where the bags are sealed and a driver is what is missing. */
export const DRIVER_AWAITED_STATUSES = [
  "verified_sealed",
  "awaiting_pickup",
] as const satisfies readonly Booking["status"][];

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

/**
 * How close to DEPARTURE a sealed booking with no driver becomes at-risk.
 *
 * Measured against departure rather than the pickup window, because the
 * deadline that matters once the bags are sealed is the airline's, not the
 * customer's. It is a deliberately coarse proxy for the real bag-drop cutoff:
 * resolving the actual cutoff needs the `airline_cutoffs` table and the
 * strictest-scope rule, and `cutoffRiskMonitor` is where that lives. Putting a
 * cutoff resolution inside a 200-row board query would move real deadline
 * arithmetic into a render path for a flag whose whole job is "look at this".
 */
const NO_DRIVER_HORIZON_MS = 12 * 60 * 60 * 1000;

/** Minimum digits before a search term is tried against a phone column. */
const MIN_PHONE_DIGITS = 3;

/**
 * WHAT SOMEBODY IS HOLDING WHEN THEY NEED TO FIND A BOOKING.
 *
 * This was three things — ref, seal, phone — on the stated argument that
 * matching a name "turns a lookup into a fishing expedition over customer
 * PII". TD reversed that after using the board, and the reversal is the more
 * honest position: the person on the phone knows their own name and their
 * flight and almost never their booking ref, and an operator who cannot find
 * them by name just reads the board by eye instead — the same PII, more of it
 * on screen, and a worse call.
 *
 * ADDRESS AND ZIP STAY OUT, and that is a line rather than an omission.
 * "Who is booked on this street" is a question about a NEIGHBOURHOOD rather
 * than about a booking anybody is trying to reach: it answers no support call,
 * and it is the one search here that would be worth misusing.
 *
 * EVERY CLAUSE IS `ilike`. Somebody reading a ref off an email, a phone screen
 * or their own handwriting types it however they type it.
 */

/**
 * The three `users` roles a board row touches. All three are the same table,
 * so they must arrive as aliases from the query that joined them — building
 * them here would produce a second, unjoined alias that silently matches
 * nothing.
 *
 * Typed as bare `Column`s rather than as `typeof users`, because `alias()`
 * bakes the alias NAME into the table type: `board_customer` is not
 * assignable to `users`, and the two aliases are not assignable to each
 * other. Naming the columns we actually read is both what the compiler
 * accepts and the more honest signature.
 */
interface SearchScope {
  /** The customer who owns the booking. */
  customer: { fullName: Column; email: Column; phone: Column };
  /** The driver holding the pickup, once one is chosen. */
  driverUser: { fullName: Column };
  /** The agent assigned to verify — the board's plain `users` join. */
  agentUser: { fullName: Column; email: Column };
}

function searchClauses(db: Database, term: string, scope: SearchScope): SQL[] {
  const trimmed = term.trim();
  if (!trimmed) return [];

  const like = `%${trimmed}%`;
  const digits = trimmed.replace(/\D/g, "");
  const phoneLike = `%${digits}%`;

  const clauses: SQL[] = [
    /*
     * THE REF ITSELF — and this was missing, which is the bug TD reported as
     * "search is case-sensitive". It was not: every clause here has always
     * been `ilike`. The ref column simply was not one of them.
     *
     * `bookings.ref` is `KOO-XXXXX` over Crockford base32, stored uppercase.
     * The only clause resembling a ref lookup matched the last six hex of the
     * UUID, which is a completely different string — so `CEMBB` and `cembb`
     * both failed, and would have failed in any casing.
     *
     * Searching by ref here is exactly what a ref is FOR — display and
     * SUPPORT. The standing rule is that no PUBLIC route looks a booking up
     * by it, because 32^5 is hopeless as a secret; this is the admin console
     * behind a staff session, which is the supported case rather than the
     * forbidden one.
     */
    ilike(bookings.ref, like),
    // The uuid's last six hex, kept: an operator pasting a fragment of an id
    // out of a log or a Sentry issue is a real thing that happens.
    sql`right(${bookings.id}::text, 6) ilike ${like}`,
    exists(
      db
        .select({ one: sql`1` })
        .from(bags)
        .where(and(eq(bags.bookingId, bookings.id), ilike(bags.sealId, like))),
    ),
    /*
     * The name ON THE TICKET, which is not always the name on the account —
     * somebody books for a parent or a partner, and then it is the passenger
     * who rings up about the bags.
     */
    ilike(bookings.paxName, like),
    /*
     * Stored as "DL777", so `%term%` accepts the whole thing or just the
     * digits — nobody says "delta seven seven seven" when the board is on
     * fire. It is also the one field a caller reads off a boarding pass
     * verbatim, which makes it the most reliable hook of the lot.
     */
    ilike(bookings.flightNumber, like),
    ilike(scope.customer.fullName, like),
    ilike(scope.customer.email, like),

    /*
     * The operational half. "Which booking is Marcus on" and "what did truck
     * 3 have this morning" are dispatch questions asked out loud, and both
     * were previously answered by scrolling.
     */
    ilike(scope.driverUser.fullName, like),
    ilike(trucks.name, like),
    ilike(scope.agentUser.fullName, like),
    ilike(scope.agentUser.email, like),
  ];

  if (digits.length >= MIN_PHONE_DIGITS) {
    // Stored E.164 ("+13322602829") will not contain a term the operator
    // typed with dashes or spaces, so phones are matched on digits only.
    clauses.push(
      ilike(bookings.contactPhone, phoneLike),
      ilike(scope.customer.phone, phoneLike),
    );
  }

  return clauses;
}

function searchCondition(clauses: SQL[]): SQL | undefined {
  if (clauses.length === 0) return undefined;
  return or(...clauses);
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
      return [
        sql`${users.email} ${nulls}`,
        sql`${bookings.pickupWindowStart} asc nulls last`,
      ];
    case "window":
    default:
      return [sql`${bookings.pickupWindowStart} ${nulls}`, asc(bookings.id)];
  }
}

/** The dispatch board: bookings + slot + assignment, filterable. */
export async function listBookingsBoard(
  db: Database,
  filter: BoardFilter = {},
  ctx: BoardContext = {},
): Promise<BoardRow[]> {
  const now = ctx.now ?? new Date();
  const horizonHours = ctx.assignmentHorizonHours ?? DEFAULTS.assignmentHorizonHours;

  // The driver half of the row needs three more joins, all LEFT: a booking
  // with no pickup task, no shift or no truck must still appear on the board.
  const driverUser = alias(users, "board_driver");
  /*
   * The customer, joined rather than looked up in a subquery — search reads
   * three of their columns, which as correlated `exists` clauses would be
   * three subqueries per row for data sitting behind one foreign key. LEFT for
   * symmetry with the rest of the board; `bookings.user_id` is NOT NULL, so it
   * never actually widens.
   */
  const customerUser = alias(users, "board_customer");

  // Declared before the WHERE because the clauses read these aliases.
  const clauses = filter.search
    ? searchClauses(db, filter.search, {
        customer: customerUser,
        driverUser,
        agentUser: users,
      })
    : [];

  const conditions = [
    filter.statuses?.length ? inArray(bookings.status, filter.statuses) : undefined,
    filter.airports?.length
      ? inArray(bookings.departureAirport, filter.airports)
      : undefined,
    searchCondition(clauses),
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
      driverShiftId: pickupTasks.driverShiftId,
      pickupTaskStatus: pickupTasks.status,
      driverName: driverUser.fullName,
      truckName: trucks.name,
    })
    .from(bookings)
    .leftJoin(verificationTasks, eq(verificationTasks.bookingId, bookings.id))
    .leftJoin(users, eq(users.id, verificationTasks.assigneeUserId))
    .leftJoin(pickupTasks, eq(pickupTasks.bookingId, bookings.id))
    .leftJoin(driverShifts, eq(driverShifts.id, pickupTasks.driverShiftId))
    .leftJoin(driverUser, eq(driverUser.id, driverShifts.staffUserId))
    .leftJoin(trucks, eq(trucks.id, driverShifts.truckId))
    .leftJoin(customerUser, eq(customerUser.id, bookings.userId))
    .innerJoin(airports, eq(airports.code, bookings.departureAirport))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(...orderFor(filter.sort))
    .limit(filter.limit ?? 200);

  return rows.map((row) => {
    const noAgent =
      row.booking.status === "paid" &&
      !row.assigneeUserId &&
      row.slotStart !== null &&
      row.slotStart.getTime() - now.getTime() < AT_RISK_HORIZON_MS &&
      // Beyond the assignment horizon there is nothing wrong: the sweep has
      // not reached this booking yet and is not supposed to have. At the
      // default 48h this never bites (12h < 48h), which is precisely why it
      // has to be written down — a shortened horizon would otherwise turn
      // every correctly-deferred booking into a red badge.
      withinAssignmentHorizon(row.slotStart, now, horizonHours);

    const noDriver =
      (DRIVER_AWAITED_STATUSES as readonly string[]).includes(row.booking.status) &&
      row.driverShiftId === null &&
      row.booking.departureAt.getTime() - now.getTime() < NO_DRIVER_HORIZON_MS;

    // `no_driver` wins the label when both somehow apply: sealed bags nobody
    // is coming for is the later and worse failure.
    const atRiskReason: AtRiskReason | null = noDriver
      ? "no_driver"
      : noAgent
        ? "no_agent"
        : null;

    return {
      booking: row.booking,
      slotStart: row.slotStart,
      assigneeUserId: row.assigneeUserId,
      assigneeEmail: row.assigneeEmail,
      assigneeName: row.assigneeName,
      taskStatus: row.taskStatus,
      tz: row.tz,
      driverShiftId: row.driverShiftId,
      driverName: row.driverName,
      truckName: row.truckName,
      pickupTaskStatus: row.pickupTaskStatus,
      atRisk: atRiskReason !== null,
      atRiskReason,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Agent workload                                                       */
/* ------------------------------------------------------------------ */

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
