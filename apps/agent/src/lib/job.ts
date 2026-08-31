import type { AssignedTasks, TaskBookingContext } from "@koolee/core";

/**
 * A "job" — one booking, and everything this agent has to do for it.
 *
 * The database has two task tables and the agent app used to render them as
 * two independent rows. On a phone that read as duplicate work: the same
 * customer, the same window, the same address, listed twice, three lines
 * apart. A driver does not experience "a verification task and a pickup
 * task", they experience one trip to one door with two things to do there.
 *
 * So the grouping happens here, in presentation, and the two task rows stay
 * exactly as they are underneath — which is what keeps this reversible if the
 * two halves are ever assigned to different people.
 */

export type JobPhaseKind = "verification" | "pickup";

export interface JobPhase {
  kind: JobPhaseKind;
  taskId: string;
  status: string;
  scheduledStart: Date | null;
  scheduledEnd: Date | null;
  /**
   * Pickup phases only: the customer has not chosen a driver yet.
   *
   * The on-paid auto-assign hands the pickup task to the SAME person as the
   * verification visit, so it appears in their queue before anyone has picked
   * a driver — which is correct (one person does both in v1, and somebody has
   * to be responsible if nobody is chosen) but it must not read as settled.
   * The card says "waiting on the customer" until a shift owns it.
   */
  awaitingDriverChoice?: boolean;
}

/** What each phase asks of the driver, in the driver's words. */
export const PHASE_LABEL: Record<JobPhaseKind, string> = {
  verification: "Verify & seal",
  pickup: "Collect & deliver",
};

export const PHASE_WHERE: Record<JobPhaseKind, string> = {
  verification: "at the door",
  pickup: "to the bag drop",
};

export type JobState = "problem" | "active" | "upcoming" | "done" | "cancelled";

export interface Job {
  bookingId: string;
  booking: TaskBookingContext;
  /** The booking's airport zone. Every time this app renders uses it. */
  tz: string;
  /** Verification first, then pickup — the order they actually happen in. */
  phases: JobPhase[];
  /** Earliest scheduled start across the phases; how the day is ordered. */
  startsAt: Date | null;
  /** The phase to open. Null once nothing is left to do. */
  next: JobPhase | null;
  state: JobState;
}

const PHASE_ORDER: JobPhaseKind[] = ["verification", "pickup"];

/** Statuses that mean "this phase is finished, stop showing it as work". */
const SETTLED = new Set(["done", "failed", "cancelled"]);

export function groupJobs(tasks: AssignedTasks): Job[] {
  const byBooking = new Map<string, Job>();

  const add = (kind: JobPhaseKind, rows: AssignedTasks["verification" | "pickup"]) => {
    for (const { task, tz, booking } of rows) {
      const existing = byBooking.get(booking.id);
      const phase: JobPhase = {
        kind,
        taskId: task.id,
        status: task.status,
        scheduledStart: task.scheduledStart,
        scheduledEnd: task.scheduledEnd,
        ...(kind === "pickup" && "driverShiftId" in task && task.driverShiftId === null
          ? { awaitingDriverChoice: true }
          : {}),
      };
      if (existing) {
        existing.phases.push(phase);
      } else {
        byBooking.set(booking.id, {
          bookingId: booking.id,
          booking,
          tz,
          phases: [phase],
          startsAt: null,
          next: null,
          state: "upcoming",
        });
      }
    }
  };

  add("verification", tasks.verification);
  add("pickup", tasks.pickup);

  const jobs = [...byBooking.values()];
  for (const job of jobs) {
    job.phases.sort((a, b) => PHASE_ORDER.indexOf(a.kind) - PHASE_ORDER.indexOf(b.kind));

    const starts = job.phases
      .map((p) => p.scheduledStart)
      .filter((d): d is Date => d !== null)
      .map((d) => d.getTime());
    job.startsAt = starts.length > 0 ? new Date(Math.min(...starts)) : null;

    // The next thing to do is the first phase that is not settled — which is
    // also the phase the card links to, so a tap always lands on work.
    job.next = job.phases.find((p) => !SETTLED.has(p.status)) ?? null;

    /*
     * A CANCELLED BOOKING IS NOT WORK, and nothing else here could tell.
     *
     * Cancelling a booking moves the BOOKING's status and deliberately leaves
     * its tasks alone (`applyTransition` writes one row and one custody
     * event; it touches no task). Every derivation below reads task status,
     * so a cancelled booking kept a `pending` verification task and rendered
     * as an ordinary upcoming stop with a working "Start & navigate" button.
     *
     * Core refuses the action — `standingOf("cancelled")` is `terminal` and
     * `bookingActionability` returns `NOTHING` with "This booking was
     * cancelled" (services/actionability.ts) — so nothing could actually
     * happen. What could happen is an agent driving to a door for a pickup
     * that is not coming, and finding out at the doorstep.
     *
     * The stop STAYS in the day. Dropping it would mean an agent who
     * remembers being sent to that address finds no trace of it, and a
     * schedule that quietly loses stops is one nobody can reconcile against
     * what they actually did.
     */
    if (job.booking.status === "cancelled") {
      job.state = "cancelled";
      job.next = null;
    } else if (job.phases.some((p) => p.status === "failed")) job.state = "problem";
    else if (job.phases.every((p) => p.status === "done")) job.state = "done";
    else if (job.phases.some((p) => p.status === "in_progress")) job.state = "active";
    else job.state = "upcoming";
  }

  // Absolute instants, never rendered local times: with two airports in one
  // list a 9 AM Pacific stop would otherwise sort above a 10 AM Eastern one
  // that happens three hours earlier. Unscheduled sinks to the bottom.
  return jobs.sort(
    (a, b) => (a.startsAt?.getTime() ?? Infinity) - (b.startsAt?.getTime() ?? Infinity),
  );
}

