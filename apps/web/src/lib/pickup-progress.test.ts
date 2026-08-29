import { describe, expect, it } from "vitest";

import { PICKUP_STEPS, pickupStepIndexFor } from "./pickup-progress";

describe("pickupStepIndexFor", () => {
  it("sits at the start while the bags are sealed and waiting", () => {
    expect(pickupStepIndexFor("verified_sealed", false)).toBe(0);
    // Staged but nobody has set off yet — still step 0.
    expect(pickupStepIndexFor("awaiting_pickup", false)).toBe(0);
  });

  it("advances only when the driver has actually set off", () => {
    expect(pickupStepIndexFor("awaiting_pickup", true)).toBe(1);
  });

  it("follows the bags once they are in the van", () => {
    expect(pickupStepIndexFor("in_transit", true)).toBe(3);
    expect(pickupStepIndexFor("delivered_to_bagdrop", true)).toBe(4);
    expect(pickupStepIndexFor("completed", true)).toBe(4);
  });

  // A cancelled or exception booking has no progress to claim; the track sits
  // at the start rather than implying the run is under way.
  it.each(["draft", "paid", "agent_assigned", "exception", "cancelled"] as const)(
    "claims no progress for %s",
    (status) => {
      expect(pickupStepIndexFor(status, true)).toBe(0);
    },
  );

  it("never returns an index past the end of the track", () => {
    const statuses = [
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
    ] as const;
    for (const status of statuses) {
      for (const started of [true, false]) {
        const index = pickupStepIndexFor(status, started);
        expect(index).toBeGreaterThanOrEqual(0);
        expect(index).toBeLessThan(PICKUP_STEPS.length);
      }
    }
  });
});
