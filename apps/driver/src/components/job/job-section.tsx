import { View } from "react-native";

import { Text } from "@/components/ui";
import { startablePickupTaskId, type Job } from "@/lib/job";

import { JobCard } from "./job-card";

/**
 * A headed list of stops that is NOT the route.
 *
 * Three sections on Today have the same shape — needs attention, no time set,
 * running late — and every section on the Schedule does too; none of them is
 * an ordered sequence, which is the one thing `JourneyList` exists to draw.
 * Sharing a component keeps them visually identical to each other and visibly
 * different from the route, which is the distinction a driver is actually
 * reading for.
 *
 * Today's `JobSection` and the Schedule's `Section` on the web differ in two
 * ways, both props here: the Schedule colours its headings by tone, and only
 * Today hands each card the pickup it would start (Navigate on a future day's
 * stop must not start a leg).
 */
export type SectionTone = "muted" | "alarm" | "now";

const TONE: Record<SectionTone, string> = {
  muted: "text-muted-foreground",
  alarm: "text-destructive",
  now: "text-navy-800",
};

export interface JobSectionProps {
  title: string;
  tone?: SectionTone;
  jobs: readonly Job[];
  /** Today only: let Navigate start the pickup it is navigating to. */
  startable?: boolean;
  testID?: string;
}

export function JobSection({
  title,
  tone = "muted",
  jobs,
  startable = false,
  testID,
}: JobSectionProps) {
  if (jobs.length === 0) return null;
  return (
    <View className="gap-2" testID={testID}>
      <Text
        accessibilityRole="header"
        weight="semibold"
        className={`text-xs uppercase tracking-wider ${TONE[tone]}`}
      >
        {title}
      </Text>
      <View className="gap-3">
        {jobs.map((job) => (
          <JobCard
            key={job.bookingId}
            job={job}
            startsPickupTaskId={startable ? startablePickupTaskId(job) : null}
          />
        ))}
      </View>
    </View>
  );
}