/**
 * The pickup task that tapping Navigate on this job should START, or null.
 *
 * Four ways to be null, and each is a real state rather than a guard against
 * a bug:
 *
 *  - the next thing to do is the VERIFICATION visit, and a pickup does not
 *    start before the bags it collects have been sealed;
 *  - the customer has not chosen a driver, so no shift owns the leg yet;
 *  - the leg is already under way, which is idempotent in core but should not
 *    say "Start & navigate" on the button;
 *  - the job is finished;
 *  - the booking was cancelled.
 *
 * Kept here rather than in the card so the rule is testable without rendering
 * anything, and so there is one answer rather than one per surface.
 */
export function startablePickupTaskId(job: Job): string | null {
  // A fifth way to be null, and the only one that is about the BOOKING rather
  // than the task: it was cancelled. `job.next` is already null above, so
  // this is belt and braces — but the rule belongs where the answer is given.
  if (job.state === "cancelled") return null;
  const next = job.next;
  if (!next || next.kind !== "pickup") return null;
  if (next.awaitingDriverChoice) return null;
  // Anything past "waiting to be done" has already started or ended.
  if (next.status !== "pending" && next.status !== "assigned") return null;
  return next.taskId;
}

/** The full address on one line, for display and for the maps query. */
export function addressText(booking: TaskBookingContext): string {
  return [
    booking.addressLine1,
    booking.addressCity,
    [booking.addressState, booking.addressZip].filter(Boolean).join(" "),
  ]
    .filter((part) => part && part.length > 0)
    .join(", ");
}

/**
 * A maps link that works on both platforms.
 *
 * Google's `api=1` search URL is the one form Android opens in the Maps app
 * and iOS opens in Google Maps if installed, Safari otherwise — a `maps://`
 * scheme would be Apple-only and a bare `geo:` Android-only. The place id is
 * passed whenever the customer picked their address from autocomplete: a
 * free-text query can land a driver at the wrong end of a long street, and a
 * place id cannot.
 */
export function mapsUrl(booking: TaskBookingContext): string {
  const query = encodeURIComponent(addressText(booking));
  const placeId = booking.addressPlaceId
    ? `&query_place_id=${encodeURIComponent(booking.addressPlaceId)}`
    : "";
  return `https://www.google.com/maps/search/?api=1&query=${query}${placeId}`;
}

/* ------------------------------------------------------------------ */
/* Sections — how a day is read                                        */
/* ------------------------------------------------------------------ */

