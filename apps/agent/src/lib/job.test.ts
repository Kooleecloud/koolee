import { describe, expect, it } from "vitest";
import type { AssignedTasks, PickupTask, VerificationTask } from "@koolee/core";

import {
  groupIntoSections,
  groupJobs,
  hasMissedCutoff,
  isDone,
  isOutstanding,
  isSettled,
  settledJobs,
  startablePickupTaskId,
  type Job,
} from "./job";

/**
 * `groupJobs` is presentation over two task tables, and the thing worth
 * pinning is the driver-slice addition: a pickup whose driver the customer has
 * not chosen yet must not read as settled work.
 */

const BOOKING = {
  id: "b-1",
  ref: "KOO-7H2QM",
  paxName: "Casey Rivera",
  flightNumber: "DL123",
  departureAirport: "JFK",
  departureAt: new Date("2025-06-12T22:00:00Z"),
  bagCount: 2,
  status: "verified_sealed",
  addressLine1: "1 Test St",
  addressLine2: null,
  addressCity: "New York",
  addressState: "NY",
  addressZip: "10018",
  addressLat: null,
  addressLng: null,
  addressPlaceId: null,
  contactPhone: null,
  customerPhone: null,
  // No rule on record for this route. `hasMissedCutoff` treats an unknown
  // deadline as not-yet-passed, so fixtures stay actionable unless they say
  // otherwise.
  bagDropCutoffAt: null,
};

const WINDOW_START = new Date("2025-06-12T14:00:00Z");

const verification = (over: Partial<VerificationTask> = {}) => ({
  task: {
    id: "vt-1",
    bookingId: "b-1",
    assigneeUserId: "agent-1",
    status: "done",
    scheduledStart: WINDOW_START,
    scheduledEnd: null,
    startedAt: null,
    completedAt: null,
    notes: null,
    createdAt: WINDOW_START,
    updatedAt: WINDOW_START,
    ...over,
  } as VerificationTask,
  tz: "America/New_York",
  booking: BOOKING,
});

const pickup = (over: Partial<PickupTask> = {}) => ({
  task: {
    id: "pt-1",
    bookingId: "b-1",
    assigneeUserId: "agent-1",
    driverShiftId: null,
    status: "assigned",
    scheduledStart: WINDOW_START,
    scheduledEnd: null,
    startedAt: null,
    completedAt: null,
    notes: null,
    createdAt: WINDOW_START,
    updatedAt: WINDOW_START,
    ...over,
  } as PickupTask,
  tz: "America/New_York",
  booking: BOOKING,
});

const tasksOf = (over: Partial<AssignedTasks> = {}): AssignedTasks => ({
  verification: [verification()],
  pickup: [pickup()],
  ...over,
});

describe("groupJobs", () => {
  it("collapses both task rows into one job, verification first", () => {
    const [job] = groupJobs(tasksOf());
    expect(job!.phases.map((p) => p.kind)).toEqual(["verification", "pickup"]);
    expect(job!.bookingId).toBe("b-1");
  });

  it("flags a pickup nobody has chosen a driver for", () => {
    const [job] = groupJobs(tasksOf());
    const phase = job!.phases.find((p) => p.kind === "pickup");
    expect(phase?.awaitingDriverChoice).toBe(true);
  });

  it("stops flagging once a shift owns the pickup", () => {
    const [job] = groupJobs(tasksOf({ pickup: [pickup({ driverShiftId: "s-1" })] }));
    const phase = job!.phases.find((p) => p.kind === "pickup");
    expect(phase?.awaitingDriverChoice).toBeUndefined();
  });

  it("never flags a verification phase", () => {
    const [job] = groupJobs(tasksOf());
    const phase = job!.phases.find((p) => p.kind === "verification");
    expect(phase?.awaitingDriverChoice).toBeUndefined();
  });

  it("points `next` at the pickup once the visit is done", () => {
    const [job] = groupJobs(tasksOf());
    expect(job!.next?.kind).toBe("pickup");
  });

  it("is done only when both halves are", () => {
    expect(groupJobs(tasksOf())[0]!.state).toBe("upcoming");
    expect(
      groupJobs(tasksOf({ pickup: [pickup({ status: "in_progress" })] }))[0]!.state,
    ).toBe("active");
    expect(groupJobs(tasksOf({ pickup: [pickup({ status: "done" })] }))[0]!.state).toBe(
      "done",
    );
    expect(groupJobs(tasksOf({ pickup: [pickup({ status: "failed" })] }))[0]!.state).toBe(
      "problem",
    );
  });
});

