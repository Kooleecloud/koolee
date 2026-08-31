import { describe, expect, it } from "vitest";
import type { AssignedTasks, PickupTask, VerificationTask } from "@koolee/core";

import {
  finishedJobs,
  groupIntoSections,
  groupJobs,
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
  it("puts every unfinished job in exactly one bucket", () => {
    const jobs = [
      job({ bookingId: "problem", state: "problem", startsAt: NOW }),
      job({ bookingId: "overdue", startsAt: new Date("2026-06-11T15:00:00Z") }),
      job({ bookingId: "today", startsAt: new Date("2026-06-12T18:00:00Z") }),
      job({ bookingId: "later", startsAt: new Date("2026-06-14T18:00:00Z") }),
      job({ bookingId: "done", state: "done", startsAt: NOW }),
    ];

    const s = groupIntoSections(jobs, NOW, dayBounds, localDay);
    expect(s.problems.map((j) => j.bookingId)).toEqual(["problem"]);
    expect(s.overdue.map((j) => j.bookingId)).toEqual(["overdue"]);
    expect(s.today.map((j) => j.bookingId)).toEqual(["today"]);
    expect(s.upcoming.flatMap((d) => d.jobs.map((j) => j.bookingId))).toEqual(["later"]);

    // Nothing lost, nothing duplicated — the property that actually matters.
    const placed = [
      ...s.problems,
      ...s.overdue,
      ...s.today,
      ...s.upcoming.flatMap((d) => d.jobs),
    ].map((j) => j.bookingId);
    expect(placed.sort()).toEqual(["later", "overdue", "problem", "today"]);
  });

  it("keeps finished work off the schedule entirely", () => {
    const jobs = [job({ bookingId: "done", state: "done", startsAt: NOW })];
    const s = groupIntoSections(jobs, NOW, dayBounds, localDay);
    expect(s.problems.concat(s.overdue, s.today)).toHaveLength(0);
    expect(s.upcoming).toHaveLength(0);
  });

  it("shows a problem as a problem even when it is overdue", () => {
    // Ordering of the checks, pinned: a failed stop from yesterday belongs at
    // the top of the screen, not filed under "Overdue" with the merely late.
    const jobs = [
      job({ bookingId: "x", state: "problem", startsAt: new Date("2026-06-01T15:00:00Z") }),
    ];
    const s = groupIntoSections(jobs, NOW, dayBounds, localDay);
    expect(s.problems).toHaveLength(1);
    expect(s.overdue).toHaveLength(0);
  });

  it("files an unscheduled job under Today rather than dropping it", () => {
    // "Someday" is not a bucket anybody looks at. Somebody has to see it.
    const s = groupIntoSections([job({ bookingId: "x" })], NOW, dayBounds, localDay);
    expect(s.today.map((j) => j.bookingId)).toEqual(["x"]);
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

describe("finishedJobs", () => {
  it("returns only finished work, most recent first", () => {
    const jobs = [
      job({ bookingId: "old", state: "done", startsAt: new Date("2026-06-01T14:00:00Z") }),
      job({ bookingId: "open", startsAt: NOW }),
      job({ bookingId: "new", state: "done", startsAt: new Date("2026-06-10T14:00:00Z") }),
    ];
    expect(finishedJobs(jobs).map((j) => j.bookingId)).toEqual(["new", "old"]);
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
