import type { AssignedTasksResponse, TaskBookingContext } from "@koolee/api-contract";

import { airportLocalDay, airportLocalDayBounds, iso } from "./time";

/**
 * A "job" — one booking, and everything this driver has to do for it.
 *
 * A port of the web agent app's `lib/job.ts`, rule for rule. The database has
 * two task tables and the agent app used to render them as two independent
 * rows. On a phone that read as duplicate work: the same customer, the same
 * window, the same address, listed twice, three lines apart. A driver does
 * not experience "a verification task and a pickup task", they experience one
 * trip to one door with two things to do there.
 *
 * So the grouping happens here, in presentation, and the two task rows stay
 * exactly as they are underneath — which is what keeps this reversible if the
 * two halves are ever assigned to different people.
 *
 * WHAT DIFFERS FROM THE WEB. Inputs are the CONTRACT rows, where every date
 * is an ISO string; they become `Date`s here, once, so every screen downstream
 * reads the same shape the web components did and the formatters in
 * `lib/time` take instants rather than strings.
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

/** The contract's booking context with its two instants parsed. */
export interface JobBooking extends Omit<
  TaskBookingContext,
  "departureAt" | "bagDropCutoffAt"
> {
  departureAt: Date;
  bagDropCutoffAt: Date | null;
}

