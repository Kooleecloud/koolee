import { describe, expect, it } from "vitest";

import { bookingActionability, type ActionabilitySubject } from "./actionability";

/**
 * The gate matrix, one test per row.
 *
 * These are claims about time, so they are proved against a fixed clock and
 * no database. `assertActionable` — the enforcement, the exception it raises
 * and the in-transit carve-out — is proved in
 * `actionability.integration.test.ts`, because those need real rows.
 *
 * The three anchors, all instants:
 *   window ends   09:00
 *   bag drop      12:00   (departure − 60)
 *   departure     13:00
 */
const WINDOW_END = new Date("2026-09-01T09:00:00Z");
const CUTOFF = new Date("2026-09-01T12:00:00Z");
const DEPARTURE = new Date("2026-09-01T13:00:00Z");

const AT = {
  early: new Date("2026-09-01T08:00:00Z"),
  late: new Date("2026-09-01T10:30:00Z"),
  missed: new Date("2026-09-01T12:30:00Z"),
  departed: new Date("2026-09-01T13:30:00Z"),
} as const;

function subject(over: Partial<ActionabilitySubject> = {}): ActionabilitySubject {
  return {
    status: "agent_assigned",
    pickupWindowEnd: WINDOW_END,
    departureAt: DEPARTURE,
    bagDropCutoffAt: CUTOFF,
    ...over,
  };
}

const ALL_ACTIONS = [
  "acceptAgreement",
  "uploadPassport",
  "selectDriver",
  "startVisit",
  "startPickup",
] as const;

function allowed(subjectOver: Partial<ActionabilitySubject>, now: Date): string[] {
  const state = bookingActionability(subject(subjectOver), now);
  return ALL_ACTIONS.filter((action) => state.can[action]);
}

/* ------------------------------------------------------------------ */
/* Terminal / hard statuses                                            */
/* ------------------------------------------------------------------ */