/* ------------------------------------------------------------------ */
/* Sections                                                            */
/* ------------------------------------------------------------------ */

/**
 * The schedule's buckets.
 *
 * The failure this guards is a driver not seeing something: work that falls
 * out of every bucket, or an overdue stop quietly filed under a future day
 * because "today" was computed in the server's zone rather than the airport's.
 */

const TZ = "America/New_York";

/** Airport-local day bounds, faked deterministically for the test. */
const dayBounds = (instant: Date, tz: string) => {
  expect(tz).toBe(TZ);
  const day = instant.toISOString().slice(0, 10);
  // 04:00Z–04:00Z the next day stands in for a New York calendar day, which
  // is close enough to real EDT for the boundary cases below and completely
  // deterministic.
  return {
    start: new Date(`${day}T04:00:00Z`),
    end: new Date(`${day}T27:59:59Z`.replace("T27", "T23")),
  };
};
const localDay = (instant: Date) => instant.toISOString().slice(0, 10);

const job = (over: Partial<Job> = {}): Job => ({
  bookingId: over.bookingId ?? "b-x",
  booking: BOOKING as Job["booking"],
  tz: TZ,
  phases: [],
  startsAt: null,
  next: null,
  state: "upcoming",
  ...over,
});

const NOW = new Date("2026-06-12T15:00:00Z");

describe("groupIntoSections", () => {
  it("puts every unsettled job in exactly one bucket", () => {
    const jobs = [
      job({ bookingId: "problem", state: "problem", startsAt: NOW }),
      job({ bookingId: "overdue", startsAt: new Date("2026-06-11T15:00:00Z") }),
      job({ bookingId: "today", startsAt: new Date("2026-06-12T18:00:00Z") }),
      job({ bookingId: "later", startsAt: new Date("2026-06-14T18:00:00Z") }),
      job({ bookingId: "none" }),
      job({ bookingId: "done", state: "done", startsAt: NOW }),
      job({ bookingId: "cancelled", state: "cancelled", startsAt: NOW }),
    ];

    const s = groupIntoSections(jobs, NOW, dayBounds, localDay);
    expect(s.problems.map((j) => j.bookingId)).toEqual(["problem"]);
    expect(s.overdue.map((j) => j.bookingId)).toEqual(["overdue"]);
    expect(s.today.map((j) => j.bookingId)).toEqual(["today"]);
    expect(s.unscheduled.map((j) => j.bookingId)).toEqual(["none"]);
    expect(s.upcoming.flatMap((d) => d.jobs.map((j) => j.bookingId))).toEqual(["later"]);

    // Nothing lost, nothing duplicated — the property that actually matters.
    const placed = [
      ...s.problems,
      ...s.overdue,
      ...s.today,
      ...s.unscheduled,
      ...s.upcoming.flatMap((d) => d.jobs),
    ].map((j) => j.bookingId);
    expect(placed.sort()).toEqual(["later", "none", "overdue", "problem", "today"]);
  });

  it("keeps finished work off the schedule entirely", () => {
    const jobs = [job({ bookingId: "done", state: "done", startsAt: NOW })];
    const s = groupIntoSections(jobs, NOW, dayBounds, localDay);
    expect(s.problems.concat(s.overdue, s.today, s.unscheduled)).toHaveLength(0);
    expect(s.upcoming).toHaveLength(0);
  });

  /*
   * THE BUG TD REPORTED. A cancelled booking from weeks ago led both the
   * Today rail and the Schedule, because it was neither done (so never
   * finished) nor outstanding — and an old window sorts to the top of
   * Overdue. It now leaves the schedule entirely and turns up in History.
   */
  it("keeps a cancelled stop off the schedule instead of filing it overdue", () => {
    const jobs = [
      job({
        bookingId: "cancelled-last-month",
        state: "cancelled",
        startsAt: new Date("2026-05-14T15:00:00Z"),
      }),
    ];
    const s = groupIntoSections(jobs, NOW, dayBounds, localDay);
    expect(s.overdue).toHaveLength(0);
    expect(s.problems.concat(s.today, s.unscheduled)).toHaveLength(0);
    expect(s.upcoming).toHaveLength(0);
  });

  /*
   * A stop past its airline's bag-drop cutoff cannot be completed by driving
   * anywhere, so it is not a chore — it is something somebody has to be told
   * about. Filed with the problems, which lead the screen.
   */
  it("files a stop past its bag-drop cutoff as a problem, not as overdue", () => {
    const jobs = [
      job({
        bookingId: "missed",
        startsAt: new Date("2026-06-11T15:00:00Z"),
        booking: {
          ...BOOKING,
          bagDropCutoffAt: new Date("2026-06-11T20:00:00Z"),
        } as Job["booking"],
      }),
    ];
    const s = groupIntoSections(jobs, NOW, dayBounds, localDay);
    expect(s.problems.map((j) => j.bookingId)).toEqual(["missed"]);
    expect(s.overdue).toHaveLength(0);
  });

  it("leaves a late stop whose cutoff has not passed in overdue", () => {
    const jobs = [
      job({
        bookingId: "late-but-doable",
        startsAt: new Date("2026-06-11T15:00:00Z"),
        booking: {
          ...BOOKING,
          bagDropCutoffAt: new Date("2026-06-12T22:00:00Z"),
        } as Job["booking"],
      }),
    ];
    const s = groupIntoSections(jobs, NOW, dayBounds, localDay);
    expect(s.overdue.map((j) => j.bookingId)).toEqual(["late-but-doable"]);
    expect(s.problems).toHaveLength(0);
  });

  it("shows a problem as a problem even when it is overdue", () => {
    // Ordering of the checks, pinned: a failed stop from yesterday belongs at
    // the top of the screen, not filed under "Overdue" with the merely late.
    const jobs = [
      job({
        bookingId: "x",
        state: "problem",
        startsAt: new Date("2026-06-01T15:00:00Z"),
      }),
    ];
    const s = groupIntoSections(jobs, NOW, dayBounds, localDay);
    expect(s.problems).toHaveLength(1);
    expect(s.overdue).toHaveLength(0);
  });

  it("gives an unscheduled job its own bucket rather than dropping it", () => {
    /*
     * "Someday" is not a bucket anybody looks at, so it is still surfaced —
     * but not inside Today. Today is drawn as an ordered ROUTE, and a stop
     * with no time has no position in one; putting it there invents a
     * position for the single job whose position is genuinely unknown.
     */
    const s = groupIntoSections([job({ bookingId: "x" })], NOW, dayBounds, localDay);
    expect(s.unscheduled.map((j) => j.bookingId)).toEqual(["x"]);
    expect(s.today).toHaveLength(0);
  });

  it("groups upcoming work one entry per day", () => {
    const jobs = [
      job({ bookingId: "a", startsAt: new Date("2026-06-14T14:00:00Z") }),
      job({ bookingId: "b", startsAt: new Date("2026-06-14T18:00:00Z") }),
      job({ bookingId: "c", startsAt: new Date("2026-06-15T14:00:00Z") }),
    ];
    const s = groupIntoSections(jobs, NOW, dayBounds, localDay);
    expect(s.upcoming.map((d) => d.key)).toEqual(["2026-06-14", "2026-06-15"]);
    expect(s.upcoming[0]!.jobs.map((j) => j.bookingId)).toEqual(["a", "b"]);
  });

  it("uses the JOB's zone for the day boundary, never the server's", () => {
    // The whole reason `dayBounds` is a parameter. `dayBounds` above asserts
    // it is handed the job's tz; a server-local implementation would not be.
    expect(() =>
      groupIntoSections([job({ startsAt: NOW, tz: TZ })], NOW, dayBounds, localDay),
    ).not.toThrow();
  });
});