export interface Job {
  bookingId: string;
  booking: JobBooking;
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

/** The two lists; `serverTime` is not needed to group. */
export type AssignedTaskRows = Pick<AssignedTasksResponse, "verification" | "pickup">;

function toDate(value: string | null): Date | null {
  return value === null ? null : iso(value);
}

function toJobBooking(booking: TaskBookingContext): JobBooking {
  return {
    ...booking,
    departureAt: iso(booking.departureAt),
    bagDropCutoffAt: toDate(booking.bagDropCutoffAt),
  };
}

export function groupJobs(tasks: AssignedTaskRows): Job[] {
  const byBooking = new Map<string, Job>();

  const add = (kind: JobPhaseKind, rows: AssignedTaskRows["verification" | "pickup"]) => {
    for (const { task, tz, booking } of rows) {
      const existing = byBooking.get(booking.id);
      const phase: JobPhase = {
        kind,
        taskId: task.id,
        status: task.status,
        scheduledStart: toDate(task.scheduledStart),
        scheduledEnd: toDate(task.scheduledEnd),
        ...(kind === "pickup" && "driverShiftId" in task && task.driverShiftId === null
          ? { awaitingDriverChoice: true }
          : {}),
      };
      if (existing) {
        existing.phases.push(phase);
      } else {
        byBooking.set(booking.id, {
          bookingId: booking.id,
          booking: toJobBooking(booking),
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
     * its tasks alone (core's `applyTransition` writes one row and one custody
     * event; it touches no task). Every derivation below reads task status,
     * so a cancelled booking kept a `pending` verification task and rendered
     * as an ordinary upcoming stop with a working "Start & navigate" button.
     *
     * The stop STAYS in the day. Dropping it would mean a driver who
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
 * Five ways to be null, and each is a real state rather than a guard against
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
  // The only one that is about the BOOKING rather than the task. `job.next`
  // is already null above, so this is belt and braces — but the rule belongs
  // where the answer is given.
  if (job.state === "cancelled") return null;
  const next = job.next;
  if (!next || next.kind !== "pickup") return null;
  if (next.awaitingDriverChoice) return null;
  // Anything past "waiting to be done" has already started or ended.
  if (next.status !== "pending" && next.status !== "assigned") return null;
  return next.taskId;
}

/** The full address on one line, for display and for the maps query. */
export function addressText(
  booking: Pick<
    JobBooking,
    "addressLine1" | "addressCity" | "addressState" | "addressZip"
  >,
): string {
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
export function mapsUrl(
  booking: Pick<
    JobBooking,
    "addressLine1" | "addressCity" | "addressState" | "addressZip" | "addressPlaceId"
  >,
): string {
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
 * AIRPORT-LOCAL, ALWAYS. The phone's zone is wherever the driver is, so a
 * `today` computed from it is wrong the moment they cross a zone line. Every
 * day boundary here comes from `airportLocalDayBounds` against the JOB's own
 * zone, which is what keeps a cross-airport list honest.
 */
export interface JobDay {
  /** `YYYY-MM-DD` in the job's own zone. Stable key for React. */
  key: string;
  jobs: Job[];
}

export interface JobSections {
  /**
   * Needs a human: a failed phase, or a stop whose bag-drop cutoff has passed
   * and which therefore cannot be completed at all.
   */
  problems: Job[];
  /**
   * Late but still doable — the window has passed, the cutoff has not.
   *
   * RENDERED LAST despite sorting first, which is the point. These are real
   * work and must not be hidden, but a stop from three days ago is not what a
   * driver opens the app to find out about; today's next stop is. The section
   * order on the page is Problems → Today → Upcoming → these.
   */
  overdue: Job[];
  today: Job[];
  upcoming: JobDay[];
  /**
   * Assigned with no window on it.
   *
   * ITS OWN BUCKET rather than folded into `today`. Today's screen draws its
   * stops as a ROUTE — an ordered sequence — and a stop with no time has no
   * position in one; slotting it in puts a made-up position on the single job
   * whose position is genuinely unknown.
   */
  unscheduled: Job[];
}

/**
 * Work that somebody actually DID. History's "completed" half.
 *
 * Kept separate from `isSettled` because they answer different questions and
 * a single predicate cannot do both: this one is "did this happen", and the
 * count of a driver's finished stops must never include ones that were called
 * off.
 */
export function isDone(job: Job): boolean {
  return job.state === "done";
}

/**
 * Nothing left to do here, whether or not anybody did it.
 *
 * A cancelled stop is not done — so a "done only" predicate left it neither
 * finished nor outstanding, and it fell through every bucket into `overdue`,
 * where it stayed FOREVER, sorted to the top because its window was the
 * oldest in the queue. Cancelled goes to HISTORY instead: still findable,
 * next to the rest of the day it belonged to, in the one place that is not a
 * list of things to go and do.
 */
export function isSettled(job: Job): boolean {
  return job.state === "done" || job.state === "cancelled";
}

/**
 * This stop's deadline has passed and it can no longer happen.
 *
 * NOT THE SAME AS OVERDUE. A pickup stays genuinely doable — and genuinely
 * urgent — long past its window, right up to the airline's bag-drop cutoff;
 * that is exactly why late stops are surfaced rather than hidden. One minute
 * past the cutoff the stop is not late work, it is work that cannot be done,
 * and a to-do list where those two look identical is a list a driver has to
 * think their way through instead of reading.
 *
 * Null cutoff means the route has no rule on record, and an unknown deadline
 * is never treated as a passed one — the stop stays actionable and a human
 * decides.
 */
export function hasMissedCutoff(job: Job, now: Date): boolean {
  const cutoff = job.booking.bagDropCutoffAt;
  // Truthiness, not `!== null`: a Date is always truthy, and this guard also
  // absorbs an `undefined` from a booking context assembled before the field
  // existed. A screen a driver depends on mid-shift must not throw because one
  // row is shaped like last week's.
  if (!cutoff) return false;
  return now.getTime() >= cutoff.getTime();
}

/**
 * Whether this stop is still asking the driver for something.
 *
 * The inverse of `isSettled`, and deliberately written out rather than
 * expressed as `!isSettled(job)`: the two are read in opposite places (this
 * one on Today's counts, that one on History's list) and keeping both explicit
 * is what makes a future third state — paused, say — impossible to add to one
 * without being forced to think about the other.
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
 * The two date helpers stay parameters, as on the web, so a test can pin the
 * bucket rules against a deterministic calendar; screens take the defaults,
 * which are the real airport-local helpers from `lib/time`.
 */
export function groupIntoSections(
  jobs: readonly Job[],
  now: Date,
  dayBounds: DayBoundsFn = airportLocalDayBounds,
  localDay: LocalDayFn = airportLocalDay,
): JobSections {
  const problems: Job[] = [];
  const overdue: Job[] = [];
  const today: Job[] = [];
  const later: Job[] = [];
  const unscheduled: Job[] = [];

  for (const job of jobs) {
    // SETTLED, NOT DONE. Cancelled leaves the schedule here and reappears in
    // History — see `isSettled`.
    if (isSettled(job)) continue;
    if (job.state === "problem") {
      problems.push(job);
      continue;
    }
    // A STOP PAST ITS CUTOFF IS A PROBLEM, NOT A CHORE. It cannot be done, so
    // it does not belong in a list of things to go and do — and it must not
    // be silently dropped either, because somebody has to tell the customer.
    if (hasMissedCutoff(job, now)) {
      problems.push(job);
      continue;
    }

    const bounds = dayBounds(now, job.tz);
    // No scheduled time is not "someday" — somebody still has to look at it —
    // but it is not part of an ordered route either. See `unscheduled`.
    if (!job.startsAt) {
      unscheduled.push(job);
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

  return { problems, overdue, today, upcoming, unscheduled };
}

/**
 * Everything settled, most recent first — the History tab's list.
 *
 * BOTH DONE AND CANCELLED. History is "the days you have already worked", and
 * a stop that was called off is part of one of them; the card marks it
 * cancelled so it is never mistaken for work performed. The count of work
 * actually done is `isDone`, not the length of this list.
 */
export function settledJobs(jobs: readonly Job[]): Job[] {
  return jobs
    .filter(isSettled)
    .sort((a, b) => (b.startsAt?.getTime() ?? 0) - (a.startsAt?.getTime() ?? 0));
}
