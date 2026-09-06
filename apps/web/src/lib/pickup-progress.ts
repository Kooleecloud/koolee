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
    case "cancelled":
      /*
       * NOTHING IS CURRENT, and nothing is going to be.
       *
       * This used to fall into the default below and return 0, which put the
       * pulsing seal-orange "you are here" marker on "Driver booked" — a
       * cancelled booking claiming a stage was in progress. `ProgressTrack`
       * has documented `-1` as the cancelled rendering since it was written;
       * it was simply never passed one.
       *
       * The track is still RENDERED. Hiding it would make a cancelled trip
       * read as though it had never been booked, and the stages are what let
       * a customer see how far it had got before it stopped.
       */
      return -1;
    default:
      // exception, and everything before sealing: the track is not the story,
      // so it sits at the start rather than claiming progress.
      //
      // (An exception arguably wants -1 too, by the same argument. It is a
      // different state with a different meaning — paused, not abandoned —
      // and changing it is not this slice's call.)
      return 0;
  }
}
