import { redirect } from "next/navigation";
import { DatabaseNotConfigured, EmptyState } from "@koolee/ui";
import {
  airportLocalDay,
  airportLocalDayBounds,
  formatDayInAirportTz,
  listAssignedTasks,
} from "@koolee/core";

import { JobCard } from "@/components/job/job-card";
import { LiveTasks } from "@/components/live-tasks";
import { AgentMain } from "@/components/shell/agent-main";
import { groupJobs, type Job } from "@/lib/job";
import { tryGetCore } from "@/lib/core";
import { getAgentSession } from "@/lib/session";

export const metadata = { title: "Schedule" };
export const dynamic = "force-dynamic";

/**
 * The whole assignment list, grouped by day.
 *
 * The version this replaces was a flat chronological dump of every task ever
 * assigned — months of finished work above the current week, with no marker
 * for "now". A driver opening it in the morning scrolled past June to find
 * today.
 *
 * Two rules fix that. Finished work collapses into a count instead of
 * occupying the list, and the days run forward from today rather than from
 * the beginning of time. What is behind you is still reachable — it is just
 * not in the way of what is in front of you.
 */
export default async function SchedulePage() {
  const session = await getAgentSession();
  if (!session) redirect("/login");

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
  const isPast = (job: Job) => {
    if (!job.startsAt) return false;
    const { start } = airportLocalDayBounds(now, job.tz);
    return job.startsAt < start;
  };

  const open = jobs.filter((job) => job.state !== "done" && !isPast(job));
  const behind = jobs.filter((job) => job.state !== "done" && isPast(job));
  const done = jobs.filter((job) => job.state === "done");

  // The day heading is the job's OWN airport-local day, so a driver working
  // one airport reads their own calendar and a cross-airport list stays honest.
  const days: { key: string; heading: string; jobs: Job[] }[] = [];
  for (const job of open) {
    const key = job.startsAt ? airportLocalDay(job.startsAt, job.tz) : "unscheduled";
    const last = days.at(-1);
    if (last?.key === key) {
      last.jobs.push(job);
      continue;
    }
    days.push({
      key,
      heading: job.startsAt ? formatDayInAirportTz(job.startsAt, job.tz) : "No time set",
      jobs: [job],
    });
  }

  const todayKey = jobs[0] ? airportLocalDay(now, jobs[0].tz) : null;

  return (
    <AgentMain>
      <LiveTasks stage={`jobs:${jobs.length}`} />
      <header className="flex flex-col gap-1">
        <h1 className="font-display text-3xl font-semibold text-navy-800">Schedule</h1>
        <p className="text-sm text-muted-foreground">
          {unavailable
            ? "Can't reach the server."
            : behind.length > 0
              ? `${behind.length} overdue · ${open.length} still to come`
              : `${open.length} to do`}
        </p>
      </header>

      {unavailable ? (
        <DatabaseNotConfigured />
      ) : jobs.length === 0 ? (
        <EmptyState
          title="Nothing assigned"
          description="Pickups assigned to you show up here as soon as ops schedules them."
        />
      ) : (
        <>
          {/* Overdue leads. A stop whose window has passed is the only thing
              on this screen that is already going wrong. */}
          {behind.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="text-xs font-semibold tracking-wider text-destructive uppercase">
                Overdue · {behind.length}
              </h2>
              <ul className="flex flex-col gap-3">
                {behind.map((job) => (
                  <li key={job.bookingId}>
                    <JobCard job={job} />
                  </li>
                ))}
              </ul>
            </section>
          )}

          {days.map((day) => (
            <section key={day.key} className="flex flex-col gap-2">
              <h2 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                {day.key === todayKey ? `Today · ${day.heading}` : day.heading}
              </h2>
              <ul className="flex flex-col gap-3">
                {day.jobs.map((job) => (
                  <li key={job.bookingId}>
                    <JobCard job={job} />
                  </li>
                ))}
              </ul>
            </section>
          ))}

          {open.length === 0 && behind.length === 0 && (
            <EmptyState
              title="Nothing left"
              description="Every stop assigned to you is finished."
            />
          )}

          {/* Finished work is history, not a list item. Folded away by default,
              one tap from a driver who wants to check what they did. */}
          {done.length > 0 && (
            <details className="group">
              <summary className="flex h-12 cursor-pointer items-center justify-between rounded-lg border border-border bg-card px-4 text-sm font-medium text-muted-foreground marker:content-none focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring">
                {done.length} finished
                <span
                  aria-hidden="true"
                  className="text-xs transition-transform group-open:rotate-180"
                >
                  ▾
                </span>
              </summary>
              <ul className="mt-3 flex flex-col gap-3">
                {done.map((job) => (
                  <li key={job.bookingId}>
                    <JobCard job={job} />
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </AgentMain>
  );
}
