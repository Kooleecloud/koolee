import * as React from "react";
import { View } from "react-native";
import { useFocusEffect } from "expo-router";

import { JobSection } from "@/components/job/job-section";
import { TasksUnavailable, unavailableMessage } from "@/components/job/tasks-unavailable";
import {
  EmptyState,
  FormMessage,
  Screen,
  SegmentedControl,
  Skeleton,
  Text,
} from "@/components/ui";
import {
  groupIntoSections,
  groupJobs,
  settledJobs,
  type Job,
  type JobSections,
} from "@/lib/job";
import { useTasks } from "@/lib/queries";
import { airportLocalDay, formatDay } from "@/lib/time";

/**
 * The schedule, and its History twin.
 *
 * TWO VIEWS ON ONE TAB, not a fourth bottom tab. The tab bar is capped at
 * three: a driver has exactly three questions, and the bottom third of a
 * phone is the only part a thumb reaches without regripping. History is not a
 * fourth question — it is the past tense of "what is coming" — so it lives as
 * a segmented control at the top of this screen. On the web the view is a
 * query string; here it is screen state, which is what the control is for.
 *
 * SCHEDULE IS ORDERED BY ATTENTION, not by time alone: problems, then today,
 * then a group per upcoming day, then whatever is late. `groupIntoSections`
 * owns that; every day boundary is AIRPORT-local.
 *
 * FINISHED WORK IS NOT ON THE SCHEDULE. It is one tap away instead.
 */

type ScheduleView = "todo" | "history";

const VIEWS: readonly { value: ScheduleView; label: string }[] = [
  { value: "todo", label: "To do" },
  { value: "history", label: "History" },
];

export default function ScheduleScreen() {
  const tasks = useTasks();
  const { refetch } = tasks;
  const [view, setView] = React.useState<ScheduleView>("todo");

  // Fresh on every return to the tab; the 30 s poll belongs to Today, which
  // is the screen a driver leaves open. `cancelRefetch: false` joins a read
  // already in flight rather than aborting it.
  useFocusEffect(
    React.useCallback(() => {
      void refetch({ cancelRefetch: false });
    }, [refetch]),
  );

  // Spinner on a pull only — a focus refetch must not flash it on every tab
  // switch. Same rule as Today.
  const [pulling, setPulling] = React.useState(false);
  const onPull = React.useCallback(() => {
    setPulling(true);
    void refetch().finally(() => setPulling(false));
  }, [refetch]);

  const jobs = React.useMemo(
    () => (tasks.data ? groupJobs(tasks.data) : []),
    [tasks.data],
  );
  const sections = groupIntoSections(jobs, new Date());
  const settled = settledJobs(jobs);
  // The same four sections Today counts, plus every upcoming day; cancelled
  // stops are in none of them, so the two tabs read the same number.
  const open =
    sections.problems.length +
    sections.overdue.length +
    sections.today.length +
    sections.unscheduled.length +
    sections.upcoming.reduce((total, day) => total + day.jobs.length, 0);

  const unavailable = tasks.isError && !tasks.data;
  const history = view === "history";

  return (
    <Screen testID="schedule-screen" refreshing={pulling} onRefresh={onPull}>
      <View className="gap-3">
        <Text
          accessibilityRole="header"
          face="display"
          weight="semibold"
          className="text-3xl text-navy-800"
        >
          {history ? "History" : "Schedule"}
        </Text>
        <SegmentedControl
          items={VIEWS.map((item) => ({
            value: item.value,
            label: `${item.label} · ${item.value === "todo" ? open : settled.length}`,
          }))}
          value={view}
          onChange={setView}
          label="Schedule or history"
          testID="schedule-view"
        />
      </View>

      {tasks.isLoading ? (
        <View className="gap-4" testID="schedule-loading">
          <Skeleton className="h-40 w-full rounded-xl" />
          <Skeleton className="h-40 w-full rounded-xl" />
          <Skeleton className="h-40 w-full rounded-xl" />
        </View>
      ) : unavailable ? (
        <TasksUnavailable
          error={tasks.error}
          retrying={tasks.isRefetching}
          onRetry={() => void refetch()}
        />
      ) : (
        <>
          {tasks.isError ? (
            <FormMessage>{unavailableMessage(tasks.error)}</FormMessage>
          ) : null}
          {history ? (
            <HistoryList jobs={settled} />
          ) : (
            <ScheduleList sections={sections} empty={jobs.length === 0} />
          )}
        </>
      )}
    </Screen>
  );
}

/** A day's heading: the airport-local date of its first stop. */
function dayTitle(jobs: readonly Job[]): string {
  const first = jobs[0];
  return first?.startsAt ? formatDay(first.startsAt, first.tz) : "No time set";
}

function ScheduleList({ sections, empty }: { sections: JobSections; empty: boolean }) {
  if (empty) {
    return (
      <EmptyState
        testID="schedule-empty"
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
        testID="schedule-nothing-left"
        title="Nothing left"
        description="Every stop assigned to you is finished. They're in History."
      />
    );
  }

  return (
    <>
      {/* Problems lead. Nothing else on this screen is already going wrong. */}
      <JobSection
        title={`Open problems · ${sections.problems.length}`}
        tone="alarm"
        jobs={sections.problems}
        testID="section-problems"
      />
      {/* Today is the default focus — first heading a driver reads once
          nothing is wrong, and the only one that is not a date. */}
      <JobSection title="Today" tone="now" jobs={sections.today} testID="section-today" />
      {sections.upcoming.map((day) => (
        <JobSection
          key={day.key}
          title={dayTitle(day.jobs)}
          jobs={day.jobs}
          testID={`section-day-${day.key}`}
        />
      ))}
      <JobSection
        title="No time set"
        jobs={sections.unscheduled}
        testID="section-unscheduled"
      />
      {/* RUNNING LATE SITS LAST. Sorted by time the oldest thing in the queue
          would lead, so a driver opening the tab met stops from days ago
          before this morning's. `muted` rather than `alarm`: a stop from
          Tuesday earns attention but not alarm, and the count says how many. */}
      <JobSection
        title={`Running late · ${sections.overdue.length}`}
        jobs={sections.overdue}
        testID="section-running-late"
      />
      {/* Said out loud rather than left as an absence: "no heading called
          Today" and "nothing today" look identical, and only one of them is
          information. */}
      {sections.today.length === 0 &&
      sections.overdue.length === 0 &&
      sections.problems.length === 0 ? (
        <Text className="text-sm text-muted-foreground" testID="schedule-nothing-today">
          Nothing today — your next stop is above.
        </Text>
      ) : null}
    </>
  );
}

/**
 * Settled work, most recent first — done AND cancelled.
 *
 * A cancelled stop is still findable under its own day, next to the rest of
 * the work it belonged to, in the one place that is not a list of things to
 * go and do. The card marks it cancelled so it is never mistaken for work
 * performed. Read-only by construction: every card opens the same task
 * screen, which renders its locked mode for a terminal task.
 */
function HistoryList({ jobs }: { jobs: readonly Job[] }) {
  if (jobs.length === 0) {
    return (
      <EmptyState
        testID="history-empty"
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
        <JobSection
          key={day.key}
          title={dayTitle(day.jobs)}
          jobs={day.jobs}
          testID={`history-day-${day.key}`}
        />
      ))}
    </>
  );
}
