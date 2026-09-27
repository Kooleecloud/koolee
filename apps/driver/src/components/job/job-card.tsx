import { useRouter } from "expo-router";
import { Pressable, View } from "react-native";
import { Check, ChevronRight, CircleAlert, MapPin, Truck } from "lucide-react-native";

import { Badge, BookingRef, Card, Text } from "@/components/ui";
import {
  addressText,
  PHASE_LABEL,
  PHASE_WHERE,
  type Job,
  type JobPhase,
} from "@/lib/job";
import { formatHour, formatHourRange } from "@/lib/time";

import { JobActions } from "./job-actions";

/**
 * One booking, one card — the unit a driver actually works in. The native
 * twin of the web agent app's `components/job/job-card.tsx`.
 *
 * Reading order is the order the questions arrive: when, who and where, what
 * is left to do, and then the two ways out of the app. Ref and flight sit last
 * because they are for reading back on a phone call, not for choosing a stop.
 */

/** `text-muted-foreground` — lucide takes a hex, not a class. */
const MUTED = "#58687e";
const NAVY_400 = "#4e74a3";
const ON_STATUS = "#f8fafc";

/**
 * The phase a tap on this job opens. A finished job still opens — a driver
 * checking what they did needs a way back in — but it opens on its last phase
 * rather than nothing.
 */
export function jobTarget(job: Job): JobPhase {
  return job.next ?? job.phases.at(-1)!;
}

/** The `/tasks/:taskId?kind=` link, as an expo-router push. */
export function taskHref(target: JobPhase) {
  return {
    pathname: "/task/[taskId]" as const,
    params: { taskId: target.taskId, kind: target.kind },
  };
}

/** The clock line: the next phase's window, else the job's start. */
export function jobWhen(job: Job, fallback: string): string {
  const { next, tz } = job;
  if (!job.startsAt) return fallback;
  return next?.scheduledStart && next.scheduledEnd
    ? formatHourRange(next.scheduledStart, next.scheduledEnd, tz)
    : formatHour(job.startsAt, tz);
}

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
  const dot = state.done
    ? "border-transparent bg-success"
    : state.bad
      ? "border-transparent bg-destructive"
      : isNext
        ? "border-navy-800 bg-navy-800"
        : "border-border";
  return (
    <View className="flex-row items-center gap-2.5">
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        className={`h-5 w-5 shrink-0 items-center justify-center rounded-full border ${dot}`}
      >
        {state.done ? (
          <Check size={12} color={ON_STATUS} />
        ) : state.bad ? (
          <Text weight="semibold" className="text-[10px] text-destructive-foreground">
            !
          </Text>
        ) : null}
      </View>
      <View className="flex-1 flex-row flex-wrap items-center gap-x-1.5">
        {/* The two halves of a job read differently on purpose: the pickup
            phase carries the truck icon and its own vocabulary, so a driver
            scanning a queue can tell "stand at a door" from "drive to JFK"
            without reading the words. */}
        <View className="flex-row items-center gap-1.5">
          {phase.kind === "pickup" ? <Truck size={14} color={NAVY_400} /> : null}
          <Text
            weight={isNext ? "semibold" : "regular"}
            className={`text-sm ${isNext ? "text-navy-800" : state.done ? "text-muted-foreground" : "text-foreground"}`}
          >
            {PHASE_LABEL[phase.kind]}
          </Text>
        </View>
        <Text className="text-xs text-muted-foreground">
          {phase.awaitingDriverChoice
            ? "waiting on the customer to choose a driver"
            : PHASE_WHERE[phase.kind]}
        </Text>
      </View>
      <Text
        weight="medium"
        className={`shrink-0 text-xs ${state.bad ? "text-destructive" : "text-muted-foreground"}`}
      >
        {state.label}
      </Text>
    </View>
  );
}

export interface JobCardProps {
  job: Job;
  emphasis?: boolean;
  /** The window has passed. A warning, never a refusal — it is still doable. */
  late?: boolean;
  /**
   * The stop's day, when it is not today. Without it a rail led by late stops
   * shows "11:00 AM" above "8:00 AM" and reads as a sorting bug.
   */
  dayLabel?: string | null;
  /** Passed through to `JobActions` — see `startablePickupTaskId`. */
  startsPickupTaskId?: string | null;
}

