import Link from "next/link";
import { redirect } from "next/navigation";
import { DatabaseNotConfigured, EmptyState, SegmentedControl, cn } from "@koolee/ui";
import {
  airportLocalDay,
  airportLocalDayBounds,
  formatDayInAirportTz,
  listAssignedTasks,
} from "@koolee/core";

import { JobCard } from "@/components/job/job-card";
import { LiveTasks } from "@/components/live-tasks";
import { AgentMain } from "@/components/shell/agent-main";
import { groupIntoSections, groupJobs, settledJobs, type Job } from "@/lib/job";
import { tryGetCore } from "@/lib/core";
import { getAgentSession } from "@/lib/session";

export const metadata = { title: "Schedule" };
export const dynamic = "force-dynamic";

/**
 * The schedule, and its History twin.
 *
 * TWO VIEWS ON ONE ROUTE, not a fourth bottom tab. The tab bar is capped at
 * three by an explicit decision (see `shell/nav.ts`: a driver has exactly
 * three questions, and the bottom third of a phone is the only part a thumb
 * reaches without regripping). History is not a fourth question — it is the
 * past tense of "what is coming" — so it lives as a segmented control at the
 * top of this page and the Schedule tab stays lit for both.
 *
 * SCHEDULE IS ORDERED BY ATTENTION, not by time alone: problems, then
 * overdue, then today, then a group per upcoming day. `groupIntoSections`
 * owns that and is unit-tested; every day boundary is AIRPORT-local, because
 * production runs in UTC and a server-local "today" opens at 8 PM the evening
 * before.
 *
 * FINISHED WORK IS NOT ON THE SCHEDULE. It used to sit at the bottom behind a
 * "12 finished" disclosure, which is still occupying the answer to "what is
 * left". It is one tap away instead.
 */
export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const session = await getAgentSession();
  if (!session) redirect("/login");

  const { view } = await searchParams;
  const history = view === "history";

  const core = tryGetCore();
  let jobs: Job[] = [];
  let unavailable = core === null;

  if (core) {
    try {
      jobs = groupJobs(await listAssignedTasks(core.db, session.userId));
    } catch {
      unavailable = true;
    }
  }

  const now = new Date();
  const sections = groupIntoSections(jobs, now, airportLocalDayBounds, airportLocalDay);
  const settled = settledJobs(jobs);
  /*
   * WHAT "TO DO" MEANS, and the number that was wrong.
   *
   * This summed the same four sections it does now, but `groupIntoSections`
   * used to let cancelled stops fall through into `overdue` — so the tab read
   * "To do · 7" for a driver with five jobs, while the home screen's own
   * count said five. Two screens, two answers, one booking. The filtering now
   * happens in one place and both read it, so the disagreement cannot come
   * back; see `isSettled`.
   */
  const open =
    sections.problems.length +
    sections.overdue.length +
    sections.today.length +
    sections.unscheduled.length +
    sections.upcoming.reduce((total, day) => total + day.jobs.length, 0);

  return (
    <AgentMain>
      <LiveTasks
        bookingIds={jobs.map((job) => job.bookingId)}
        stage={`jobs:${jobs.length}`}
      />

      <header className="flex flex-col gap-3">
        <h1 className="font-display text-3xl font-semibold text-navy-800">
          {history ? "History" : "Schedule"}
        </h1>
        {/*
          LINKS, not state: the page is `force-dynamic` and each view needs a
          different query, so the URL is the state — a schedule you can
          bookmark and go back to. The shared control renders anchors for any
          item carrying an `href`; see `SegmentedControl`.
        */}
        <SegmentedControl
          items={[
            { value: "todo" as const, label: `To do · ${open}`, href: "/tasks" },
            {
              value: "history" as const,
              label: `History · ${settled.length}`,
              href: "/tasks?view=history",
            },
          ]}
          value={history ? "history" : "todo"}
          linkComponent={Link}
          label="Schedule or history"
        />
      </header>

      {unavailable ? (
        <DatabaseNotConfigured />
      ) : history ? (
        <HistoryList jobs={settled} />
      ) : (
        <ScheduleList sections={sections} empty={jobs.length === 0} />
      )}
    </AgentMain>
  );
}

