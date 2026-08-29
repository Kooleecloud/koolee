import type { Booking } from "@koolee/core";

/**
 * The customer-facing progression for a pickup run.
 *
 * Deliberately NOT the internal vocabulary. `assigned` / `in_progress` /
 * `done` describe our queue; these describe where somebody's suitcases are,
 * which is the only thing the person reading the page cares about.
 */
export const PICKUP_STEPS = [
  "Driver booked",
  "On the way",
  "Bags collected",
  "In transit",
  "At the bag drop",
] as const;

/**
 * Where the bags are, as an index into `PICKUP_STEPS`.
 *
 * Derived from the BOOKING status, not the task status. The task is
 * `in_progress` from the moment the driver sets off right through to the
 * airline counter — one value covering three things the customer sees as
 * different — while the booking status moves with the bags.
 *
 * The one thing the task DOES decide is step 1: `awaiting_pickup` means
 * "sealed and staged", and it is `started_at` that separates a driver who has
 * set off from one who has not.
 *
 * "Bags collected" (index 2) is never returned. It is the instant between the
 * last seal scan and `start_transit`, which happen in the same call — the step
 * is rendered because a customer counting the stages expects to see it, and it
 * is passed the moment it is reached.
 */
export function pickupStepIndexFor(
  status: Booking["status"],
  travelStarted: boolean,
): number {
  switch (status) {
    case "verified_sealed":
      return 0;
    case "awaiting_pickup":
      return travelStarted ? 1 : 0;
    case "in_transit":
      return 3;
    case "delivered_to_bagdrop":
    case "completed":
      return 4;
    default:
      // exception, cancelled, and everything before sealing: the track is not
      // the story, so it sits at the start rather than claiming progress.
      return 0;
  }
}