export function JobCard({
  job,
  emphasis = false,
  late = false,
  dayLabel = null,
  startsPickupTaskId = null,
}: JobCardProps) {
  const router = useRouter();
  const { booking } = job;
  const target = jobTarget(job);
  const when = jobWhen(job, "Unscheduled");

  // The web stacks `border-navy-200` / `border-destructive/50` /
  // `border-warning/60` over the Card's `border-border` and lets
  // tailwind-merge keep the last one. NativeWind settles a conflict by
  // stylesheet order, and `border` is emitted after every brand colour, so
  // the Card's own colour would win — an inline colour beats both. One
  // choice, so the precedence is visible: a problem outranks late, late
  // outranks the emphasis tint.
  const borderColor =
    job.state === "problem"
      ? "rgba(220, 40, 40, 0.5)"
      : late
        ? "rgba(220, 143, 9, 0.6)"
        : emphasis
          ? "#b4c5de"
          : undefined;
  // Same visual weight for finished and cancelled: present, legible, and
  // plainly not asking for anything.
  const dim = job.state === "done" || job.state === "cancelled" ? "opacity-75" : "";

  return (
    <Card
      className={dim}
      // `style` replaces the Card's own, so the lift shadow is restated:
      // `shadow-lift` as the Card draws it, `shadow-lift-lg` for the one
      // open stop.
      style={{
        ...(borderColor ? { borderColor } : {}),
        shadowColor: "#0b2545",
        shadowOpacity: emphasis ? 0.12 : 0.08,
        shadowRadius: emphasis ? 20 : 12,
        shadowOffset: { width: 0, height: emphasis ? 12 : 8 },
        elevation: emphasis ? 4 : 2,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${when}, ${booking.paxName}, ${addressText(booking)}`}
        testID={`job-card-${booking.ref}`}
        onPress={() => router.push(taskHref(target))}
        className="gap-3 rounded-t-xl p-4 active:bg-muted/40"
      >
        <View className="flex-row items-start justify-between gap-3">
          <View className="min-w-0 flex-1">
            {/* The clock leads. A driver plans the day by time and only then
                asks which stop this is. */}
            {dayLabel ? (
              <Text
                weight="semibold"
                className="text-xs uppercase tracking-wide text-warning-foreground"
              >
                {dayLabel}
              </Text>
            ) : null}
            <Text
              face="display"
              weight="semibold"
              className={`text-navy-800 ${emphasis ? "text-xl" : "text-lg"}`}
            >
              {when}
            </Text>
            <Text weight="medium" numberOfLines={1} className="text-base text-foreground">
              {booking.paxName}
            </Text>
          </View>
          <View className="shrink-0 flex-row items-start gap-2">
            <View className="items-end gap-1.5">
              {/* The ref is verification, not metadata: a driver reads it back
                  to a customer to prove they are the person expected, so it
                  gets the seal's colour and a line of its own. */}
              <BookingRef value={booking.ref} />
              <View className="flex-row flex-wrap items-center justify-end gap-2">
                {job.state === "cancelled" ? (
                  <Badge variant="secondary">Cancelled</Badge>
                ) : null}
                {job.state === "problem" ? <ProblemBadge /> : null}
                {job.state === "active" ? (
                  <Badge variant="warning">In progress</Badge>
                ) : null}
                {/* A cancelled stop is never "Late". Its window passing is not
                    a thing anybody needs to chase. */}
                {late &&
                job.state !== "problem" &&
                job.state !== "active" &&
                job.state !== "cancelled" ? (
                  <Badge variant="warning">Late</Badge>
                ) : null}
                {job.state === "done" ? <Badge variant="success">Done</Badge> : null}
              </View>
            </View>
            {/* Centred against the ref pill rather than the whole stack: a
                disclosure chevron belongs beside the first line. */}
            <View className="mt-0.5">
              <ChevronRight size={20} color={MUTED} />
            </View>
          </View>
        </View>

        <View className="flex-row items-start gap-2">
          <View className="mt-0.5">
            <MapPin size={16} color={MUTED} />
          </View>
          <Text className="min-w-0 flex-1 text-sm text-muted-foreground">
            {addressText(booking)}
          </Text>
        </View>

        <View className="gap-2 border-t border-border pt-3">
          {job.phases.map((phase) => (
            <PhaseRow
              key={phase.taskId}
              phase={phase}
              isNext={job.next?.taskId === phase.taskId}
            />
          ))}
        </View>

        <Text className="text-xs text-muted-foreground">
          {booking.bagCount} bag{booking.bagCount === 1 ? "" : "s"} ·{" "}
          {booking.flightNumber} · {booking.departureAirport}
        </Text>
      </Pressable>

      {/* Outside the Pressable, so tapping Navigate does not also open the job.
          NO ACTIONS ON A CANCELLED STOP: Navigate and Call are both offers to
          do the job, and the job is not happening — core refuses every action
          for a terminal standing, so the only thing an affordance here could
          produce is a wasted drive. */}
      {job.state !== "done" && job.state !== "cancelled" ? (
        <View className="border-t border-border p-4 pt-3">
          <JobActions booking={booking} startsPickupTaskId={startsPickupTaskId} />
        </View>
      ) : null}
    </Card>
  );
}

/**
 * The destructive Badge with its alert glyph. `Badge` wraps its children in
 * one `Text`, and an icon inside a `Text` is an inline view whose baseline
 * Android gets wrong, so the badge's own classes are repeated here around a
 * row instead.
 */
function ProblemBadge() {
  return (
    <View className="flex-row items-center gap-1 self-start rounded-md border border-transparent bg-destructive px-2 py-0.5">
      <CircleAlert size={12} color={ON_STATUS} />
      <Text weight="medium" className="text-xs text-destructive-foreground">
        Problem
      </Text>
    </View>
  );
}
