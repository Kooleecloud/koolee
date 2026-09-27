import { describe, expect, it } from "vitest";
import type { PickupTaskRow, VerificationTaskRow } from "@koolee/api-contract";

import {
  addressText,
  groupIntoSections,
  groupJobs,
  hasMissedCutoff,
  isDone,
  isOutstanding,
  isSettled,
  mapsUrl,
  settledJobs,
  startablePickupTaskId,
  type AssignedTaskRows,
  type Job,
} from "./job";
import { airportLocalDay, airportLocalDayBounds } from "./time";

/**
 * The web's `job.test.ts`, run against the CONTRACT shapes: every date is an
 * ISO string on the way in, and the assertions check it came out a Date.
 */

const BOOKING = {
  id: "b-1",
  ref: "KOO-7H2QM",
  paxName: "Casey Rivera",
  flightNumber: "DL123",
  departureAirport: "JFK",
  departureAt: "2025-06-12T22:00:00.000Z",
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

const WINDOW_START = "2025-06-12T14:00:00.000Z";

const verification = (over: Partial<VerificationTaskRow> = {}) => ({
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
  } as VerificationTaskRow,
  tz: "America/New_York",
  booking: BOOKING,
});

const pickup = (over: Partial<PickupTaskRow> = {}) => ({
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
  } as PickupTaskRow,
  tz: "America/New_York",
  booking: BOOKING,
});