function Section({
  title,
  tone = "muted",
  jobs,
}: {
  title: string;
  tone?: "muted" | "alarm" | "now";
  jobs: readonly Job[];
}) {
  if (jobs.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <h2
        className={cn(
          "text-xs font-semibold tracking-wider uppercase",
          tone === "alarm" && "text-destructive",
          tone === "now" && "text-navy-800",
          tone === "muted" && "text-muted-foreground",
        )}
      >
        {title}
      </h2>
      <ul className="flex flex-col gap-3">
        {jobs.map((job) => (
          <li key={job.bookingId}>
            <JobCard job={job} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function ScheduleList({
  sections,
  empty,
}: {
  sections: ReturnType<typeof groupIntoSections>;
  empty: boolean;
}) {
  if (empty) {
    return (
      <EmptyState
        title="Nothing assigned"
        description="Pickups assigned to you show up here as soon as ops schedules them."
      />
    );
  }

  const nothingLeft =
    sections.problems.length === 0 &&
    sections.overdue.length === 0 &&
    sections.today.length === 0 &&
    sections.unscheduled.length === 0 &&
    sections.upcoming.length === 0;

  if (nothingLeft) {
    return (
      <EmptyState
        title="Nothing left"
        description="Every stop assigned to you is finished. They're in History."
      />
    );
  }

  return (
    <>
      {/* Problems lead. Nothing else on this screen is already going wrong. */}
      <Section
        title={`Open problems · ${sections.problems.length}`}
        tone="alarm"
        jobs={sections.problems}
      />
      {/* Today is the default focus — first heading a driver reads once
          nothing is wrong, and the only one that is not a date. */}
      <Section title="Today" tone="now" jobs={sections.today} />
      {sections.upcoming.map((day) => (
        <Section
          key={day.key}
          title={
            day.jobs[0]!.startsAt
              ? formatDayInAirportTz(day.jobs[0]!.startsAt, day.jobs[0]!.tz)
              : "No time set"
          }
          jobs={day.jobs}
        />
      ))}
      <Section title="No time set" jobs={sections.unscheduled} />
      {/*
        RUNNING LATE SITS LAST, and it used to sit second.

        TD's call, and the reasoning is about what a schedule is FOR. Sorted by
        time, the oldest thing in the queue leads — so a driver opening the tab
        met stops from days ago before this morning's, and the further behind
        they fell the harder the screen was to use. The two cases that made
        that unbearable are gone before this point (cancelled goes to History,
        past-cutoff goes to Open problems), so what is left here is real,
        doable, late work. It stays visible, and it stops taking the top of
        the screen from the stop somebody is driving to now.

        `muted` rather than `alarm` for the same reason: a stop you are twenty
        minutes behind on earns red, a stop from Tuesday earns attention but
        not alarm, and the section cannot tell them apart — so it stops
        shouting and the count says how many.
      */}
      <Section
        title={`Running late · ${sections.overdue.length}`}
        jobs={sections.overdue}
      />
      {/* Said out loud rather than left as an absence: "no heading called
          Today" and "nothing today" look identical, and only one of them is
          information. */}
      {sections.today.length === 0 &&
        sections.overdue.length === 0 &&
        sections.problems.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nothing today — your next stop is above.
          </p>
        )}
    </>
  );
}

/**
 * Settled work, most recent first — done AND cancelled.
 *
 * WHY CANCELLED LIVES HERE. It used to live nowhere: `isFinished` was "done"
 * alone, so a cancelled stop was not finished, was not outstanding, and sat in
 * the schedule's overdue section for the rest of time. TD's report was a
 * driver's Schedule led by cancelled bookings from 27 and 30 August.
 *
 * The old reasoning for keeping them on the day was sound and is preserved:
 * an agent who remembers being sent to that address must be able to find it,
 * and a schedule that quietly loses stops cannot be reconciled against what
 * somebody actually did. History satisfies both — the stop is still there,
 * still under its own day, and the only thing that changed is that it is no
 * longer in a list of things to go and do.
 *
 * A cancelled card is NOT dressed as work performed: `JobCard` draws it at
 * reduced opacity with a "Cancelled" badge, and the "N done" count on Today
 * uses `isDone`, never the length of this list.
 *
 * READ-ONLY BY CONSTRUCTION, not by hiding buttons: every card links to the
 * same task detail page, which renders its locked mode for a terminal task —
 * and every mutation behind it is refused by the state machine and the
 * actionability gates regardless of what any UI shows. See
 * `terminal-immutability.integration.test.ts`.
 */
function HistoryList({ jobs }: { jobs: readonly Job[] }) {
  if (jobs.length === 0) {
    return (
      <EmptyState
        title="Nothing here yet"
        description="Stops you've completed are kept here with their seals and timeline, along with any that were cancelled."
      />
    );
  }

  const days: { key: string; jobs: Job[] }[] = [];
  for (const job of jobs) {
    const key = job.startsAt ? airportLocalDay(job.startsAt, job.tz) : "unscheduled";
    const last = days.at(-1);
    if (last?.key === key) last.jobs.push(job);
    else days.push({ key, jobs: [job] });
  }

  return (
    <>
      {days.map((day) => (
        <Section
          key={day.key}
          title={
            day.jobs[0]!.startsAt
              ? formatDayInAirportTz(day.jobs[0]!.startsAt, day.jobs[0]!.tz)
              : "No time set"
          }
          jobs={day.jobs}
        />
      ))}
    </>
  );
}
