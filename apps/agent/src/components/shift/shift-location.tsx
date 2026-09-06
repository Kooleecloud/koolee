import { getActiveShift, listAssignedTasks } from "@koolee/core";

import { tryGetCore } from "@/lib/core";
import { getAgentSession } from "@/lib/session";
import { GpsPinger, type GpsPingerPhase } from "./gps-pinger";

/**
 * Reports this driver's position for as long as their shift is open — from
 * every screen in the app.
 *
 * WHY IT IS IN THE LAYOUT. `GpsPinger` used to be mounted on the Today page
 * alone, so the moment a driver opened a task — which is the moment they are
 * most likely to be moving — reporting stopped. Nothing said so, and the
 * customer's map simply went quiet. Position is a fact about the person, not
 * about the screen they happen to be looking at, so it belongs to the shell.
 *
 * WHY IT RUNS FOR THE WHOLE SHIFT rather than only while a pickup is under
 * way. A customer choosing a driver is shown pins built from
 * `driver_positions`, and `listCandidateDrivers` drops any fix older than
 * `POSITION_FRESH_MS`. A driver clocked on and waiting for work reported
 * nothing, so there was nothing fresh to draw and the shortlist map never
 * rendered at all. TD's call: the map should be functional, so the position
 * has to exist.
 *
 * OFF THE CLOCK, NOTHING IS SENT. `phase` is null without an open shift and
 * the pinger does not touch `navigator.geolocation` — no permission prompt, no
 * request, nothing stored. Ending a shift is what stops it, which is a control
 * the driver already has and already understands.
 *
 * IT IS STILL FOREGROUND-ONLY. No service worker, no background sync: a phone
 * in a pocket with the screen off stops reporting, and the customer's page
 * degrades to "Position updating" rather than to a stale pin presented as
 * current. That is deliberate and unchanged.
 *
 * FAILING QUIETLY IS THE RULE HERE. This renders on every page in the app, so
 * a database blip must cost a moving pin and never a driver's screen — every
 * read below degrades to "no shift", which is the same as being off the clock.
 */
export async function ShiftLocation() {
  const session = await getAgentSession();
  if (!session) return null;

  const core = tryGetCore();
  if (!core) return null;

  const shift = await getActiveShift(core.db, session.userId).catch(() => null);
  if (!shift) return null;

  /*
   * WHICH LEG, read off the BOOKING rather than the task — the two are
   * cleanly separated by design. `startPickupTravel` moves the TASK to
   * `in_progress` and leaves the BOOKING at `awaiting_pickup`: the driver is
   * on their way to a doorstep where the bags still are, and somebody is very
   * plausibly watching a dot approach their house. `scanSealAtPickup` moves
   * the booking to `in_transit` once every seal is scanned — the bags are
   * aboard, and the question has changed.
   */
  const tasks = await listAssignedTasks(core.db, session.userId).catch(() => null);
  const running = (tasks?.pickup ?? []).filter(
    (row) => row.task.status === "in_progress",
  );

  const phase: GpsPingerPhase = running.some(
    (row) => row.booking.status === "awaiting_pickup",
  )
    ? "en_route"
    : running.length > 0
      ? "carrying"
      : "on_shift";

  return <GpsPinger phase={phase} />;
}
