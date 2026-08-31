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

  // A booking that has not reached sealing has no progress to claim; the
  // track sits at the start rather than implying the run is under way.
  //
  // `cancelled` used to be in this list and is not any more — it returns -1,
  // which is `ProgressTrack`'s "nothing is current" and, with the `cancelled`
  // prop, "nothing is going to be". See the block at the bottom of this file.
  it.each(["draft", "paid", "agent_assigned", "exception"] as const)(
    "claims no progress for %s",
    (status) => {
      expect(pickupStepIndexFor(status, true)).toBe(0);
    },
  );

  it("never returns an index past the end of the track", () => {
    // `cancelled` is excluded: it deliberately returns -1, which is
    // `ProgressTrack`'s "no stage is current" sentinel rather than a position
    // on the track. Its bound is asserted in its own block below.
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

/**
 * A CANCELLED BOOKING MUST NOT CLAIM A STAGE IS IN PROGRESS.
 *
 * `pickupStepIndexFor` used to fall through to the default and return 0,
 * which put `ProgressTrack`'s pulsing seal-orange "you are here" marker on
 * "Driver booked" — a booking that had been cancelled, animating as though
 * something were happening on it right now.
 *
 * `-1` is the value `ProgressTrack` has documented for this since it was
 * written; it was simply never passed one. The track still RENDERS: hiding it
 * would make a cancelled trip read as though it had never been booked, and
 * the stages are what show how far it got before it stopped.
 */
describe("a cancelled booking", () => {
  it("has no current stage", () => {
    expect(pickupStepIndexFor("cancelled", false)).toBe(-1);
    expect(pickupStepIndexFor("cancelled", true)).toBe(-1);
  });

  it("is below every stage index, so nothing reads as complete either", () => {
    // `stateFor` in ProgressTrack: index < currentIndex is "complete". With
    // -1 no index qualifies, so the whole track is untouched rather than
    // half-banked.
    expect(pickupStepIndexFor("cancelled", false)).toBeLessThan(0);
  });

  it("leaves an exception at the start, which is a different state", () => {
    // Paused, not abandoned. Changing this is deliberately not in scope.
    expect(pickupStepIndexFor("exception", false)).toBe(0);
  });
});