describe("settledJobs", () => {
  it("returns settled work, most recent first", () => {
    const jobs = [
      job({
        bookingId: "old",
        state: "done",
        startsAt: new Date("2026-06-01T14:00:00Z"),
      }),
      job({ bookingId: "open", startsAt: NOW }),
      job({
        bookingId: "new",
        state: "done",
        startsAt: new Date("2026-06-10T14:00:00Z"),
      }),
    ];
    expect(settledJobs(jobs).map((j) => j.bookingId)).toEqual(["new", "old"]);
  });

  /*
   * History is where a cancelled stop goes now, and this is the assertion
   * that keeps it there. An agent who remembers driving to that address has
   * to be able to find it; the requirement was never that it stay in a list
   * of things to go and do.
   */
  it("includes cancelled stops alongside completed ones", () => {
    const jobs = [
      job({
        bookingId: "cancelled",
        state: "cancelled",
        startsAt: new Date("2026-06-11T14:00:00Z"),
      }),
      job({
        bookingId: "done",
        state: "done",
        startsAt: new Date("2026-06-10T14:00:00Z"),
      }),
      job({ bookingId: "open", startsAt: NOW }),
    ];
    expect(settledJobs(jobs).map((j) => j.bookingId)).toEqual(["cancelled", "done"]);
  });
});

