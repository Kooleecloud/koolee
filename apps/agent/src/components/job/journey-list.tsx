import Link from "next/link";
import { Check, ChevronRight, MapPin } from "lucide-react";
import { Badge, cn } from "@koolee/ui";
import {
  formatDayInAirportTz,
  formatHourInAirportTz,
  formatHourRangeInAirportTz,
} from "@koolee/core";

import { addressText, startablePickupTaskId, type Job } from "@/lib/job";

import { JobCard } from "./job-card";

/**
 * The day as a JOURNEY — stops in the order they happen, on one connected
 * rail.
 *
 * WHAT THIS REPLACES. Two headed sections, "Up next" and "Later today", each
 * holding standalone cards. Every card looked equally like a starting point,
 * nothing said that the third one comes after the second, and the sequence —
 * the single most useful fact about a driver's day — had to be reconstructed
 * from four separate timestamps. A driver does not have a list of jobs. They
 * have a route.
 *
 * ONE RAIL, ONE CURRENT STOP. The connector makes the order structural rather
 * than implied by position, the numbered dots survive scrolling past the
 * heading, and exactly one stop is open at a time: the one to do next, with
 * its controls. The rest are compact rows that stay one tap away. That is the
 * distinction the old layout could not draw — "where I am" versus "what is
 * after this".
 *
 * ORDERED BY SCHEDULED TIME, NOT BY GEOGRAPHY. The customer bought a window,
 * and a route optimiser that reorders stops to save a mile would quietly break
 * the promise the window is. Optimisation stays a deferred item (P17); when it
 * arrives it will have to reason about windows, and this component will render
 * whatever order it produces without changing.
 */
export function JourneyList({
  stops,
  /**
   * Stops whose window has already passed. They lead the route rather than
   * being hidden — see the note on the Today page — and they are marked,
   * because a driver reading a rail top to bottom would otherwise take the
   * first row as "next" rather than "late".
   */
  lateIds,
}: {
  stops: Job[];
  lateIds?: ReadonlySet<string>;
}) {
  if (stops.length === 0) return null;

  // The first unfinished stop is where the driver is. Everything before it in
  // the list is done; everything after is ahead.
  const currentIndex = stops.findIndex((job) => job.state !== "done");

  return (
    <ol className="flex flex-col">
      {stops.map((job, index) => {
        const isCurrent = index === currentIndex;
        const isPast = currentIndex !== -1 && index < currentIndex;
        const late = lateIds?.has(job.bookingId) ?? false;
        /*
         * A LATE STOP CARRIES ITS DATE, and the rail is unreadable without it.
         *
         * Late stops lead the route and are, by definition, from an earlier
         * day — so a rail showing only clock times renders "11:00 AM" above
         * "8:00 AM" and reads as a sorting bug. It is not: they are two
         * different days, correctly ordered. The date is what makes that
         * legible. Today's stops stay bare, because repeating today's date on
         * every row is noise.
         */
        const dayLabel =
          late && job.startsAt ? formatDayInAirportTz(job.startsAt, job.tz) : null;
        return (
          <li key={job.bookingId} className="relative flex gap-3 pb-4 last:pb-0">
            {/*
              The rail. Absolutely positioned and drawn BEHIND the dot, from
              the dot's centre to the bottom of the row, so it reads as one
              continuous line through the whole day rather than as a series of
              ticks between cards. Not rendered after the last stop, which
              would trail off into nothing.
            */}
            {index < stops.length - 1 && (
              <span
                aria-hidden="true"
                className="absolute left-[0.6875rem] top-7 -bottom-1 w-px bg-border"
              />
            )}

            <StopDot index={index} job={job} isCurrent={isCurrent} isPast={isPast} />

            <div className="min-w-0 flex-1">
              {isCurrent ? (
                /* The one open stop: the full card, with Navigate and Call. */
                <JobCard
                  job={job}
                  emphasis
                  late={late}
                  dayLabel={dayLabel}
                  startsPickupTaskId={startablePickupTaskId(job)}
                />
              ) : (
                <CompactStop
                  job={job}
                  dimmed={isPast}
                  late={late}
                  dayLabel={dayLabel}
                />
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The marker on the rail.
 *
 * A number, not a bullet: "stop 3 of 5" is a thing a driver says to
 * themselves, and it is the difference between a list and a route. Done stops
 * keep their place and take a check — removing them would renumber the day
 * under someone mid-shift.
 */
function StopDot({
  index,
  job,
  isCurrent,
  isPast,
}: {
  index: number;
  job: Job;
  isCurrent: boolean;
  isPast: boolean;
}) {
  const done = job.state === "done";
  const problem = job.state === "problem";

  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative z-10 mt-1.5 flex size-6 shrink-0 items-center justify-center rounded-full border-2 text-[11px] font-semibold",
        done && "border-success bg-success text-success-foreground",
        problem && "border-destructive bg-destructive text-destructive-foreground",
        !done && !problem && isCurrent && "border-navy-800 bg-navy-800 text-white",
        !done && !problem && !isCurrent && "border-border bg-background text-muted-foreground",
        isPast && !done && "opacity-60",
      )}
    >
      {done ? <Check className="size-3.5" /> : problem ? "!" : index + 1}
    </span>
  );
}

/**
 * A stop that is not the current one: when, who, where, and its state.
 *
 * No controls. Navigate and Call belong to the stop being worked — offering
 * them on every row invites a driver to set off for stop four while stop two
 * still has bags on a doorstep, and "Start & navigate" on a future leg would
 * start it for real.
 */
function CompactStop({
  job,
  dimmed,
  late,
  dayLabel,
}: {
  job: Job;
  dimmed: boolean;
  late: boolean;
  /** Set only on stops from an earlier day — see the note at the call site. */
  dayLabel: string | null;
}) {
  const { booking, tz, next } = job;
  const target = next ?? job.phases.at(-1)!;

  const when = job.startsAt
    ? next?.scheduledStart && next.scheduledEnd
      ? formatHourRangeInAirportTz(next.scheduledStart, next.scheduledEnd, tz)
      : formatHourInAirportTz(job.startsAt, tz)
    : "No time set";

  return (
    <Link
      href={`/tasks/${target.taskId}?kind=${target.kind}`}
      className={cn(
        "flex items-center gap-3 rounded-lg border border-transparent px-3 py-2.5",
        "transition-colors hover:border-border hover:bg-muted/40",
        "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
        dimmed && "opacity-70",
      )}
    >
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex flex-wrap items-baseline gap-x-2">
          {dayLabel ? (
            <span className="text-xs font-semibold tracking-wide text-warning-foreground uppercase">
              {dayLabel}
            </span>
          ) : null}
          <span className="font-display font-semibold text-navy-800">{when}</span>
          <span className="truncate text-sm">{booking.paxName}</span>
        </span>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <MapPin aria-hidden="true" className="size-3.5 shrink-0" />
          <span className="truncate">{addressText(booking)}</span>
        </span>
      </span>

      {job.state === "problem" && <Badge variant="destructive">Problem</Badge>}
      {/* "Late", not "Overdue": the driver is the one reading it, and it says
          what to do about it more directly. Still collectable — the badge is a
          warning, never a refusal. */}
      {late && job.state !== "problem" && <Badge variant="warning">Late</Badge>}
      {job.state === "done" && <Badge variant="success">Done</Badge>}
      <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
    </Link>
  );
}
