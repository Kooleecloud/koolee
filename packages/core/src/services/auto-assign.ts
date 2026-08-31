import { and, asc, count, eq, gt, inArray, isNotNull, isNull, lt, lte } from "drizzle-orm";
import {
  agentZones,
  airports,
  bookings,
  pickupTasks,
  staffMembers,
  users,
  verificationTasks,
  type Database,
} from "@koolee/db";

import type { TransitionActor } from "../booking/state-machine";
import type { AdminSession } from "../auth/types";
import type { CoreConfig } from "../config";
import { isInCoverage, normalizeZip } from "../coverage/nyc-zips";
import {
  assignmentHorizonEnd,
  withinAssignmentHorizon,
} from "./assignment-horizon";
import { airportLocalDayBounds } from "../slots/cutoff";
import { assignAgentToBooking } from "./dispatch";
import { getActiveStaffRole } from "./staff";
import { OPEN_TASK_STATUSES } from "./tasks";

/**
 * Naive auto-assignment (v1).
 *
 * Deliberately not a scheduling engine. It answers one question — "who should
 * take this, if anyone obviously should?" — with two inputs: does the agent
 * cover the pickup ZIP, and how busy are they already. Everything it decides
 * is overridable in the console, and everything it declines to decide falls
 * through to a human rather than guessing.
 *
 * The rules it will NOT bend:
 *  - it never reassigns. An agent already on the booking is a decision
 *    someone (or some earlier run) made; silently moving work between people
 *    mid-shift is how bags get dropped;
 *  - it never invents coverage. No agent for the ZIP means unassigned, which
 *    the board already surfaces as at-risk;
 *  - it writes through `assignAgentToBooking`, so the two-tasks-one-assignee
 *    rule, the state-machine move, and the custody event stay in one place.
 */

export type AutoAssignSkipReason =
  /** Wrong status, or an agent is already on it. */
  | "not_assignable"
  /** Nobody covers the pickup ZIP. */
  | "no_coverage"
  /** A candidate was picked but the write refused it. */
  | "assignment_failed";

export type AutoAssignResult =
  | { ok: true; agentUserId: string; candidatesConsidered: number }
  | { ok: false; reason: AutoAssignSkipReason; detail: string };

export interface AutoAssignInput {
  bookingId: string;
  /**
   * Stamped on the custody event. Omit for the automatic path (fires on
   * `paid`) — a system-generated assignment records no human actor, which is
   * exactly what the custody schema models with a null actor.
   */
  actor?: AdminSession | TransitionActor;
}

const SYSTEM_ACTOR: TransitionActor = { userId: null, role: null };

/** Every airport Koolee serves is Eastern; the lookup is the real source. */
const FALLBACK_TZ = "America/New_York";

interface Candidate {
  agentUserId: string;
  /** Open tasks whose window OVERLAPS this booking's — a hard conflict. */
  overlapping: number;
  /** Open tasks anywhere in the day — the softer load signal. */
  sameDay: number;
}

/**
 * Open tasks per agent, split into "clashes with this window" and "is on the
 * same day at all", for the candidates given.
 *
 * Both task kinds count: one agent covers the verification visit and the
 * pickup run in v1, so they are two claims on the same person's time.
 */
async function loadFor(
  db: Database,
  agentUserIds: string[],
  window: { start: Date; end: Date },
  day: { start: Date; end: Date },
): Promise<Map<string, { overlapping: number; sameDay: number }>> {
  const tally = new Map<string, { overlapping: number; sameDay: number }>();
  if (agentUserIds.length === 0) return tally;

  const countBy = (
    table: typeof verificationTasks | typeof pickupTasks,
    from: Date,
    to: Date,
    // Half-open overlap: a task ending exactly when this one starts is not a
    // clash, and neither is one starting exactly when this one ends.
    overlap: boolean,
  ) =>
    db
      .select({ userId: table.assigneeUserId, count: count() })
      .from(table)
      .where(
        and(
          inArray(table.assigneeUserId, agentUserIds),
          inArray(table.status, [...OPEN_TASK_STATUSES]),
          overlap
            ? and(lt(table.scheduledStart, to), gt(table.scheduledEnd, from))
            : and(lt(table.scheduledStart, to), gt(table.scheduledStart, from)),
        ),
      )
      .groupBy(table.assigneeUserId);

  const [vOverlap, pOverlap, vDay, pDay] = await Promise.all([
    countBy(verificationTasks, window.start, window.end, true),
    countBy(pickupTasks, window.start, window.end, true),
    countBy(verificationTasks, day.start, day.end, false),
    countBy(pickupTasks, day.start, day.end, false),
  ]);

  const bump = (
    rows: { userId: string | null; count: number }[],
    key: "overlapping" | "sameDay",
  ) => {
    for (const row of rows) {
      if (!row.userId) continue;
      const entry = tally.get(row.userId) ?? { overlapping: 0, sameDay: 0 };
      entry[key] += Number(row.count);
      tally.set(row.userId, entry);
    }
  };

  bump(vOverlap, "overlapping");
  bump(pOverlap, "overlapping");
  bump(vDay, "sameDay");
  bump(pDay, "sameDay");

  return tally;
}