/**
 * The rule that decides whether tapping Navigate also STARTS the pickup leg.
 *
 * It writes a custody event and makes the customer's map go live, so every
 * "no" here is protecting something real: bags that are not sealed yet, a leg
 * nobody has been assigned to, or one that is already under way.
 */
describe("startablePickupTaskId", () => {
  it("starts the pickup when it is the next thing to do", () => {
    const job = groupJobs({
      verification: [verification({ status: "done" })],
      pickup: [pickup({ status: "assigned", driverShiftId: "shift-1" })],
    })[0]!;
    expect(startablePickupTaskId(job)).toBe("pt-1");
  });

  it("refuses while the verification visit is still outstanding", () => {
    // A pickup collects sealed bags. There are none yet.
    const job = groupJobs({
      verification: [verification({ status: "assigned" })],
      pickup: [pickup({ status: "assigned", driverShiftId: "shift-1" })],
    })[0]!;
    expect(startablePickupTaskId(job)).toBeNull();
  });

  it("refuses while the customer has not chosen a driver", () => {
    // No shift owns the leg, so there is nobody for it to be under way FOR.
    const job = groupJobs({
      verification: [verification({ status: "done" })],
      pickup: [pickup({ status: "assigned", driverShiftId: null })],
    })[0]!;
    expect(startablePickupTaskId(job)).toBeNull();
  });

  it("refuses once the leg is already under way", () => {
    // Idempotent in core, but the button must not offer to start it again.
    const job = groupJobs({
      verification: [verification({ status: "done" })],
      pickup: [pickup({ status: "in_progress", driverShiftId: "shift-1" })],
    })[0]!;
    expect(startablePickupTaskId(job)).toBeNull();
  });

  it("refuses on a finished job", () => {
    const job = groupJobs({
      verification: [verification({ status: "done" })],
      pickup: [pickup({ status: "done", driverShiftId: "shift-1" })],
    })[0]!;
    expect(startablePickupTaskId(job)).toBeNull();
  });
});

/**
 * A CANCELLED BOOKING IS NOT WORK — and nothing in this module could tell.
 *
 * Cancelling a booking moves the BOOKING's status and deliberately leaves its
 * tasks alone: `applyTransition` writes one row and one custody event, and
 * touches no task table. Every derivation in `groupJobs` reads TASK status,
 * so a cancelled booking kept its `pending` verification task and rendered as
 * an ordinary upcoming stop with a working "Start & navigate" button.
 *
 * Core refuses the action — `standingOf("cancelled")` is `terminal` and
 * `bookingActionability` returns `NOTHING` with "This booking was cancelled"
 * (packages/core/src/services/actionability.ts) — so nothing could actually
 * happen. What could happen is an agent driving to a door for a pickup that
 * is not coming, and finding out on the doorstep.
 */
describe("a cancelled booking in the agent's day", () => {
  const cancelledTasks = () => ({
    verification: [
      {
        ...verification({ status: "pending" }),
        booking: { ...BOOKING, status: "cancelled" },
      },
    ],
    pickup: [
      { ...pickup({ status: "pending" }), booking: { ...BOOKING, status: "cancelled" } },
    ],
  });

  it("is its own state, not 'upcoming'", () => {
    const [job] = groupJobs(cancelledTasks());
    expect(job!.state).toBe("cancelled");
  });

  it("has nothing to do next, so no card can link to work", () => {
    const [job] = groupJobs(cancelledTasks());
    expect(job!.next).toBeNull();
  });

  it("offers no startable pickup, whatever the task rows say", () => {
    const [job] = groupJobs(cancelledTasks());
    expect(startablePickupTaskId(job!)).toBeNull();
  });

  it("STAYS in the day rather than disappearing from it", () => {
    // A schedule that quietly drops stops is one nobody can reconcile against
    // what they actually did. The agent who remembers being sent to that
    // address must still find it.
    const jobs = groupJobs(cancelledTasks());
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.bookingId).toBe("b-1");
    expect(jobs[0]!.phases).toHaveLength(2);
  });

  it("does not disturb a live booking beside it", () => {
    const jobs = groupJobs({
      verification: [
        {
          ...verification({ status: "pending" }),
          booking: { ...BOOKING, status: "cancelled" },
        },
      ],
      pickup: [
        {
          ...pickup({ id: "pt-2", status: "assigned", driverShiftId: "s-1" } as never),
          booking: { ...BOOKING, id: "b-2", status: "awaiting_pickup" },
        },
      ],
    });
    const live = jobs.find((j) => j.bookingId === "b-2");
    expect(live!.state).toBe("upcoming");
    expect(live!.next).not.toBeNull();
  });
});