describe("terminal standing", () => {
  it("cancelled — view only, whatever the clock says", () => {
    const state = bookingActionability(subject({ status: "cancelled" }), AT.early);
    expect(state.standing).toBe("terminal");
    expect(allowed({ status: "cancelled" }, AT.early)).toEqual([]);
    expect(state.blockedReason).toBe("This booking was cancelled.");
    // Nothing to escalate: a cancelled booking is already resolved.
    expect(state.raisesException).toBe(false);
  });

  it("completed — view and history only", () => {
    const state = bookingActionability(subject({ status: "completed" }), AT.early);
    expect(state.standing).toBe("terminal");
    expect(allowed({ status: "completed" }, AT.early)).toEqual([]);
    expect(state.blockedReason).toContain("support");
    expect(state.raisesException).toBe(false);
  });

  it("delivered_to_bagdrop — the airline has them; no forward action here", () => {
    // The driver's own `complete` confirmation is NOT one of the five actions
    // this object gates, so it stays available. That is the whole reason the
    // gate is five named actions rather than a single boolean.
    const state = bookingActionability(
      subject({ status: "delivered_to_bagdrop" }),
      AT.missed,
    );
    expect(state.standing).toBe("handed_over");
    expect(allowed({ status: "delivered_to_bagdrop" }, AT.missed)).toEqual([]);
    expect(state.raisesException).toBe(false);
  });

  it("exception — ops owns it, and the gate never re-raises", () => {
    const state = bookingActionability(subject({ status: "exception" }), AT.departed);
    expect(state.standing).toBe("exception");
    expect(allowed({ status: "exception" }, AT.departed)).toEqual([]);
    // Re-raising an exception on an exception is how a resolution loop starts.
    expect(state.raisesException).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Time-based, on an active booking                                    */
/* ------------------------------------------------------------------ */

describe("before the pickup window ends", () => {
  it("everything is available", () => {
    const state = bookingActionability(subject(), AT.early);
    expect(state.phase).toBe("before_window_end");
    expect(allowed({}, AT.early)).toEqual([...ALL_ACTIONS]);
    expect(state.blockedReason).toBeNull();
    expect(state.lateNotice).toBeNull();
  });
});

describe("after the pickup window, before the airline cutoff — late but savable", () => {
  it("keeps every action AND says it is running late", () => {
    const state = bookingActionability(subject(), AT.late);
    expect(state.phase).toBe("running_late");
    // The two customer actions are the ones that unblock a late visit;
    // blocking them here would refuse the rescue.
    expect(allowed({}, AT.late)).toEqual([...ALL_ACTIONS]);
    expect(state.blockedReason).toBeNull();
    expect(state.lateNotice).toContain("running late");
    expect(state.raisesException).toBe(false);
  });

  it("is where every active pre-custody status sits, not just one", () => {
    for (const status of [
      "paid",
      "agent_assigned",
      "verified_sealed",
      "awaiting_pickup",
    ] as const) {
      expect(bookingActionability(subject({ status }), AT.late).phase).toBe(
        "running_late",
      );
      expect(allowed({ status }, AT.late)).toEqual([...ALL_ACTIONS]);
    }
  });
});

describe("after the airline cutoff — missed", () => {
  it("blocks every forward action and escalates", () => {
    const state = bookingActionability(subject(), AT.missed);
    expect(state.phase).toBe("missed_cutoff");
    expect(allowed({}, AT.missed)).toEqual([]);
    expect(state.blockedReason).toContain("bag drop");
    expect(state.raisesException).toBe(true);
  });

  it("does not apply once the bags are already at the bag drop", () => {
    const state = bookingActionability(
      subject({ status: "delivered_to_bagdrop" }),
      AT.missed,
    );
    expect(state.standing).toBe("handed_over");
    expect(state.raisesException).toBe(false);
  });
});

describe("after scheduled departure", () => {
  it("blocks everything, and the wording says the flight has gone", () => {
    const state = bookingActionability(subject(), AT.departed);
    expect(state.phase).toBe("departed");
    expect(allowed({}, AT.departed)).toEqual([]);
    expect(state.blockedReason).toContain("departed");
    expect(state.raisesException).toBe(true);
  });

  it("wins over the cutoff phase even with no cutoff on record", () => {
    const state = bookingActionability(subject({ bagDropCutoffAt: null }), AT.departed);
    expect(state.phase).toBe("departed");
    expect(state.raisesException).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* The carve-out, and the two missing-data cases                       */
/* ------------------------------------------------------------------ */

describe("in transit", () => {
  it("gates none of the driver's remaining work, and never escalates", () => {
    const state = bookingActionability(subject({ status: "in_transit" }), AT.missed);
    expect(state.standing).toBe("in_transit");
    // The five actions here all belong to the phase before custody
    // transfers; scanning seals, delivering and confirming handover call
    // none of them, so a van already moving keeps moving.
    expect(allowed({ status: "in_transit" }, AT.missed)).toEqual([]);
    expect(state.raisesException).toBe(false);
    expect(state.lateNotice).toContain("driver");
  });
});

describe("missing anchors", () => {
  it("has no missed_cutoff phase at all when no cutoff is on record", () => {
    // Refusing early costs the customer their pickup, which is the opposite
    // trade from moving a DEADLINE early. Departure still catches the real
    // failure — see the comment in `phaseOf`.
    const state = bookingActionability(subject({ bagDropCutoffAt: null }), AT.missed);
    expect(state.phase).toBe("running_late");
    expect(allowed({ bagDropCutoffAt: null }, AT.missed)).toEqual([...ALL_ACTIONS]);
  });

  it("skips running_late when the booking carries no pickup window", () => {
    const state = bookingActionability(subject({ pickupWindowEnd: null }), AT.late);
    expect(state.phase).toBe("before_window_end");
    expect(allowed({ pickupWindowEnd: null }, AT.late)).toEqual([...ALL_ACTIONS]);
  });

  it("still blocks a window-less booking once the cutoff passes", () => {
    expect(allowed({ pickupWindowEnd: null }, AT.missed)).toEqual([]);
  });
});

describe("boundaries are inclusive of the deadline itself", () => {
  it("is running late exactly at the window end", () => {
    expect(bookingActionability(subject(), WINDOW_END).phase).toBe("running_late");
  });

  it("is missed exactly at the cutoff", () => {
    expect(bookingActionability(subject(), CUTOFF).phase).toBe("missed_cutoff");
  });

  it("is departed exactly at departure", () => {
    expect(bookingActionability(subject(), DEPARTURE).phase).toBe("departed");
  });
});