/**
 * Picks an agent for a paid booking and assigns them, or explains why it
 * didn't. Safe to call more than once for the same booking: the second call
 * returns `not_assignable` rather than moving anyone.
 */
export async function autoAssignBooking(
  config: CoreConfig,
  input: AutoAssignInput,
): Promise<AutoAssignResult> {
  const { db } = config;

  const booking = await db.query.bookings.findFirst({
    where: eq(bookings.id, input.bookingId),
  });
  if (!booking) {
    return { ok: false, reason: "not_assignable", detail: "Booking not found." };
  }
  if (booking.status !== "paid") {
    return {
      ok: false,
      reason: "not_assignable",
      detail: `Booking is ${booking.status} — auto-assign only acts on paid bookings.`,
    };
  }

  // Cheap early exit for the common case. NOT the guard — the real one is
  // `neverReassign` inside `assignAgentToBooking`'s transaction, because
  // everything between here and the write is time a concurrent writer can
  // use.
  const existing = await db.query.verificationTasks.findFirst({
    where: eq(verificationTasks.bookingId, booking.id),
  });
  if (existing?.assigneeUserId) {
    return {
      ok: false,
      reason: "not_assignable",
      detail: "Already assigned — auto-assign never reassigns.",
    };
  }

  // The booking's own ZIP (0033) — no join, and no "address not found" branch:
  // a booking cannot exist without a snapshotted doorstep.
  const pickup = { zip: booking.pickupZip };

  // AGENTS STAY SHIFT-BLIND, BY DESIGN — this is the decision, not an
  // oversight.
  //
  // `driver_shifts` (migration 0029) is the first temporal-availability
  // entity in the schema, and the obvious next thought is "so auto-assign
  // should check whether the agent is working". It deliberately does not.
  // Two reasons, both from the preflight (§7.5):
  //
  //  1. A verification visit is scheduled against a pickup WINDOW the
  //     customer bought hours or days ahead. A shift is a live "I am out
  //     right now" fact. Filtering tomorrow's 9 AM visit by who happens to
  //     be clocked in tonight would assign nobody to anything.
  //  2. Shifts exist for DRIVERS, because a driver has a truck with finite
  //     capacity and a customer picks them in real time. An agent has
  //     neither. Giving agents shifts too would mean every agent has to
  //     clock in before dispatch can see them, which is a rostering product
  //     Koolee has not built and does not need at NYC scale.
  //
  // The asymmetry — a shift-aware driver selector next to a shift-blind
  // agent selector — is therefore intentional. If agent rostering ever
  // ships, this comment is the thing to come back and delete.
  //
  // Covering agents must ALSO be active staff with the agent role — a zone row
  // for someone who has left is stale data, not a licence to assign them.
  const covering = await db
    .select({ agentUserId: agentZones.agentUserId })
    .from(agentZones)
    .innerJoin(staffMembers, eq(staffMembers.userId, agentZones.agentUserId))
    .where(
      and(
        eq(agentZones.zip, pickup.zip),
        eq(staffMembers.role, "agent"),
        eq(staffMembers.active, true),
      ),
    )
    .orderBy(asc(agentZones.agentUserId));

  const agentUserIds = [...new Set(covering.map((row) => row.agentUserId))];
  if (agentUserIds.length === 0) {
    return {
      ok: false,
      reason: "no_coverage",
      detail: `No active agent covers ZIP ${pickup.zip}.`,
    };
  }

  // A booking with no window (legacy slot rows) has no "that time window" to
  // balance against, so load is measured over the day the pickup falls on —
  // and that day is the airport's, never the server's.
  const windowStart = booking.pickupWindowStart ?? booking.departureAt;
  const windowEnd = booking.pickupWindowEnd ?? windowStart;
  const airport = await db.query.airports.findFirst({
    where: eq(airports.code, booking.departureAirport),
    columns: { tz: true },
  });
  const day = airportLocalDayBounds(windowStart, airport?.tz ?? FALLBACK_TZ);

  const load = await loadFor(
    db,
    agentUserIds,
    { start: windowStart, end: windowEnd },
    day,
  );

  const candidates: Candidate[] = agentUserIds.map((agentUserId) => ({
    agentUserId,
    overlapping: load.get(agentUserId)?.overlapping ?? 0,
    sameDay: load.get(agentUserId)?.sameDay ?? 0,
  }));

  // Fewest clashes first, then lightest day, then a stable id tiebreak so the
  // same inputs always name the same agent — a retry must not shuffle people.
  candidates.sort(
    (a, b) =>
      a.overlapping - b.overlapping ||
      a.sameDay - b.sameDay ||
      a.agentUserId.localeCompare(b.agentUserId),
  );

  const winner = candidates[0]!;
  const assigned = await assignAgentToBooking(config, input.actor ?? SYSTEM_ACTOR, {
    bookingId: booking.id,
    agentUserId: winner.agentUserId,
    // "It never reassigns" is this function's rule (see the header). The
    // check at the top of this function cannot enforce it on its own: the
    // zone lookup and the load counts happen in between, and a concurrent
    // sweep can commit inside that gap. Enforced in the transaction instead.
    neverReassign: true,
  });

  if (!assigned.ok) {
    if (assigned.conflict) {
      // Lost the on-paid race — a concurrent writer (the other payment path)
      // assigned it first. Same outcome as "already assigned", not an error.
      return {
        ok: false,
        reason: "not_assignable",
        detail: "Already assigned by a concurrent writer.",
      };
    }
    return { ok: false, reason: "assignment_failed", detail: assigned.error };
  }

  return {
    ok: true,
    agentUserId: winner.agentUserId,
    candidatesConsidered: candidates.length,
  };
}

