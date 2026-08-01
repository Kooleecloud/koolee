import { describe, expect, it } from "vitest";
import type { BookingStatus } from "@koolee/db";

import {
  availableEvents,
  canTransition,
  EVENT_TYPES,
  IllegalTransitionError,
  isTerminal,
  nextStatus,
  TERMINAL_STATUSES,
  TRANSITIONS,
  transition,
  transitionOrThrow,
  type BookingEvent,
} from "./state-machine";

const ALL_STATUSES = Object.keys(TRANSITIONS) as BookingStatus[];
const ALL_EVENTS = Object.keys(EVENT_TYPES) as BookingEvent[];

const booking = (status: BookingStatus) => ({ id: "b-1", status });

describe("transition table shape", () => {
  it("covers every booking status", () => {
    expect(ALL_STATUSES).toHaveLength(10);
    expect(ALL_STATUSES).toEqual(
      expect.arrayContaining([
        "draft",
        "paid",
        "agent_assigned",
        "verified_sealed",
        "awaiting_pickup",
        "in_transit",
        "delivered_to_bagdrop",
        "completed",
        "exception",
        "cancelled",
      ]),
    );
  });

  it("gives every event a custody event type", () => {
    for (const event of ALL_EVENTS) {
      expect(EVENT_TYPES[event]).toMatch(/^booking\./);
    }
  });

  it("only ever targets a real status", () => {
    for (const from of ALL_STATUSES) {
      for (const to of Object.values(TRANSITIONS[from])) {
        expect(ALL_STATUSES).toContain(to);
      }
    }
  });

  it("never lets a status transition to itself", () => {
    for (const from of ALL_STATUSES) {
      for (const to of Object.values(TRANSITIONS[from])) {
        expect(to).not.toBe(from);
      }
    }
  });
});

describe("the full status × event matrix", () => {
  /**
   * Every legal move, written out by hand. This duplicates TRANSITIONS on
   * purpose: if someone edits the table, this list must be edited too, and the
   * change becomes visible in review rather than silently accepted.
   */
  const LEGAL: Array<[BookingStatus, BookingEvent, BookingStatus]> = [
    ["draft", "authorize_payment", "paid"],
    ["draft", "cancel", "cancelled"],
    ["draft", "raise_exception", "exception"],

    ["paid", "assign_agent", "agent_assigned"],
    ["paid", "cancel", "cancelled"],
    ["paid", "raise_exception", "exception"],

    ["agent_assigned", "complete_verification", "verified_sealed"],
    ["agent_assigned", "cancel", "cancelled"],
    ["agent_assigned", "raise_exception", "exception"],

    ["verified_sealed", "mark_awaiting_pickup", "awaiting_pickup"],
    ["verified_sealed", "cancel", "cancelled"],
    ["verified_sealed", "raise_exception", "exception"],

    ["awaiting_pickup", "start_transit", "in_transit"],
    ["awaiting_pickup", "cancel", "cancelled"],
    ["awaiting_pickup", "raise_exception", "exception"],

    ["in_transit", "deliver_to_bagdrop", "delivered_to_bagdrop"],
    ["in_transit", "raise_exception", "exception"],

    ["delivered_to_bagdrop", "complete", "completed"],
    ["delivered_to_bagdrop", "raise_exception", "exception"],

    ["exception", "resume_transit", "in_transit"],
    ["exception", "force_complete", "completed"],
    ["exception", "cancel", "cancelled"],
  ];

  const legalKeys = new Set(LEGAL.map(([from, event]) => `${from}:${event}`));

  it.each(LEGAL)("%s --%s--> %s", (from, event, expected) => {
    const result = transition(booking(from), { event });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.from).toBe(from);
    expect(result.value.to).toBe(expected);
    expect(result.value.event).toBe(event);
    expect(nextStatus(from, event)).toBe(expected);
    expect(canTransition(from, event)).toBe(true);
  });

  it("rejects every combination not in the legal list", () => {
    let rejected = 0;

    for (const from of ALL_STATUSES) {
      for (const event of ALL_EVENTS) {
        if (legalKeys.has(`${from}:${event}`)) continue;

        rejected += 1;
        const result = transition(booking(from), { event });
        expect(result.ok, `${from} --${event}--> should be illegal`).toBe(false);
        if (result.ok) continue;

        expect(result.error).toBeInstanceOf(IllegalTransitionError);
        expect(result.error.code).toBe("ILLEGAL_TRANSITION");
        expect(result.error.from).toBe(from);
        expect(result.error.event).toBe(event);
        expect(canTransition(from, event)).toBe(false);
        expect(nextStatus(from, event)).toBeNull();
      }
    }

    // 10 statuses x 11 events = 110 combinations, 22 of which are legal.
    expect(rejected).toBe(ALL_STATUSES.length * ALL_EVENTS.length - LEGAL.length);
    expect(rejected).toBe(88);
  });
});

describe("terminal statuses", () => {
  it.each(TERMINAL_STATUSES)("%s accepts no events", (status) => {
    expect(isTerminal(status)).toBe(true);
    expect(availableEvents(status)).toEqual([]);

    for (const event of ALL_EVENTS) {
      expect(transition(booking(status), { event }).ok).toBe(false);
    }
  });

  it("treats every non-terminal status as non-terminal", () => {
    const nonTerminal = ALL_STATUSES.filter(
      (s) => !(TERMINAL_STATUSES as readonly BookingStatus[]).includes(s),
    );
    expect(nonTerminal).toHaveLength(8);
    for (const status of nonTerminal) {
      expect(isTerminal(status)).toBe(false);
      expect(availableEvents(status).length).toBeGreaterThan(0);
    }
  });
});

