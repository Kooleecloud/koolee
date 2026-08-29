import { describe, expect, it } from "vitest";
import type { AssignedTasks, PickupTask, VerificationTask } from "@koolee/core";

import { groupJobs } from "./job";

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
  addressCity: "New York",
  addressState: "NY",
  addressZip: "10018",
  addressPlaceId: null,
  contactPhone: null,
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