/**
 * The on-paid hook. Every path that moves a booking to `paid` — the Stripe
 * webhook, the /book/return re-check, and createBooking's inline (fake
 * provider) authorization — calls this afterwards. The first two race BY
 * DESIGN; the 0019 unique indexes referee, and the loser lands on
 * `not_assignable`.
 *
 * DEFERRED BEYOND THE HORIZON. A booking whose window is more than
 * `defaults.assignmentHorizonHours` away creates NOTHING here — no
 * verification task, no pickup task, no custody event — and rests in `paid`
 * until `assignEnteringHorizon` picks it up. Assigning in March for a June
 * flight names a person against a roster that will have changed and puts a
 * task nobody can act on into an agent's list for three months.
 *
 * Near-term bookings are unaffected: anything inside the horizon (which is
 * every same-day and next-day booking at the default 48h) takes exactly the
 * path it took before.
 *
 * NEVER throws, and a skip is not an error: a booking nobody covers stays
 * paid-unassigned, which the board surfaces as at-risk once it is inside the
 * horizon. The one outcome worth shouting about is a refused WRITE
 * (`assignment_failed`) — that means a candidate was picked and the
 * assignment itself broke.
 */
export async function autoAssignOnPaid(
  config: CoreConfig,
  bookingId: string,
): Promise<void> {
  try {
    const booking = await config.db.query.bookings.findFirst({
      where: eq(bookings.id, bookingId),
      columns: { pickupWindowStart: true },
    });
    if (
      booking &&
      !withinAssignmentHorizon(
        booking.pickupWindowStart,
        config.clock.now(),
        config.defaults.assignmentHorizonHours,
      )
    ) {
      return;
    }

    const result = await autoAssignBooking(config, { bookingId });
    if (!result.ok && result.reason === "assignment_failed") {
      console.error(
        `[auto-assign] on-paid assignment failed for ${bookingId}: ${result.detail}`,
      );
    }
  } catch (error) {
    console.error(`[auto-assign] on-paid hook crashed for ${bookingId}`, error);
  }
}

export interface HorizonSweepResult {
  /** Paid bookings that had entered the horizon with no verification task. */
  considered: number;
  assigned: string[];
  /** Entered the horizon but nobody covers the ZIP — the board's problem now. */
  uncovered: string[];
  /** Lost the race to a concurrent sweep or a dispatcher. Not an error. */
  raced: string[];
}

/**
 * How many bookings one sweep will look at. Generous against the real load
 * (a horizon-entry cohort is hours of bookings, not days) and a bound on the
 * blast radius of a sweep that finds a backlog after an outage.
 */
const SWEEP_BATCH = 200;

/**
 * The other half of deferred assignment: assigns bookings whose window has
 * just entered the horizon.
 *
 * Run every 5 minutes, so a booking is assigned within 5 minutes of crossing
 * the line. Two properties make that safe to run concurrently with itself and
 * with a dispatcher clicking Assign:
 *
 *  - it selects only bookings with NO verification-task row, so an
 *    already-assigned booking (including one an admin assigned early) is
 *    invisible to it by construction — no "never reassign" rule to remember;
 *  - `assignAgentToBooking` inserts through the 0019 unique index on
 *    `verification_tasks(booking_id)`, so two sweeps that both selected the
 *    same booking collapse to one assignment, with the loser reported as
 *    `conflict` (23505) rather than an error. Same discipline as the
 *    two-concurrent-paid test.
 *
 * Stamps the SYSTEM actor on the custody event, exactly as the on-paid path
 * does — nobody clicked anything, and the schema models that with a null
 * actor.
 */