describe("cancellation boundary", () => {
  /**
   * The rule that matters operationally: once a driver physically has the
   * bags, "cancel" stops being a possible outcome. Any problem from that point
   * is an exception a human has to resolve.
   */
  const CANCELLABLE: BookingStatus[] = [
    "draft",
    "paid",
    "agent_assigned",
    "verified_sealed",
    "awaiting_pickup",
    "exception",
  ];
  const NOT_CANCELLABLE: BookingStatus[] = [
    "in_transit",
    "delivered_to_bagdrop",
    "completed",
    "cancelled",
  ];

  it.each(CANCELLABLE)("%s can be cancelled", (status) => {
    expect(canTransition(status, "cancel")).toBe(true);
  });

  it.each(NOT_CANCELLABLE)("%s cannot be cancelled", (status) => {
    expect(canTransition(status, "cancel")).toBe(false);
  });
});

describe("custody event emission", () => {
  it("emits a draft on every successful transition", () => {
    for (const from of ALL_STATUSES) {
      for (const event of availableEvents(from)) {
        const result = transition(booking(from), { event });
        expect(result.ok).toBe(true);
        if (!result.ok) continue;

        const draft = result.value.custodyEvent;
        expect(draft.bookingId).toBe("b-1");
        expect(draft.eventType).toBe(EVENT_TYPES[event]);
        expect(draft.metadata).toMatchObject({ from, to: result.value.to, event });
      }
    }
  });

  it("carries actor, location, photo and metadata through", () => {
    const result = transition(booking("agent_assigned"), {
      event: "complete_verification",
      actor: { userId: "u-9", role: "agent" },
      bagId: "bag-3",
      lat: 40.7128,
      lng: -74.006,
      photoUrl: "https://example.test/seal.jpg",
      metadata: { sealId: "SEAL-abc", weightKg: 18.4 },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.custodyEvent).toEqual({
      bookingId: "b-1",
      bagId: "bag-3",
      actorUserId: "u-9",
      actorRole: "agent",
      eventType: "booking.verified_sealed",
      lat: 40.7128,
      lng: -74.006,
      photoUrl: "https://example.test/seal.jpg",
      metadata: {
        from: "agent_assigned",
        to: "verified_sealed",
        event: "complete_verification",
        sealId: "SEAL-abc",
        weightKg: 18.4,
      },
    });
  });

  it("nulls actor fields for system-driven transitions", () => {
    const result = transition(booking("draft"), { event: "authorize_payment" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.custodyEvent.actorUserId).toBeNull();
    expect(result.value.custodyEvent.actorRole).toBeNull();
  });

  it("does not let caller metadata overwrite the from/to record", () => {
    const result = transition(booking("draft"), {
      event: "authorize_payment",
      metadata: { note: "webhook replay" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.custodyEvent.metadata).toMatchObject({
      from: "draft",
      to: "paid",
      note: "webhook replay",
    });
  });
});

describe("the happy path end to end", () => {
  it("walks draft → completed", () => {
    const path: BookingEvent[] = [
      "authorize_payment",
      "assign_agent",
      "complete_verification",
      "mark_awaiting_pickup",
      "start_transit",
      "deliver_to_bagdrop",
      "complete",
    ];

    let status: BookingStatus = "draft";
    const seen: BookingStatus[] = [status];

    for (const event of path) {
      const result = transition({ id: "b-1", status }, { event });
      expect(result.ok, `${status} --${event}-->`).toBe(true);
      if (!result.ok) return;
      status = result.value.to;
      seen.push(status);
    }

    expect(seen).toEqual([
      "draft",
      "paid",
      "agent_assigned",
      "verified_sealed",
      "awaiting_pickup",
      "in_transit",
      "delivered_to_bagdrop",
      "completed",
    ]);
    expect(isTerminal(status)).toBe(true);
  });

  it("recovers from an exception mid-transit", () => {
    const raised = transitionOrThrow(booking("in_transit"), {
      event: "raise_exception",
      metadata: { reason: "vehicle breakdown" },
    });
    expect(raised.to).toBe("exception");

    const resumed = transitionOrThrow(booking("exception"), { event: "resume_transit" });
    expect(resumed.to).toBe("in_transit");
  });
});

describe("transitionOrThrow", () => {
  it("returns the success value when legal", () => {
    expect(transitionOrThrow(booking("draft"), { event: "authorize_payment" }).to).toBe(
      "paid",
    );
  });

  it("throws a typed error when illegal", () => {
    expect(() => transitionOrThrow(booking("completed"), { event: "cancel" })).toThrow(
      IllegalTransitionError,
    );
  });

  it("names the legal alternatives in the error message", () => {
    try {
      transitionOrThrow(booking("paid"), { event: "complete" });
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(IllegalTransitionError);
      const message = (error as IllegalTransitionError).message;
      expect(message).toContain("assign_agent");
      expect(message).toContain("cancel");
    }
  });

  it("says so explicitly when the status is terminal", () => {
    try {
      transitionOrThrow(booking("cancelled"), { event: "authorize_payment" });
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as IllegalTransitionError).message).toContain("terminal");
    }
  });
});
