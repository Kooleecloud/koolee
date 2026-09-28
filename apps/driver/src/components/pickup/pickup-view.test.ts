import { describe, expect, it } from "vitest";
import { PICKUP_EXCEPTION_REASONS } from "@koolee/api-contract";

import {
  DEFAULT_PICKUP_EXCEPTION_REASON,
  isDelivered,
  PICKUP_EXCEPTION_OPTIONS,
  pickupViewFrom,
  scannedCount,
  type PickupViewSource,
} from "./pickup-view";

function source(overrides: Partial<PickupViewSource> = {}): PickupViewSource {
  return {
    task: { id: "task-1", status: "in_progress", startedAt: "2026-06-10T14:00:00.000Z" },
    booking: {
      paxName: "Ada Lovelace",
      ref: "KL-1234",
      status: "awaiting_pickup",
      departureAirport: "JFK",
    },
    bags: [
      { id: "bag-1", ordinal: 1, sealId: "SEAL-A" },
      { id: "bag-2", ordinal: 2, sealId: "SEAL-B" },
    ],
    scannedBagIds: ["bag-2"],
    shift: { truckName: "Van 3" },
    ...overrides,
  };
}

describe("pickupViewFrom", () => {
  it("mirrors the web page's derivation", () => {
    const view = pickupViewFrom(source());
    expect(view).toEqual({
      taskId: "task-1",
      paxName: "Ada Lovelace",
      bookingRef: "KL-1234",
      bookingStatus: "awaiting_pickup",
      departureAirport: "JFK",
      truckName: "Van 3",
      travelStarted: true,
      bags: [
        { id: "bag-1", ordinal: 1, sealId: "SEAL-A", scanned: false },
        { id: "bag-2", ordinal: 2, sealId: "SEAL-B", scanned: true },
      ],
      done: false,
      exception: false,
    });
    expect(scannedCount(view)).toBe(1);
  });

  it("has not set off until the task has a startedAt", () => {
    const view = pickupViewFrom(
      source({
        task: { id: "task-1", status: "assigned", startedAt: null },
        shift: null,
      }),
    );
    expect(view.travelStarted).toBe(false);
    expect(view.truckName).toBeNull();
  });

  it("is done only on a done task", () => {
    expect(
      pickupViewFrom(
        source({ task: { id: "t", status: "done", startedAt: "2026-06-10T14:00:00Z" } }),
      ).done,
    ).toBe(true);
    expect(pickupViewFrom(source()).done).toBe(false);
  });

  it("hands to ops on an exception booking OR a failed task", () => {
    expect(
      pickupViewFrom(source({ booking: { ...source().booking, status: "exception" } }))
        .exception,
    ).toBe(true);
    expect(
      pickupViewFrom(source({ task: { id: "t", status: "failed", startedAt: null } }))
        .exception,
    ).toBe(true);
    expect(pickupViewFrom(source()).exception).toBe(false);
  });
});

describe("isDelivered", () => {
  it("is true at the bag drop and after the airline has them", () => {
    expect(isDelivered({ bookingStatus: "delivered_to_bagdrop" })).toBe(true);
    expect(isDelivered({ bookingStatus: "completed" })).toBe(true);
    expect(isDelivered({ bookingStatus: "in_transit" })).toBe(false);
  });
});

describe("PICKUP_EXCEPTION_OPTIONS", () => {
  it("labels every contract reason, in the contract's order, defaulting to the first", () => {
    expect(PICKUP_EXCEPTION_OPTIONS.map((o) => o.value)).toEqual([
      ...PICKUP_EXCEPTION_REASONS,
    ]);
    expect(DEFAULT_PICKUP_EXCEPTION_REASON).toBe("seal_mismatch");
    for (const option of PICKUP_EXCEPTION_OPTIONS)
      expect(option.label.length).toBeGreaterThan(0);
  });
});