export async function assignEnteringHorizon(
  config: CoreConfig,
): Promise<HorizonSweepResult> {
  const { db } = config;
  const now = config.clock.now();
  const cutoff = assignmentHorizonEnd(now, config.defaults.assignmentHorizonHours);

  const due = await db
    .select({ id: bookings.id })
    .from(bookings)
    .leftJoin(verificationTasks, eq(verificationTasks.bookingId, bookings.id))
    .where(
      and(
        eq(bookings.status, "paid"),
        isNull(verificationTasks.id),
        // Inside the horizon. A null window would never have been deferred
        // (see `withinAssignmentHorizon`), so it cannot be waiting here.
        isNotNull(bookings.pickupWindowStart),
        lte(bookings.pickupWindowStart, cutoff),
      ),
    )
    .orderBy(asc(bookings.pickupWindowStart))
    .limit(SWEEP_BATCH);

  const result: HorizonSweepResult = {
    considered: due.length,
    assigned: [],
    uncovered: [],
    raced: [],
  };

  // Sequential on purpose. The candidate ranking counts each agent's OPEN
  // TASKS, so two bookings assigned in parallel both read the load from
  // before either was written and pile onto the same person.
  for (const row of due) {
    try {
      const outcome = await autoAssignBooking(config, { bookingId: row.id });
      if (outcome.ok) result.assigned.push(row.id);
      else if (outcome.reason === "no_coverage") result.uncovered.push(row.id);
      else result.raced.push(row.id);
    } catch (error) {
      console.error(`[auto-assign] horizon sweep failed for ${row.id}`, error);
      result.raced.push(row.id);
    }
  }

  return result;
}

/* ------------------------------------------------------------------ */
/* Zone administration                                                  */
/* ------------------------------------------------------------------ */

export interface AgentZoneCoverage {
  agentUserId: string;
  email: string | null;
  fullName: string | null;
  zips: string[];
}

/** Who covers what, for the admin zones screen. */
export async function listAgentZones(db: Database): Promise<AgentZoneCoverage[]> {
  const rows = await db
    .select({
      agentUserId: agentZones.agentUserId,
      zip: agentZones.zip,
      email: users.email,
      fullName: users.fullName,
    })
    .from(agentZones)
    .innerJoin(users, eq(users.id, agentZones.agentUserId))
    .orderBy(asc(users.email), asc(agentZones.zip));

  const byAgent = new Map<string, AgentZoneCoverage>();
  for (const row of rows) {
    const entry = byAgent.get(row.agentUserId) ?? {
      agentUserId: row.agentUserId,
      email: row.email,
      fullName: row.fullName,
      zips: [],
    };
    entry.zips.push(row.zip);
    byAgent.set(row.agentUserId, entry);
  }
  return [...byAgent.values()];
}

export type ZoneMutationResult =
  | { ok: true; zips: string[] }
  | { ok: false; error: string };

/**
 * Gives an agent one or more ZIPs.
 *
 * Every ZIP is checked against the service boundary first: a zone outside
 * coverage could never receive a booking, so accepting it would only create a
 * row that looks like capacity and is not. Re-adding a ZIP the agent already
 * has is a no-op, not an error — the unique index makes that safe to repeat.
 */
export async function addAgentZones(
  config: CoreConfig,
  input: { agentUserId: string; zips: string[] },
): Promise<ZoneMutationResult> {
  const { db } = config;

  const normalized: string[] = [];
  for (const raw of input.zips) {
    const zip = normalizeZip(raw);
    if (!zip) return { ok: false, error: `"${raw}" is not a valid ZIP.` };
    if (!isInCoverage(zip)) {
      return { ok: false, error: `ZIP ${zip} is outside Koolee's service area.` };
    }
    normalized.push(zip);
  }
  if (normalized.length === 0) return { ok: false, error: "No ZIPs given." };

  const role = await getActiveStaffRole(db, input.agentUserId);
  if (role !== "agent") {
    return { ok: false, error: "That user is not an active agent." };
  }

  await db
    .insert(agentZones)
    .values(normalized.map((zip) => ({ agentUserId: input.agentUserId, zip })))
    .onConflictDoNothing();

  return { ok: true, zips: [...new Set(normalized)] };
}

/** Takes a ZIP off an agent. Auto-assign stops considering them for it. */
export async function removeAgentZone(
  config: CoreConfig,
  input: { agentUserId: string; zip: string },
): Promise<boolean> {
  const zip = normalizeZip(input.zip);
  if (!zip) return false;

  const deleted = await config.db
    .delete(agentZones)
    .where(
      and(eq(agentZones.agentUserId, input.agentUserId), eq(agentZones.zip, zip)),
    )
    .returning({ id: agentZones.id });

  return deleted.length > 0;
}
