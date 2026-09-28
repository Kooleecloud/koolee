import * as React from "react";
import { Pressable, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { ArrowRight, CalendarDays } from "lucide-react-native";

import { JobSection } from "@/components/job/job-section";
import { JourneyList } from "@/components/job/journey-list";
import { TasksUnavailable, unavailableMessage } from "@/components/job/tasks-unavailable";
import { ShiftCard } from "@/components/shift/shift-card";
import {
  Button,
  Card,
  EmptyState,
  FormMessage,
  Screen,
  Skeleton,
  Text,
} from "@/components/ui";
import { groupIntoSections, groupJobs, isDone } from "@/lib/job";
import { useTasks } from "@/lib/queries";
import { airportLocalDayBounds } from "@/lib/time";
import { onQueueChange, queuedActionCount } from "@/offline/actions";

/**
 * Today — the only screen a driver should need mid-shift.
 *
 * One question in order: what am I doing right now, and what is after it.
 * The current job is rendered large with Navigate and Call attached, because
 * at the moment a driver looks at this screen they are either driving to a
 * door or standing at one.
 *
 * The shift card leads, where the web keeps it in the header: on a phone the
 * header is the status bar, and clocking on is the first thing a driver does
 * on this screen every morning.
 */

const REFRESH_MS = 30_000;
const NO_LATE = new Set<string>();

/**
 * Steps sitting in the on-device queue. Subscribed here rather than through
 * `useReplay`, which the tab layout mounts once — a second mount would
 * register a second set of replay triggers.
 */
function useQueuedSteps(): number {
  const [queued, setQueued] = React.useState(0);
  React.useEffect(() => {
    let cancelled = false;
    void queuedActionCount().then((n) => {
      if (!cancelled) setQueued(n);
    });
    const unsubscribe = onQueueChange(setQueued);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);
  return queued;
}

export default function TodayScreen() {
  const router = useRouter();
  const tasks = useTasks();
  const queued = useQueuedSteps();
  const { refetch } = tasks;

  // Fresh on every return to the tab and every 30 s while it is showing: a
  // task assigned mid-shift has to appear without a pull-to-refresh. The
  // interval stops on blur, so the Schedule tab does not poll for this one.
  // `cancelRefetch: false` joins a read already in flight (the mount's own,
  // or a pull) instead of aborting and restarting it.
  useFocusEffect(
    React.useCallback(() => {
      const tick = () => void refetch({ cancelRefetch: false });
      tick();
      const timer = setInterval(tick, REFRESH_MS);
      return () => clearInterval(timer);
    }, [refetch]),
  );

  // The pull-to-refresh spinner follows the PULL, not `isRefetching`: with the
  // poll above, tying it to the query would drop the spinner into the list
  // every 30 s. Background reads stay silent; a pull shows one.
  const [pulling, setPulling] = React.useState(false);
  const onPull = React.useCallback(() => {
    setPulling(true);
    void refetch().finally(() => setPulling(false));
  }, [refetch]);

  const jobs = React.useMemo(
    () => (tasks.data ? groupJobs(tasks.data) : []),
    [tasks.data],
  );

  // Read at render, not memoised: with the 30 s refetch above the screen
  // re-renders often enough that "today" tracks the airport's clock.
  const now = new Date();
  // One bucketing function, shared with the Schedule, so the two tabs cannot
  // disagree about what counts as work. "Today" is today AT THE AIRPORT.
  const sections = groupIntoSections(jobs, now);
  const route = sections.today;
  const runningLate = sections.overdue;
  const unscheduled = sections.unscheduled;
  const needsAttention = sections.problems;

  // Today's finished work, for the "N finished today" footer. Not in
  // `sections` — that function is about what is LEFT.
  const finished = jobs.filter((job) => {
    if (!isDone(job) || !job.startsAt) return false;
    const { start, end } = airportLocalDayBounds(now, job.tz);
    return job.startsAt >= start && job.startsAt < end;
  });

  const unavailable = tasks.isError && !tasks.data;
  const left =
    needsAttention.length + route.length + runningLate.length + unscheduled.length;
  const summary = tasks.isLoading
    ? "Loading your jobs…"
    : unavailable
      ? "Can't reach the server."
      : left === 0
        ? finished.length > 0
          ? `All ${finished.length} done. Nice.`
          : "Nothing assigned for today."
        : `${left} to do${finished.length > 0 ? ` · ${finished.length} done` : ""}`;

  return (
    <Screen testID="today-screen" refreshing={pulling} onRefresh={onPull}>
      <View className="gap-1">
        <Text
          accessibilityRole="header"
          face="display"
          weight="semibold"
          className="text-3xl text-navy-800"
        >
          Today
        </Text>
        <Text className="text-sm text-muted-foreground" testID="today-summary">
          {summary}
        </Text>
      </View>

      <ShiftCard />

      {queued > 0 ? (
        <View
          testID="offline-queue-notice"
          className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2"
        >
          <Text className="text-sm text-navy-700">
            {queued} step{queued === 1 ? "" : "s"} waiting for a signal — they'll send
            when you're back online.
          </Text>
        </View>
      ) : null}

      {tasks.isLoading ? (
        <View className="gap-4" testID="today-loading">
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
          {/* A refetch that failed over data we already have: say so above the
              list rather than replacing the list with it. */}
          {tasks.isError ? (
            <FormMessage>{unavailableMessage(tasks.error)}</FormMessage>
          ) : null}

          {/* LEADS THE SCREEN. A failed visit, or a stop whose bag-drop cutoff
              has passed: neither can be fixed by driving anywhere, and both
              need somebody told. */}
          <JobSection
            title={`Needs attention · ${needsAttention.length}`}
            jobs={needsAttention}
            startable
            testID="section-needs-attention"
          />

          {/* ONE RAIL, NOT TWO SECTIONS: these stops happen in an order, and
              the rail says which one the driver is on. See `JourneyList`. */}
          {route.length > 0 ? (
            <View className="gap-3" testID="section-route">
              <Text
                accessibilityRole="header"
                weight="semibold"
                className="text-xs uppercase tracking-wider text-muted-foreground"
              >
                Your route · {route.length} {route.length === 1 ? "stop" : "stops"}
              </Text>
              {/* Nothing in the route is late: a late stop is in `runningLate`
                  below, under a heading that says so. */}
              <JourneyList stops={route} lateIds={NO_LATE} />
            </View>
          ) : null}

          {/* Kept OUT of the rail. A stop with no window has no place in a
              sequence ordered by time. */}
          <JobSection
            title="No time set"
            jobs={unscheduled}
            startable
            testID="section-unscheduled"
          />

          {/* UNDER THE ROUTE, NOT OVER IT. Real work that must stay visible,
              but a stop from Tuesday standing in front of this morning's
              first job is a home screen answering a question nobody asked. */}
          <JobSection
            title={`Running late · ${runningLate.length}`}
            jobs={runningLate}
            startable
            testID="section-running-late"
          />

          {left === 0 ? (
            <EmptyState
              testID="today-empty"
              title={finished.length > 0 ? "Today is done" : "Nothing today"}
              description={
                finished.length > 0
                  ? "Every stop on today's list is finished."
                  : "When ops assigns you a pickup it shows up here."
              }
              action={
                <Button
                  variant="outline"
                  icon={<CalendarDays size={16} color="#152337" />}
                  testID="see-schedule"
                  onPress={() => router.push("/schedule")}
                >
                  See the schedule
                </Button>
              }
            />
          ) : null}

          {finished.length > 0 && left > 0 ? (
            <Card>
              <Pressable
                accessibilityRole="button"
                testID="finished-today-link"
                onPress={() => router.push("/schedule")}
                className="flex-row items-center justify-between gap-3 rounded-xl p-4 active:bg-muted/40"
              >
                <Text className="text-sm text-muted-foreground">
                  {finished.length} finished today
                </Text>
                <View className="flex-row items-center gap-1">
                  <Text weight="medium" className="text-sm text-navy-800">
                    Schedule
                  </Text>
                  <ArrowRight size={16} color="#0b2545" />
                </View>
              </Pressable>
            </Card>
          ) : null}
        </>
      )}
    </Screen>
  );
}
