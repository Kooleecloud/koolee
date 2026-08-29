import Link from "next/link";
import { Check, ChevronRight, CircleAlert, MapPin } from "lucide-react";
import { Badge, Card, cn } from "@koolee/ui";
import { formatHourInAirportTz, formatHourRangeInAirportTz } from "@koolee/core";

import {
  addressText,
  PHASE_LABEL,
  PHASE_WHERE,
  type Job,
  type JobPhase,
} from "@/lib/job";

import { JobActions } from "./job-actions";

/**
 * One booking, one card — the unit a driver actually works in.
 *
 * Reading order is the order the questions arrive: when, who and where, what
 * is left to do, and then the two ways out of the app. Ref and flight sit last
 * because they are for reading back on a phone call, not for choosing a stop.
 */

/** Driver vocabulary. The database says `assigned`; a person says "to do". */
function phaseState(phase: JobPhase): { label: string; done: boolean; bad: boolean } {
  switch (phase.status) {
    case "done":
      return { label: "Done", done: true, bad: false };
    case "failed":
      return { label: "Problem", done: false, bad: true };
    case "in_progress":
      return { label: "Started", done: false, bad: false };
    default:
      return { label: "To do", done: false, bad: false };
  }
}

function PhaseRow({ phase, isNext }: { phase: JobPhase; isNext: boolean }) {
  const state = phaseState(phase);
  return (
    <li
      className={cn(
        "flex items-center gap-2.5 text-sm",
        state.done && "text-muted-foreground",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold",
          state.done && "border-transparent bg-success text-success-foreground",
          state.bad && "border-transparent bg-destructive text-destructive-foreground",
          !state.done && !state.bad && isNext && "border-navy-800 bg-navy-800 text-white",
          !state.done && !state.bad && !isNext && "border-border text-muted-foreground",
        )}
      >
        {state.done ? <Check className="size-3" /> : state.bad ? "!" : ""}
      </span>
      <span className={cn("flex-1", isNext && "font-semibold text-navy-800")}>
        {PHASE_LABEL[phase.kind]}
        <span className="ml-1.5 text-xs font-normal text-muted-foreground">
          {PHASE_WHERE[phase.kind]}
        </span>
      </span>
      <span
        className={cn(
          "shrink-0 text-xs font-medium",
          state.bad ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {state.label}
      </span>
    </li>
  );
}

export function JobCard({ job, emphasis = false }: { job: Job; emphasis?: boolean }) {
  const { booking, tz, next } = job;
  // A finished job still opens — a driver checking what they did needs a way
  // back in — but it opens on its last phase rather than nothing.
  const target = next ?? job.phases.at(-1)!;

  const when = job.startsAt
    ? next?.scheduledStart && next.scheduledEnd
      ? formatHourRangeInAirportTz(next.scheduledStart, next.scheduledEnd, tz)
      : formatHourInAirportTz(job.startsAt, tz)
    : "Unscheduled";

  return (
    <Card
      className={cn(
        "flex flex-col",
        emphasis && "border-navy-200 shadow-lift-lg",
        job.state === "problem" && "border-destructive/50",
        job.state === "done" && "opacity-75",
      )}
    >
      <Link
        href={`/tasks/${target.taskId}?kind=${target.kind}`}
        className="flex flex-col gap-3 rounded-t-xl p-4 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:-outline-offset-2"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col">
            {/* The clock leads. A driver plans the day by time and only then
                asks which stop this is. */}
            <span
              className={cn(
                "font-display font-semibold text-balance text-navy-800",
                emphasis ? "text-xl" : "text-lg",
              )}
            >
              {when}
            </span>
            <span className="truncate text-base font-medium">{booking.paxName}</span>
          </div>
          <span className="flex shrink-0 items-center gap-2">
            {job.state === "problem" && (
              <Badge variant="destructive">
                <CircleAlert aria-hidden="true" className="mr-1 size-3" />
                Problem
              </Badge>
            )}
            {job.state === "active" && <Badge variant="warning">In progress</Badge>}
            {job.state === "done" && <Badge variant="success">Done</Badge>}
            <ChevronRight aria-hidden="true" className="size-5 text-muted-foreground" />
          </span>
        </div>

        <div className="flex items-start gap-2 text-sm text-muted-foreground">
          <MapPin aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span className="min-w-0">{addressText(booking)}</span>
        </div>

        <ul className="flex flex-col gap-2 border-t border-border pt-3">
          {job.phases.map((phase) => (
            <PhaseRow
              key={phase.taskId}
              phase={phase}
              isNext={next?.taskId === phase.taskId}
            />
          ))}
        </ul>

        <p className="text-xs text-muted-foreground">
          <span className="font-mono">{booking.ref}</span> · {booking.bagCount} bag
          {booking.bagCount === 1 ? "" : "s"} · {booking.flightNumber} ·{" "}
          {booking.departureAirport}
        </p>
      </Link>

      {/* Outside the Link: a nested anchor is invalid, and tapping Navigate
          must not also open the job. */}
      {job.state !== "done" && (
        <div className="border-t border-border p-4 pt-3">
          <JobActions booking={booking} />
        </div>
      )}
    </Card>
  );
}
