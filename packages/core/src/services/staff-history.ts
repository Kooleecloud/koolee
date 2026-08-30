import { and, desc, eq, sql } from "drizzle-orm";
import {
  bookings,
  pickupTasks,
  verificationTasks,
  type Database,
  type TaskStatus,
} from "@koolee/db";

/**
 * What one member of staff has actually done.
 *
 * DERIVED, NEVER BOOKKEPT. Everything below comes from `verification_tasks`,
 * `pickup_tasks` and the bookings they point at. No counter column, no
 * `staff_stats` table, nothing on a write path that has to be kept in step
 * with the thing it is counting — which is how a count becomes confidently
 * wrong and stays that way.
 *
 * The consequence is honest and worth stating rather than hiding: **anything
 * that is not a task row cannot be counted here.** Notifications sent, minutes
 * driven, distance covered — none of those exist in this database, and the
 * console says so where a reader would otherwise assume a zero means zero.
 *
 * ONE ROW PER TASK, not per booking. A person who verified a booking and then
 * drove it did two pieces of work at two different times with two different
 * SLAs, and collapsing them would make "how many pickups did Nina run" a
 * question this view could not answer.
 */

export type StaffTaskKind = "verification" | "pickup";

export interface StaffTaskRow {
  taskId: string;
  kind: StaffTaskKind;
  status: TaskStatus;
  bookingId: string;
  bookingRef: string;
  paxName: string;
  departureAirport: string;
  /** Airport zone for rendering. Every time on this page uses it. */
  tz: string;
  scheduledStart: Date | null;
  completedAt: Date | null;
  /** How this row is ordered and filtered: completion if it finished, else schedule. */
  at: Date | null;
}

export interface StaffWorkCounts {
  /** Finished verification visits in range. */
  verificationsDone: number;
  /** Finished pickup runs in range. */
  pickupsDone: number;
  /** Assigned-but-unfinished work, either kind. Not a failure — just open. */
  open: number;
  /** Tasks that ended in `failed`. The number worth a second look. */
  failed: number;
}

export interface StaffWorkHistory {
  counts: StaffWorkCounts;
  rows: StaffTaskRow[];
}

export interface StaffWorkHistoryQuery {
  staffUserId: string;
  /** Inclusive lower bound on the row's own instant. */
  from?: Date | undefined;
  /** Inclusive upper bound. */
  to?: Date | undefined;
  limit?: number;
}

/**
 * The range filter reads the instant a row ACTUALLY HAPPENED at, which is
 * `completed_at` when it finished and the scheduled start when it has not.
 *
 * Filtering on `created_at` would answer "what was assigned to Nina in June",
 * which is a dispatch question. This view answers "what did Nina do in June",
 * and a task assigned in May and run in June belongs in June.
 */
export async function getStaffWorkHistory(
  db: Database,
  query: StaffWorkHistoryQuery,
): Promise<StaffWorkHistory> {
  const limit = query.limit ?? 200;

  const rangeFor = (completedAt: unknown, scheduledStart: unknown) => {
    const at = sql`coalesce(${completedAt}, ${scheduledStart})`;
    /*
     * ISO strings with an explicit `::timestamptz`, not `Date` objects.
     *
     * A `Date` bound into a raw `sql` template reaches postgres-js as a
     * positional parameter with no type mapping and is rejected outright
     * ("The string argument must be of type string"). Drizzle's own operators
     * do the mapping; a hand-written fragment has to say what it means.
     */
    const clauses = [
      query.from === undefined
        ? undefined
        : sql`${at} >= ${query.from.toISOString()}::timestamptz`,
      query.to === undefined
        ? undefined
        : sql`${at} <= ${query.to.toISOString()}::timestamptz`,
    ].filter(Boolean);
    return clauses.length === 0 ? undefined : sql.join(clauses, sql` and `);
  };

  const [verificationRows, pickupRows] = await Promise.all([
    db
      .select({
        taskId: verificationTasks.id,
        status: verificationTasks.status,
        bookingId: bookings.id,
        bookingRef: bookings.ref,
        paxName: bookings.paxName,
        departureAirport: bookings.departureAirport,
        tz: bookings.displayTz,
        scheduledStart: verificationTasks.scheduledStart,
        completedAt: verificationTasks.completedAt,
      })
      .from(verificationTasks)
      .innerJoin(bookings, eq(bookings.id, verificationTasks.bookingId))
      .where(
        and(
          eq(verificationTasks.assigneeUserId, query.staffUserId),
          rangeFor(verificationTasks.completedAt, verificationTasks.scheduledStart),
        ),
      )
      .orderBy(desc(sql`coalesce(${verificationTasks.completedAt}, ${verificationTasks.scheduledStart})`))
      .limit(limit),
    db
      .select({
        taskId: pickupTasks.id,
        status: pickupTasks.status,
        bookingId: bookings.id,
        bookingRef: bookings.ref,
        paxName: bookings.paxName,
        departureAirport: bookings.departureAirport,
        tz: bookings.displayTz,
        scheduledStart: pickupTasks.scheduledStart,
        completedAt: pickupTasks.completedAt,
      })
      .from(pickupTasks)
      .innerJoin(bookings, eq(bookings.id, pickupTasks.bookingId))
      .where(
        and(
          eq(pickupTasks.assigneeUserId, query.staffUserId),
          rangeFor(pickupTasks.completedAt, pickupTasks.scheduledStart),
        ),
      )
      .orderBy(desc(sql`coalesce(${pickupTasks.completedAt}, ${pickupTasks.scheduledStart})`))
      .limit(limit),
  ]);

  const toRow = (kind: StaffTaskKind) =>
    (row: (typeof verificationRows)[number] | (typeof pickupRows)[number]): StaffTaskRow => ({
      taskId: row.taskId,
      kind,
      status: row.status,
      bookingId: row.bookingId,
      bookingRef: row.bookingRef,
      paxName: row.paxName,
      departureAirport: row.departureAirport,
      // Legacy rows can hold an empty `display_tz`; every airport Koolee
      // serves is Eastern, and a wrong-but-plausible time beats a throw.
      tz: row.tz || "America/New_York",
      scheduledStart: row.scheduledStart,
      completedAt: row.completedAt,
      at: row.completedAt ?? row.scheduledStart,
    });

  const rows = [
    ...verificationRows.map(toRow("verification")),
    ...pickupRows.map(toRow("pickup")),
  ].sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0));

  const counts: StaffWorkCounts = {
    verificationsDone: rows.filter((r) => r.kind === "verification" && r.status === "done")
      .length,
    pickupsDone: rows.filter((r) => r.kind === "pickup" && r.status === "done").length,
    open: rows.filter((r) => r.status !== "done" && r.status !== "failed").length,
    failed: rows.filter((r) => r.status === "failed").length,
  };

  return { counts, rows: rows.slice(0, limit) };
}

/** Kept beside the query so the two ranges cannot drift apart. */
export function staffHistoryRange(
  from: string | undefined,
  to: string | undefined,
): { from?: Date; to?: Date } {
  const parse = (value: string | undefined, endOfDay: boolean): Date | undefined => {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
    // UTC bounds on a date the operator typed. A staff record belongs to no
    // booking, so there is no airport zone to interpret it in — and a range
    // filter that silently shifted by five hours would be worse than one that
    // is plainly UTC.
    const instant = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
    return Number.isNaN(instant.getTime()) ? undefined : instant;
  };
  const start = parse(from, false);
  const end = parse(to, true);
  return {
    ...(start === undefined ? {} : { from: start }),
    ...(end === undefined ? {} : { to: end }),
  };
}
