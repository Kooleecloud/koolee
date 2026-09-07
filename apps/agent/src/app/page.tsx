import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, CalendarDays } from "lucide-react";
import { Button, Card, DatabaseNotConfigured, EmptyState } from "@koolee/ui";
import {
  airportLocalDay,
  airportLocalDayBounds,
  formatTimeInAirportTz,
  getActiveShift,
  listAssignedTasks,
  listTruckOptions,
} from "@koolee/core";

import { JobCard } from "@/components/job/job-card";
import { JourneyList } from "@/components/job/journey-list";
import { LiveTasks } from "@/components/live-tasks";
import { AgentMain } from "@/components/shell/agent-main";
import {
  ShiftBar,
  type ActiveShiftView,
  type TruckOptionView,
} from "@/components/shift/shift-bar";
import {
  groupIntoSections,
  groupJobs,
  isDone,
  startablePickupTaskId,
  type Job,
} from "@/lib/job";
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

  const now = new Date();
  /*
   * ONE BUCKETING FUNCTION, SHARED WITH THE SCHEDULE.
   *
   * This screen used to filter the day itself — its own `todays`, its own
   * `overdue`, its own definition of what counts as work — and the Schedule
   * tab used `groupIntoSections`. Two implementations of "today" is how the
   * home screen came to exclude cancelled stops from its counts while the
   * Schedule tab's "To do · N" went on counting them: the same booking, two
   * screens, two answers. They cannot disagree now because there is one
   * answer, and `groupIntoSections` is where it lives.
   *
   * "Today" is today AT THE AIRPORT, per job — a UTC server would otherwise
   * start an Eastern driver's day at 8 PM the previous evening.
   */
  const sections = groupIntoSections(jobs, now, airportLocalDayBounds, airportLocalDay);

  /*
   * THE ROUTE IS TODAY'S WORK. Late stops are no longer folded into it.
   *
   * They used to lead the rail, on the reasoning that a stop you are behind
   * on outranks one you are not. TD's call reverses that, and the reason is
   * what a driver opens this screen FOR: the next thing to do. A stop from
   * three days ago sorted to the top of the route pushed today's first job
   * below it, and the two most common cases for a stale late stop — it was
   * cancelled, or its flight has long gone — are now handled before this
   * point, by `isSettled` and `hasMissedCutoff` respectively. What is left in
   * `overdue` is genuinely late, genuinely doable work, and it gets its own
   * section under the route rather than in front of it.
   */
  const route = sections.today;
  const runningLate = sections.overdue;
  const unscheduled = sections.unscheduled;
  /*
   * A failed phase, or a stop whose bag-drop cutoff has passed. Leads the
   * screen because neither is something a driver can simply go and do.
   */
  const needsAttention = sections.problems;

  // Today's finished work, for the "N finished today" footer. Not in
  // `sections` — that function is about what is LEFT, and skips everything
  // settled — so the day filter is done once, here.
  const finished = jobs.filter((job) => {
    if (!isDone(job) || !job.startsAt) return false;
    const { start, end } = airportLocalDayBounds(now, job.tz);
    return job.startsAt >= start && job.startsAt < end;
  });

  // The subtitle counts everything a driver still has to do, scheduled or
  // not. Counting only the scheduled ones printed "Nothing scheduled" above a
  // card that plainly had work in it. Cancelled stops are not in any of these
  // arrays any more, so nothing has to be subtracted back out.
  const left =
    needsAttention.length + route.length + runningLate.length + unscheduled.length;
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
      <LiveTasks
        bookingIds={jobs.map((job) => job.bookingId)}
        stage={`jobs:${jobs.length}`}
      />
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-3xl font-semibold text-navy-800">Today</h1>
        <p className="text-sm text-muted-foreground">{summary}</p>
      </header>

      {/*
        ONLY THE OFF-SHIFT HALF LIVES HERE NOW. Clocking on needs a truck
        picker and the location gate, and it is the whole point of this screen
        when nobody is working — it stays big and stays put. The ON-shift
        state moved to the header pill, where it is visible from every screen
        instead of just this one, with its metadata and End shift behind a tap.
        `ShiftBar` renders nothing when a shift is already open.
      */}
      {identity.canDrive && !unavailable ? (
        <ShiftBar active={activeShift} trucks={trucks} />
      ) : null}

      {unavailable ? (
        <DatabaseNotConfigured />
      ) : (
        <>
          {/*
            LEADS THE SCREEN. A failed visit, or a stop whose bag-drop cutoff
            has passed: neither can be fixed by driving anywhere, and both
            need somebody told. Above the route because a driver working down
            their stops would otherwise reach these last, which is the wrong
            order for the only items on the page that are already going wrong.
          */}
          {needsAttention.length > 0 && (
            <JobSection
              title={`Needs attention · ${needsAttention.length}`}
              jobs={needsAttention}
            />
          )}

          {/*
            ONE RAIL, NOT TWO SECTIONS. "Up next" and "Later today" were two
            headings over identical cards, which said nothing about the thing
            a driver most needs — that these stops happen in an order, and
            which one they are on. See `JourneyList`.
          */}
          {route.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                Your route · {route.length} {route.length === 1 ? "stop" : "stops"}
              </h2>
              {/*
                No `lateIds` any more: nothing in the route is late. A stop
                that is late is in `runningLate` below, under a heading that
                says so — which is a clearer statement than a badge on a card
                sitting in a list of on-time work.
              */}
              <JourneyList stops={route} lateIds={new Set<string>()} />
            </section>
          )}

          {/*
            Kept OUT of the rail. A stop with no window has no place in a
            sequence ordered by time, and slotting it in would put a made-up
            position on the one job whose position is genuinely unknown.
          */}
          {unscheduled.length > 0 && (
            <JobSection title="No time set" jobs={unscheduled} />
          )}

          {/*
            UNDER THE ROUTE, NOT OVER IT — TD's call, and the same ordering the
            Schedule tab uses. These are real work and must stay visible (the
            bug that put them on this screen at all was a driver opening to
            "Nothing assigned for today" with four stops they were behind on).
            But they are not what the screen is for, and a stop from Tuesday
            standing in front of this morning's first job is a home screen
            answering a question nobody asked.
          */}
          {runningLate.length > 0 && (
            <JobSection
              title={`Running late · ${runningLate.length}`}
              jobs={runningLate}
            />
          )}

          {left === 0 && (
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

          {finished.length > 0 && left > 0 && (
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

/**
 * A headed list of stops that is NOT the route.
 *
 * Three sections on this page have the same shape — needs attention, no time
 * set, running late — and none of them is an ordered sequence, which is the
 * one thing `JourneyList` exists to draw. Sharing a component keeps them
 * visually identical to each other and visibly different from the route,
 * which is the distinction a driver is actually reading for.
 */
function JobSection({ title, jobs }: { title: string; jobs: readonly Job[] }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
        {title}
      </h2>
      <ul className="flex flex-col gap-3">
        {jobs.map((job) => (
          <li key={job.bookingId}>
            <JobCard job={job} startsPickupTaskId={startablePickupTaskId(job)} />
          </li>
        ))}
      </ul>
    </section>
  );
}
