import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, CalendarDays } from "lucide-react";
import { Button, Card, DatabaseNotConfigured, EmptyState } from "@koolee/ui";
import {
  airportLocalDayBounds,
  formatTimeInAirportTz,
  getActiveShift,
  listAssignedTasks,
  listTruckOptions,
} from "@koolee/core";

import { JobCard } from "@/components/job/job-card";
import { LiveTasks } from "@/components/live-tasks";
import { AgentMain } from "@/components/shell/agent-main";
import { GpsPinger } from "@/components/shift/gps-pinger";
import {
  ShiftBar,
  type ActiveShiftView,
  type TruckOptionView,
} from "@/components/shift/shift-bar";
import { groupJobs, type Job } from "@/lib/job";
import { tryGetCore } from "@/lib/core";
import { getAgentIdentity } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Today — the only screen a driver should need mid-shift.
 *
 * The previous version of this page showed a status chip, the word
 * "Unscheduled", and then a dev-only environment panel that filled the rest
 * of the phone. It did not say who, where, or when.
 *
 * What replaces it is one question in order: what am I doing right now, and
 * what is after it. The current job is rendered large with Navigate and Call
 * attached, because at the moment a driver looks at this screen they are
 * either driving to a door or standing at one.
 */
export default async function AgentHomePage() {
  const identity = await getAgentIdentity();
  if (!identity) redirect("/login");
  const { session } = identity;

  const core = tryGetCore();
  let jobs: Job[] = [];
  let unavailable = core === null;
  let activeShift: ActiveShiftView | null = null;
  let trucks: TruckOptionView[] = [];

  if (core) {
    try {
      jobs = groupJobs(await listAssignedTasks(core.db, session.userId));
    } catch {
      unavailable = true;
    }
  }

  // The shift block is only ever fetched for staff cleared to drive, so an
  // agent who never drives pays nothing for it.
  if (core && identity.canDrive && !unavailable) {
    try {
      const [shift, truckRows] = await Promise.all([
        getActiveShift(core.db, session.userId),
        listTruckOptions(core.db),
      ]);
      trucks = truckRows.map((truck) => ({
        id: truck.id,
        name: truck.name,
        bagCapacity: truck.bagCapacity,
        unavailable: truck.heldByUserId !== null && truck.heldByUserId !== session.userId,
      }));
      if (shift) {
        // The shift's own start renders in the zone of the work, like every
        // other time in this app — the driver's phone zone is never used.
        const tz = jobs[0]?.tz ?? "America/New_York";
        activeShift = {
          truckName: shift.truck.name,
          bagCapacity: shift.truck.bagCapacity,
          bagsOnBoard: shift.bagsOnBoard,
          startedAtLabel: formatTimeInAirportTz(shift.shift.startedAt, tz),
        };
      }
    } catch {
      // A shift block that cannot load must not take the day's work with it.
      activeShift = null;
      trucks = [];
    }
  }

  // Pings run while a pickup is genuinely under way. `in_progress` on a pickup
  // phase means exactly that: `startPickupTravel` sets it, and
  // `confirmAirlineHandover` closes it.
  const pickupUnderWay =
    activeShift !== null &&
    jobs.some((job) =>
      job.phases.some((phase) => phase.kind === "pickup" && phase.status === "in_progress"),
    );

  const now = new Date();
  // "Today" is today AT THE AIRPORT, per job. A UTC server would otherwise
  // start an Eastern driver's day at 8 PM the previous evening.
  const todays = jobs.filter((job) => {
    if (!job.startsAt) return false;
    const { start, end } = airportLocalDayBounds(now, job.tz);
    return job.startsAt >= start && job.startsAt < end;
  });

  const outstanding = todays.filter((job) => job.state !== "done");
  const [current, ...rest] = outstanding;
  const finished = todays.filter((job) => job.state === "done");

  // Work with no window on it still has to surface somewhere, or it is simply
  // never done. It belongs with today rather than buried at the end of a list
  // sorted by a time it does not have.
  const unscheduled = jobs.filter((job) => !job.startsAt && job.state !== "done");

  // The subtitle counts everything a driver still has to do, scheduled or
  // not. Counting only the scheduled ones printed "Nothing scheduled" above a
  // card that plainly had work in it.
  const left = outstanding.length + unscheduled.length;
  const summary = unavailable
    ? "Can't reach the server."
    : left === 0
      ? finished.length > 0
        ? `All ${finished.length} done. Nice.`
        : "Nothing assigned for today."
      : `${left} to do${finished.length > 0 ? ` · ${finished.length} done` : ""}`;

  return (
    <AgentMain>
      {/* A task assigned mid-shift appears here without a pull-to-refresh. */}
      <LiveTasks bookingIds={jobs.map((job) => job.bookingId)} stage={`jobs:${jobs.length}`} />
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-3xl font-semibold text-navy-800">Today</h1>
        <p className="text-sm text-muted-foreground">{summary}</p>
      </header>

      {identity.canDrive && !unavailable ? (
        <>
          <ShiftBar active={activeShift} trucks={trucks} />
          <GpsPinger active={pickupUnderWay} />
        </>
      ) : null}

      {unavailable ? (
        <DatabaseNotConfigured />
      ) : (
        <>
          {current ? (
            <section className="flex flex-col gap-2">
              <h2 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                Up next
              </h2>
              <JobCard job={current} emphasis />
            </section>
          ) : null}

          {rest.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                Later today
              </h2>
              <ul className="flex flex-col gap-3">
                {rest.map((job) => (
                  <li key={job.bookingId}>
                    <JobCard job={job} />
                  </li>
                ))}
              </ul>
            </section>
          )}

          {unscheduled.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                No time set
              </h2>
              <ul className="flex flex-col gap-3">
                {unscheduled.map((job) => (
                  <li key={job.bookingId}>
                    <JobCard job={job} />
                  </li>
                ))}
              </ul>
            </section>
          )}

          {outstanding.length === 0 && unscheduled.length === 0 && (
            <EmptyState
              title={finished.length > 0 ? "Today is done" : "Nothing today"}
              description={
                finished.length > 0
                  ? "Every stop on today's list is finished."
                  : "When ops assigns you a pickup it shows up here."
              }
              action={
                <Button asChild variant="outline">
                  <Link href="/tasks">
                    <CalendarDays aria-hidden="true" />
                    See the schedule
                  </Link>
                </Button>
              }
            />
          )}

          {finished.length > 0 && outstanding.length > 0 && (
            <Card asChild>
              <Link
                href="/tasks"
                className="flex items-center justify-between gap-3 p-4 text-sm"
              >
                <span className="text-muted-foreground">
                  {finished.length} finished today
                </span>
                <span className="inline-flex items-center gap-1 font-medium text-navy-800">
                  Schedule
                  <ArrowRight aria-hidden="true" className="size-4" />
                </span>
              </Link>
            </Card>
          )}
        </>
      )}
    </AgentMain>
  );
}
