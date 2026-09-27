import { useRouter } from "expo-router";
import { Pressable, View } from "react-native";
import { Check, ChevronRight, MapPin } from "lucide-react-native";

import { Badge, Text } from "@/components/ui";
import { addressText, startablePickupTaskId, type Job } from "@/lib/job";
import { formatDay } from "@/lib/time";

import { JobCard, jobTarget, jobWhen, taskHref } from "./job-card";

/**
 * The day as a JOURNEY — stops in the order they happen, on one connected
 * rail. The native twin of the web's `components/job/journey-list.tsx`.
 *
 * ONE RAIL, ONE CURRENT STOP. The connector makes the order structural rather
 * than implied by position, the numbered dots survive scrolling past the
 * heading, and exactly one stop is open at a time: the one to do next, with
 * its controls. The rest are compact rows that stay one tap away. That is the
 * distinction a plain list cannot draw — "where I am" versus "what is after
 * this".
 *
 * ORDERED BY SCHEDULED TIME, NOT BY GEOGRAPHY. The customer bought a window,
 * and a route optimiser that reorders stops to save a mile would quietly break
 * the promise the window is.
 */

const MUTED = "#58687e";
const ON_STATUS = "#f8fafc";

export interface JourneyListProps {
  stops: readonly Job[];
  /**
   * Stops whose window has already passed. They are marked, because a driver
   * reading a rail top to bottom would otherwise take the first row as "next"
   * rather than "late".
   */
  lateIds?: ReadonlySet<string>;
  testID?: string;
}

export function JourneyList({ stops, lateIds, testID = "journey" }: JourneyListProps) {
  if (stops.length === 0) return null;

  // Where the driver actually is: the first stop that is still WORK.
  // Cancelled is as finished as done for this purpose; the difference is only
  // how it ended.
  const currentIndex = stops.findIndex(
    (job) => job.state !== "done" && job.state !== "cancelled",
  );

  return (
    <View testID={testID}>
      {stops.map((job, index) => {
        const isCurrent = index === currentIndex;
        const isPast = currentIndex !== -1 && index < currentIndex;
        const isLast = index === stops.length - 1;
        // A CANCELLED STOP IS NEVER LATE, wherever the set came from. Enforced
        // here rather than in each renderer so a third one cannot get it
        // wrong.
        const late = job.state !== "cancelled" && (lateIds?.has(job.bookingId) ?? false);
        // A late stop is, by definition, from an earlier day — so a rail
        // showing only clock times renders "11:00 AM" above "8:00 AM" and
        // reads as a sorting bug. The date is what makes that legible.
        const dayLabel = late && job.startsAt ? formatDay(job.startsAt, job.tz) : null;
        return (
          <View
            key={job.bookingId}
            className={`relative flex-row gap-3 ${isLast ? "pb-0" : "pb-4"}`}
          >
            {/* The rail: drawn BEHIND the dot, from the dot's centre to the
                bottom of the row, so it reads as one continuous line through
                the whole day. Not rendered after the last stop, which would
                trail off into nothing. */}
            {!isLast ? (
              <View className="absolute -bottom-1 left-[0.6875rem] top-7 w-px bg-border" />
            ) : null}

            <StopDot index={index} job={job} isCurrent={isCurrent} isPast={isPast} />

            <View className="min-w-0 flex-1">
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
                <CompactStop job={job} dimmed={isPast} late={late} dayLabel={dayLabel} />
              )}
            </View>
          </View>
        );
      })}
    </View>
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
  const cancelled = job.state === "cancelled";

  const box = done
    ? "border-success bg-success"
    : problem
      ? "border-destructive bg-destructive"
      : cancelled
        ? "border-border bg-background"
        : isCurrent
          ? "border-navy-800 bg-navy-800"
          : "border-border bg-background";
  const text = problem
    ? "text-destructive-foreground"
    : cancelled
      ? // Struck through: a muted hollow dot on its own is indistinguishable
        // from an upcoming stop at a glance, and the strike IS the state.
        "text-muted-foreground line-through"
      : isCurrent
        ? "text-white"
        : "text-muted-foreground";
  const dim = (isPast || cancelled) && !done ? "opacity-60" : "";

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className={`relative z-10 mt-1.5 h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 ${box} ${dim}`}
    >
      {done ? (
        <Check size={14} color={ON_STATUS} />
      ) : (
        <Text weight="semibold" className={`text-[11px] ${text}`}>
          {problem ? "!" : index + 1}
        </Text>
      )}
    </View>
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
  const router = useRouter();
  const { booking } = job;
  const target = jobTarget(job);
  const when = jobWhen(job, "No time set");

  // STILL TAPPABLE, deliberately. The obvious move is to make a cancelled stop
  // unopenable — but the detail screen behind it is the only place that says
  // WHO cancelled it and when, which is exactly what a driver who was told to
  // go to that address needs. Dimmed so it does not compete with the work.
  const opacity = job.state === "cancelled" ? "opacity-60" : dimmed ? "opacity-70" : "";

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${when}, ${booking.paxName}, ${addressText(booking)}`}
      testID={`stop-${booking.ref}`}
      onPress={() => router.push(taskHref(target))}
      className={`flex-row items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 active:border-border active:bg-muted/40 ${opacity}`}
    >
      <View className="min-w-0 flex-1 gap-0.5">
        <View className="flex-row flex-wrap items-baseline gap-x-2">
          {dayLabel ? (
            <Text
              weight="semibold"
              className="text-xs uppercase tracking-wide text-warning-foreground"
            >
              {dayLabel}
            </Text>
          ) : null}
          <Text face="display" weight="semibold" className="text-base text-navy-800">
            {when}
          </Text>
          <Text numberOfLines={1} className="shrink text-sm text-foreground">
            {booking.paxName}
          </Text>
        </View>
        <View className="flex-row items-center gap-1.5">
          <MapPin size={14} color={MUTED} />
          <Text numberOfLines={1} className="flex-1 text-xs text-muted-foreground">
            {addressText(booking)}
          </Text>
        </View>
      </View>

      {job.state === "problem" ? <Badge variant="destructive">Problem</Badge> : null}
      {/* Same weight as Done, same reasoning as the expanded card: present,
          legible, and plainly not asking for anything. */}
      {job.state === "cancelled" ? <Badge variant="secondary">Cancelled</Badge> : null}
      {/* "Late", not "Overdue": still collectable — the badge is a warning,
          never a refusal. Never on a cancelled stop; see the call site. */}
      {late && job.state !== "problem" ? <Badge variant="warning">Late</Badge> : null}
      {job.state === "done" ? <Badge variant="success">Done</Badge> : null}
      <ChevronRight size={16} color={MUTED} />
    </Pressable>
  );
}