/**
 * The schedule, grouped the way a driver reads it.
 *
 * A flat chronological list treats every stop as equally urgent, and they are
 * not. Four buckets, in the order attention should go:
 *
 *  1. **Problems** — a failed phase or a booking ops is holding. Nothing else
 *     on the screen is already going wrong.
 *  2. **Overdue** — the window has passed and the job is not finished. Still
 *     doable right up to the airline's bag drop closing (see actionability),
 *     which is exactly why it must not be hidden.
 *  3. **Today** — the airport-local day the job's own window falls in.
 *  4. **Upcoming** — one group per day after that.
 *
 * FINISHED WORK IS NOT HERE. It moved to History, because a driver looking at
 * a schedule is asking what is left, and a collapsed "12 finished" row at the
 * bottom of that answer is still occupying the answer.
 *
 * AIRPORT-LOCAL, ALWAYS. Production servers run in UTC, so a `today` computed
 * from server-local time opens at 8 PM the previous evening. Every day
 * boundary here comes from `airportLocalDayBounds` against the JOB's own zone,
 * which is what keeps a cross-airport list honest.
 */
export interface JobDay {
  /** `YYYY-MM-DD` in the job's own zone. Stable key for React. */
  key: string;
  jobs: Job[];
}

export interface JobSections {
  problems: Job[];
  overdue: Job[];
  today: Job[];
  upcoming: JobDay[];
}

/** Everything terminal: what History shows and the schedule does not. */
export function isFinished(job: Job): boolean {
  return job.state === "done";
}

/**
 * Whether this stop is still asking the driver for something.
 *
 * THE DISTINCTION THIS EXISTS TO MAKE, and the bug from missing it. A
 * cancelled stop STAYS on the day — F4's call, and the right one: a schedule
 * that quietly loses stops is one nobody can reconcile against what they
 * actually did, and a driver who remembers being sent to that address needs
 * to find it. But staying visible is not the same as being work, and every
 * count on the Today screen was using "not done" as its definition of work.
 *
 * So a driver with two live jobs and one cancelled one read "3 to do", saw
 * "· 1 late" for a stop nobody was going to, and got a route headed "3 stops".
 * Every one of those numbers was wrong in the same way.
 *
 * `isFinished` stays as it was: History lists work that HAPPENED, and a
 * cancelled booking is not a job anybody did.
 */
export function isOutstanding(job: Job): boolean {
  return job.state !== "done" && job.state !== "cancelled";
}

export interface DayBoundsFn {
  (instant: Date, tz: string): { start: Date; end: Date };
}

export interface LocalDayFn {
  (instant: Date, tz: string): string;
}

/**
 * Takes its two date helpers as arguments.
 *
 * Not for testability theatre — `airportLocalDayBounds` and `airportLocalDay`
 * live in `@koolee/core`, which this module deliberately imports only types
 * from, so that `job.ts` stays a pure presentation module that a test can run
 * without a database driver anywhere near it.
 */
export function groupIntoSections(
  jobs: readonly Job[],
  now: Date,
  dayBounds: DayBoundsFn,
  localDay: LocalDayFn,
): JobSections {
  const problems: Job[] = [];
  const overdue: Job[] = [];
  const today: Job[] = [];
  const later: Job[] = [];

  for (const job of jobs) {
    if (isFinished(job)) continue;
    if (job.state === "problem") {
      problems.push(job);
      continue;
    }

    const bounds = dayBounds(now, job.tz);
    // No scheduled time is not "someday": somebody has to look at it, and the
    // only bucket where it will actually be seen is today's.
    if (!job.startsAt) {
      today.push(job);
      continue;
    }
    if (job.startsAt < bounds.start) overdue.push(job);
    else if (job.startsAt <= bounds.end) today.push(job);
    else later.push(job);
  }

  const upcoming: JobDay[] = [];
  for (const job of later) {
    // The job's OWN zone, so a driver working one airport reads their own
    // calendar and a two-airport list does not silently merge two days.
    const key = localDay(job.startsAt!, job.tz);
    const last = upcoming.at(-1);
    if (last?.key === key) last.jobs.push(job);
    else upcoming.push({ key, jobs: [job] });
  }

  return { problems, overdue, today, upcoming };
}

/** Finished work, most recent first — the History tab's list. */
export function finishedJobs(jobs: readonly Job[]): Job[] {
  return jobs
    .filter(isFinished)
    .sort((a, b) => (b.startsAt?.getTime() ?? 0) - (a.startsAt?.getTime() ?? 0));
}