const tasksOf = (over: Partial<AssignedTaskRows> = {}): AssignedTaskRows => ({
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

  it("parses the contract's ISO strings into instants, once", () => {
    const [job] = groupJobs(tasksOf());
    expect(job!.startsAt).toBeInstanceOf(Date);
    expect(job!.startsAt?.toISOString()).toBe(WINDOW_START);
    expect(job!.phases[0]!.scheduledStart?.toISOString()).toBe(WINDOW_START);
    expect(job!.phases[0]!.scheduledEnd).toBeNull();
    expect(job!.booking.departureAt).toBeInstanceOf(Date);
    expect(job!.booking.bagDropCutoffAt).toBeNull();
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

  it("derives one state per job: upcoming / active / done / problem", () => {
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

  it("orders by absolute instant and sinks unscheduled work to the bottom", () => {
    const jobs = groupJobs({
      verification: [
        {
          ...verification({ id: "vt-late", scheduledStart: "2025-06-12T16:00:00.000Z" }),
          booking: { ...BOOKING, id: "b-late" },
        },
        {
          ...verification({ id: "vt-none", scheduledStart: null }),
          booking: { ...BOOKING, id: "b-none" },
        },
        {
          ...verification({ id: "vt-early", scheduledStart: "2025-06-12T13:00:00.000Z" }),
          booking: { ...BOOKING, id: "b-early" },
        },
      ],
      pickup: [],
    });
    expect(jobs.map((j) => j.bookingId)).toEqual(["b-early", "b-late", "b-none"]);
  });
});

describe("addressText / mapsUrl", () => {
  it("joins the address on one line and drops empty parts", () => {
    expect(addressText(BOOKING)).toBe("1 Test St, New York, NY 10018");
    expect(addressText({ ...BOOKING, addressState: null, addressZip: null })).toBe(
      "1 Test St, New York",
    );
  });

  it("builds the api=1 search URL, with the place id when there is one", () => {
    expect(mapsUrl(BOOKING)).toBe(
      "https://www.google.com/maps/search/?api=1&query=1%20Test%20St%2C%20New%20York%2C%20NY%2010018",
    );
    expect(mapsUrl({ ...BOOKING, addressPlaceId: "ChIJ/x" })).toContain(
      "&query_place_id=ChIJ%2Fx",
    );
  });
});

/* ------------------------------------------------------------------ */
/* Sections                                                            */
/* ------------------------------------------------------------------ */

/**
 * The schedule's buckets, against the REAL New York calendar. The web test
 * faked the day bounds; here the helpers live in the same package, so the
 * boundary cases can be pinned to the actual EDT day.
 */

const TZ = "America/New_York";

const job = (over: Partial<Job> = {}): Job => ({
  bookingId: over.bookingId ?? "b-x",
  booking: groupJobs(tasksOf())[0]!.booking,
  tz: TZ,
  phases: [],
  startsAt: null,
  next: null,
  state: "upcoming",
  ...over,
});

// 11:00 AM EDT on Friday 12 June 2026. The New York day runs 04:00Z → 04:00Z.
const NOW = new Date("2026-06-12T15:00:00Z");

describe("airportLocalDayBounds / airportLocalDay", () => {
  it("brackets the New York day the instant falls in, in EDT", () => {
    const { start, end } = airportLocalDayBounds(NOW, TZ);
    expect(start.toISOString()).toBe("2026-06-12T04:00:00.000Z");
    expect(end.toISOString()).toBe("2026-06-13T04:00:00.000Z");
    expect(airportLocalDay(NOW, TZ)).toBe("2026-06-12");
  });

  it("files 1 AM New York on the previous UTC date under the right local day", () => {
    // 01:00 EDT on the 12th is 05:00Z on the 12th; 23:30 EDT on the 11th is
    // 03:30Z on the 12th — a UTC-day bucket would put both on the 12th.
    expect(airportLocalDay(new Date("2026-06-12T03:30:00Z"), TZ)).toBe("2026-06-11");
    expect(airportLocalDay(new Date("2026-06-12T05:00:00Z"), TZ)).toBe("2026-06-12");
  });

  it("produces exactly one day across the spring-forward night", () => {
    // 8 March 2026 is 23 hours long in New York.
    const { start, end } = airportLocalDayBounds(new Date("2026-03-08T12:00:00Z"), TZ);
    expect(start.toISOString()).toBe("2026-03-08T05:00:00.000Z");
    expect(end.toISOString()).toBe("2026-03-09T04:00:00.000Z");
  });
});

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

    const s = groupIntoSections(jobs, NOW);
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

  it("uses the New York day, not the UTC one, for 'today'", () => {
    // 11:30 PM EDT on the 11th is 03:30Z on the 12th: a UTC bucket calls it
    // today, the airport calls it yesterday — and it is overdue.
    const lastNight = job({ bookingId: "x", startsAt: new Date("2026-06-12T03:30:00Z") });
    // 11:30 PM EDT on the 12th is 03:30Z on the 13th: still today.
    const tonight = job({ bookingId: "y", startsAt: new Date("2026-06-13T03:30:00Z") });
    const s = groupIntoSections([lastNight, tonight], NOW);
    expect(s.overdue.map((j) => j.bookingId)).toEqual(["x"]);
    expect(s.today.map((j) => j.bookingId)).toEqual(["y"]);
  });

  it("keeps finished work off the schedule entirely", () => {
    const jobs = [job({ bookingId: "done", state: "done", startsAt: NOW })];
    const s = groupIntoSections(jobs, NOW);
    expect(s.problems.concat(s.overdue, s.today, s.unscheduled)).toHaveLength(0);
    expect(s.upcoming).toHaveLength(0);
  });

  it("keeps a cancelled stop off the schedule instead of filing it overdue", () => {
    const jobs = [
      job({
        bookingId: "cancelled-last-month",
        state: "cancelled",
        startsAt: new Date("2026-05-14T15:00:00Z"),
      }),
    ];
    const s = groupIntoSections(jobs, NOW);
    expect(s.overdue).toHaveLength(0);
    expect(s.problems.concat(s.today, s.unscheduled)).toHaveLength(0);
    expect(s.upcoming).toHaveLength(0);
  });

  it("files a stop past its bag-drop cutoff as a problem, not as overdue", () => {
    const jobs = [
      job({
        bookingId: "missed",
        startsAt: new Date("2026-06-11T15:00:00Z"),
        booking: {
          ...job().booking,
          bagDropCutoffAt: new Date("2026-06-11T20:00:00Z"),
        },
      }),
    ];
    const s = groupIntoSections(jobs, NOW);
    expect(s.problems.map((j) => j.bookingId)).toEqual(["missed"]);
    expect(s.overdue).toHaveLength(0);
  });

  it("leaves a late stop whose cutoff has not passed in overdue", () => {
    const jobs = [
      job({
        bookingId: "late-but-doable",
        startsAt: new Date("2026-06-11T15:00:00Z"),
        booking: {
          ...job().booking,
          bagDropCutoffAt: new Date("2026-06-12T22:00:00Z"),
        },
      }),
    ];
    const s = groupIntoSections(jobs, NOW);
    expect(s.overdue.map((j) => j.bookingId)).toEqual(["late-but-doable"]);
    expect(s.problems).toHaveLength(0);
  });

  it("shows a problem as a problem even when it is overdue", () => {
    const jobs = [
      job({
        bookingId: "x",
        state: "problem",
        startsAt: new Date("2026-06-01T15:00:00Z"),
      }),
    ];
    const s = groupIntoSections(jobs, NOW);
    expect(s.problems).toHaveLength(1);
    expect(s.overdue).toHaveLength(0);
  });

  it("gives an unscheduled job its own bucket rather than dropping it", () => {
    const s = groupIntoSections([job({ bookingId: "x" })], NOW);
    expect(s.unscheduled.map((j) => j.bookingId)).toEqual(["x"]);
    expect(s.today).toHaveLength(0);
  });

  it("groups upcoming work one entry per airport-local day", () => {
    const jobs = [
      job({ bookingId: "a", startsAt: new Date("2026-06-14T14:00:00Z") }),
      job({ bookingId: "b", startsAt: new Date("2026-06-14T18:00:00Z") }),
      // 00:30Z on the 15th is still the evening of the 14th in New York.
      job({ bookingId: "c", startsAt: new Date("2026-06-15T00:30:00Z") }),
      job({ bookingId: "d", startsAt: new Date("2026-06-15T14:00:00Z") }),
    ];
    const s = groupIntoSections(jobs, NOW);
    expect(s.upcoming.map((d) => d.key)).toEqual(["2026-06-14", "2026-06-15"]);
    expect(s.upcoming[0]!.jobs.map((j) => j.bookingId)).toEqual(["a", "b", "c"]);
  });

  it("hands the JOB's zone to the day helpers, never the device's", () => {
    const seen: string[] = [];
    const dayBounds = (instant: Date, tz: string) => {
      seen.push(tz);
      return airportLocalDayBounds(instant, tz);
    };
    groupIntoSections(
      [job({ startsAt: NOW, tz: "America/Los_Angeles" })],
      NOW,
      dayBounds,
    );
    expect(seen).toEqual(["America/Los_Angeles"]);
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
 * It writes a custody event and makes the customer's map go live, so every
 * "no" here is protecting something real.
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
    const job = groupJobs({
      verification: [verification({ status: "assigned" })],
      pickup: [pickup({ status: "assigned", driverShiftId: "shift-1" })],
    })[0]!;
    expect(startablePickupTaskId(job)).toBeNull();
  });

  it("refuses while the customer has not chosen a driver", () => {
    const job = groupJobs({
      verification: [verification({ status: "done" })],
      pickup: [pickup({ status: "assigned", driverShiftId: null })],
    })[0]!;
    expect(startablePickupTaskId(job)).toBeNull();
  });

  it("refuses once the leg is already under way", () => {
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
 * A CANCELLED BOOKING IS NOT WORK — and nothing in this module could tell
 * from the task rows alone, because cancelling leaves them untouched.
 */
describe("a cancelled booking in the driver's day", () => {
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
          ...pickup({ id: "pt-2", status: "assigned", driverShiftId: "s-1" }),
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
 * THREE PREDICATES, THREE QUESTIONS. `isDone` — did somebody DO this?
 * `isSettled` — is there anything left to do? `isOutstanding` — is this still
 * asking for something? Collapsing any two files a cancelled booking under
 * work performed or puts it back in the to-do count.
 */
describe("isDone / isSettled / isOutstanding", () => {
  it.each(["upcoming", "active", "problem"] as const)(
    "counts a %s stop as work",
    (state) => {
      expect(isOutstanding(job({ state }))).toBe(true);
      expect(isSettled(job({ state }))).toBe(false);
      expect(isDone(job({ state }))).toBe(false);
    },
  );

  it("does not count a done stop as work", () => {
    expect(isOutstanding(job({ state: "done" }))).toBe(false);
  });

  it("does not count a cancelled stop as work", () => {
    expect(isOutstanding(job({ state: "cancelled" }))).toBe(false);
  });

  it("calls a cancelled stop settled without calling it done", () => {
    expect(isSettled(job({ state: "cancelled" }))).toBe(true);
    expect(isDone(job({ state: "cancelled" }))).toBe(false);
  });

  it("calls a done stop both settled and done", () => {
    expect(isSettled(job({ state: "done" }))).toBe(true);
    expect(isDone(job({ state: "done" }))).toBe(true);
  });
});

describe("hasMissedCutoff", () => {
  const withCutoff = (bagDropCutoffAt: Date | null): Job =>
    job({ booking: { ...job().booking, bagDropCutoffAt } });

  it("is true once the cutoff has passed", () => {
    expect(hasMissedCutoff(withCutoff(new Date("2026-06-12T14:00:00Z")), NOW)).toBe(true);
  });

  it("is false while the cutoff is still ahead", () => {
    expect(hasMissedCutoff(withCutoff(new Date("2026-06-12T16:00:00Z")), NOW)).toBe(
      false,
    );
  });

  it("is false when the route has no cutoff on record", () => {
    expect(hasMissedCutoff(withCutoff(null), NOW)).toBe(false);
  });

  it("survives a booking context with no cutoff field at all", () => {
    const legacy = job({
      booking: {
        ...job().booking,
        bagDropCutoffAt: undefined,
      } as unknown as Job["booking"],
    });
    expect(() => hasMissedCutoff(legacy, NOW)).not.toThrow();
    expect(hasMissedCutoff(legacy, NOW)).toBe(false);
  });
});
