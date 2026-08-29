import type { AssignedTasks, TaskBookingContext } from "@koolee/core";

/**
 * A "job" — one booking, and everything this agent has to do for it.
 *
 * The database has two task tables and the agent app used to render them as
 * two independent rows. On a phone that read as duplicate work: the same
 * customer, the same window, the same address, listed twice, three lines
 * apart. A driver does not experience "a verification task and a pickup
 * task", they experience one trip to one door with two things to do there.
 *
 * So the grouping happens here, in presentation, and the two task rows stay
 * exactly as they are underneath — which is what keeps this reversible if the
 * two halves are ever assigned to different people.
 */

export type JobPhaseKind = "verification" | "pickup";

export interface JobPhase {
  kind: JobPhaseKind;
  taskId: string;
  status: string;
  scheduledStart: Date | null;
  scheduledEnd: Date | null;
}

/** What each phase asks of the driver, in the driver's words. */
export const PHASE_LABEL: Record<JobPhaseKind, string> = {
  verification: "Verify & seal",
  pickup: "Collect & deliver",
};

export const PHASE_WHERE: Record<JobPhaseKind, string> = {
  verification: "at the door",
  pickup: "to the bag drop",
};

export type JobState = "problem" | "active" | "upcoming" | "done";

export interface Job {
  bookingId: string;
  booking: TaskBookingContext;
  /** The booking's airport zone. Every time this app renders uses it. */
  tz: string;
  /** Verification first, then pickup — the order they actually happen in. */
  phases: JobPhase[];
  /** Earliest scheduled start across the phases; how the day is ordered. */
  startsAt: Date | null;
  /** The phase to open. Null once nothing is left to do. */
  next: JobPhase | null;
  state: JobState;
}

const PHASE_ORDER: JobPhaseKind[] = ["verification", "pickup"];

/** Statuses that mean "this phase is finished, stop showing it as work". */
const SETTLED = new Set(["done", "failed", "cancelled"]);

export function groupJobs(tasks: AssignedTasks): Job[] {
  const byBooking = new Map<string, Job>();

  const add = (kind: JobPhaseKind, rows: AssignedTasks["verification" | "pickup"]) => {
    for (const { task, tz, booking } of rows) {
      const existing = byBooking.get(booking.id);
      const phase: JobPhase = {
        kind,
        taskId: task.id,
        status: task.status,
        scheduledStart: task.scheduledStart,
        scheduledEnd: task.scheduledEnd,
      };
      if (existing) {
        existing.phases.push(phase);
      } else {
        byBooking.set(booking.id, {
          bookingId: booking.id,
          booking,
          tz,
          phases: [phase],
          startsAt: null,
          next: null,
          state: "upcoming",
        });
      }
    }
  };

  add("verification", tasks.verification);
  add("pickup", tasks.pickup);

  const jobs = [...byBooking.values()];
  for (const job of jobs) {
    job.phases.sort((a, b) => PHASE_ORDER.indexOf(a.kind) - PHASE_ORDER.indexOf(b.kind));

    const starts = job.phases
      .map((p) => p.scheduledStart)
      .filter((d): d is Date => d !== null)
      .map((d) => d.getTime());
    job.startsAt = starts.length > 0 ? new Date(Math.min(...starts)) : null;

    // The next thing to do is the first phase that is not settled — which is
    // also the phase the card links to, so a tap always lands on work.
    job.next = job.phases.find((p) => !SETTLED.has(p.status)) ?? null;

    if (job.phases.some((p) => p.status === "failed")) job.state = "problem";
    else if (job.phases.every((p) => p.status === "done")) job.state = "done";
    else if (job.phases.some((p) => p.status === "in_progress")) job.state = "active";
    else job.state = "upcoming";
  }

  // Absolute instants, never rendered local times: with two airports in one
  // list a 9 AM Pacific stop would otherwise sort above a 10 AM Eastern one
  // that happens three hours earlier. Unscheduled sinks to the bottom.
  return jobs.sort(
    (a, b) => (a.startsAt?.getTime() ?? Infinity) - (b.startsAt?.getTime() ?? Infinity),
  );
}

/** The full address on one line, for display and for the maps query. */
export function addressText(booking: TaskBookingContext): string {
  return [
    booking.addressLine1,
    booking.addressCity,
    [booking.addressState, booking.addressZip].filter(Boolean).join(" "),
  ]
    .filter((part) => part && part.length > 0)
    .join(", ");
}

/**
 * A maps link that works on both platforms.
 *
 * Google's `api=1` search URL is the one form Android opens in the Maps app
 * and iOS opens in Google Maps if installed, Safari otherwise — a `maps://`
 * scheme would be Apple-only and a bare `geo:` Android-only. The place id is
 * passed whenever the customer picked their address from autocomplete: a
 * free-text query can land a driver at the wrong end of a long street, and a
 * place id cannot.
 */
export function mapsUrl(booking: TaskBookingContext): string {
  const query = encodeURIComponent(addressText(booking));
  const placeId = booking.addressPlaceId
    ? `&query_place_id=${encodeURIComponent(booking.addressPlaceId)}`
    : "";
  return `https://www.google.com/maps/search/?api=1&query=${query}${placeId}`;
}