/**
 * THREE PREDICATES, THREE QUESTIONS — and the bug that came from having two.
 *
 * F4 gave a cancelled booking its own `JobState` and stopped the expanded card
 * offering Navigate and Call. What it did not do was teach the DAY about it.
 * `isFinished` was "done" only, so a cancelled stop was not finished; it was
 * not outstanding either; and every bucket that filtered on one or the other
 * let it through into `overdue`, where an old window sorts to the top. TD
 * opened the agent app to a Today rail and a Schedule both led by cancelled
 * bookings from 27 and 30 August.
 *
 * The three cannot be merged, because they are read in three places that want
 * three different answers:
 *
 *  - `isDone` — did somebody DO this? The "N done" count on Today.
 *  - `isSettled` — is there anything left to do? What History shows and the
 *    schedule does not.
 *  - `isOutstanding` — is this still asking for something? Every count of
 *    remaining work.
 */
describe("isDone / isSettled / isOutstanding", () => {
  const jobIn = (state: Job["state"]): Job => ({
    bookingId: "b-1",
    booking: BOOKING as Job["booking"],
    tz: "America/New_York",
    phases: [],
    startsAt: null,
    next: null,
    state,
  });

  it.each(["upcoming", "active", "problem"] as const)(
    "counts a %s stop as work",
    (state) => {
      expect(isOutstanding(jobIn(state))).toBe(true);
      expect(isSettled(jobIn(state))).toBe(false);
      expect(isDone(jobIn(state))).toBe(false);
    },
  );

  it("does not count a done stop as work", () => {
    expect(isOutstanding(jobIn("done"))).toBe(false);
  });

  /* THE BUG. A cancelled stop is not work, and must not be counted as any. */
  it("does not count a cancelled stop as work", () => {
    expect(isOutstanding(jobIn("cancelled"))).toBe(false);
  });

  /*
   * THE FIX. Cancelled is settled — it leaves the schedule and turns up in
   * History — while still not being work anybody performed. Collapsing these
   * two into one predicate would either file a cancelled booking under a
   * driver's completed work or put it back in the to-do count, which are
   * exactly the two failures this trio exists to keep apart.
   */
  it("calls a cancelled stop settled without calling it done", () => {
    expect(isSettled(jobIn("cancelled"))).toBe(true);
    expect(isDone(jobIn("cancelled"))).toBe(false);
  });

  it("calls a done stop both settled and done", () => {
    expect(isSettled(jobIn("done"))).toBe(true);
    expect(isDone(jobIn("done"))).toBe(true);
  });
});

/**
 * The deadline that separates "late" from "cannot happen".
 *
 * A pickup stays doable long past its window — that is why late stops are
 * surfaced rather than hidden — right up to the airline's bag-drop cutoff.
 * Past it, driving to the door achieves nothing.
 */
describe("hasMissedCutoff", () => {
  const withCutoff = (bagDropCutoffAt: Date | null): Job => ({
    bookingId: "b-1",
    booking: { ...BOOKING, bagDropCutoffAt } as Job["booking"],
    tz: "America/New_York",
    phases: [],
    startsAt: null,
    next: null,
    state: "upcoming",
  });

  it("is true once the cutoff has passed", () => {
    expect(hasMissedCutoff(withCutoff(new Date("2026-06-12T14:00:00Z")), NOW)).toBe(true);
  });

  it("is false while the cutoff is still ahead", () => {
    expect(hasMissedCutoff(withCutoff(new Date("2026-06-12T16:00:00Z")), NOW)).toBe(
      false,
    );
  });

  /*
   * An unknown deadline is never treated as a passed one. No rule on record
   * for the route means a human decides, not a filter that quietly moves the
   * stop out of the driver's list.
   */
  it("is false when the route has no cutoff on record", () => {
    expect(hasMissedCutoff(withCutoff(null), NOW)).toBe(false);
  });

  /*
   * Defensive, and deliberately tested: a booking context assembled before
   * this field existed hands over `undefined`, and a screen a driver depends
   * on mid-shift must not throw over one oddly-shaped row.
   */
  it("survives a booking context with no cutoff field at all", () => {
    const legacy = {
      bookingId: "b-1",
      booking: { ...BOOKING, bagDropCutoffAt: undefined } as unknown as Job["booking"],
      tz: "America/New_York",
      phases: [],
      startsAt: null,
      next: null,
      state: "upcoming" as const,
    };
    expect(() => hasMissedCutoff(legacy, NOW)).not.toThrow();
    expect(hasMissedCutoff(legacy, NOW)).toBe(false);
  });
});
