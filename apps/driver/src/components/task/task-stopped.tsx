import { View } from "react-native";
import { Ban, CircleCheck } from "lucide-react-native";
import type { CANCELLATION_ACTORS } from "@koolee/api-contract";

import { Card, Text } from "@/components/ui";
import { formatInstant, iso } from "@/lib/time";

/**
 * The job is off — the third mode of the task detail screen.
 *
 * Renders when `actionability.standing === "terminal"`: the same computation
 * the day's card consults and the same one core enforces with, not a status
 * array in the screen. The stop stays visible, and `TaskRecord` still
 * renders beneath this — the seals, the timeline, everything that happened
 * before it stopped. This card is the headline; that one is the history.
 */
export interface CancellationView {
  /** ISO instant, rendered in the booking's zone. */
  at: string;
  by: (typeof CANCELLATION_ACTORS)[number];
  reason: string | null;
}

export function TaskStopped({
  kind,
  reason,
  cancellation,
  tz,
  testID = "task-stopped",
}: {
  kind: "verification" | "pickup";
  /** The gate's own sentence — `blockedReason` from the actionability read. */
  reason: string | null;
  /** Present only for a cancelled booking; absent for a completed one. */
  cancellation: CancellationView | null;
  tz: string;
  testID?: string;
}) {
  const cancelled = cancellation !== null;

  return (
    <Card
      testID={testID}
      className={
        cancelled
          ? "flex-row items-start gap-3 border-destructive/40 bg-destructive/5 p-4"
          : "flex-row items-start gap-3 border-success/40 bg-success/5 p-4"
      }
    >
      <View className="mt-0.5">
        {cancelled ? (
          <Ban size={20} color="#dc2828" />
        ) : (
          <CircleCheck size={20} color="#199446" />
        )}
      </View>
      <View className="flex-1 gap-1">
        <Text weight="medium" className="text-base text-foreground">
          {cancelled
            ? kind === "pickup"
              ? "This pickup was cancelled."
              : "This visit was cancelled."
            : "This booking is complete."}
        </Text>
        {/* WHO CANCELLED IT: "the customer called it off" is a closed loop,
            and "ops cancelled it" is something the driver may need to ask
            about — and they cannot ask without knowing. */}
        {cancellation ? (
          <Text className="text-sm text-muted-foreground">
            Cancelled by {cancellation.by === "customer" ? "the customer" : "ops"} ·{" "}
            {formatInstant(iso(cancellation.at), tz)}
          </Text>
        ) : null}
        {cancellation?.reason ? (
          <Text className="text-sm text-muted-foreground">
            Reason: {cancellation.reason}
          </Text>
        ) : null}
        {/* The gate's own sentence, when it adds something the lines above
            do not already say. Never a second copy of "this was cancelled". */}
        {reason && !cancelled ? (
          <Text className="text-sm text-muted-foreground">{reason}</Text>
        ) : null}
        <Text className="text-sm text-muted-foreground">
          Nothing to do here. If somebody is expecting you at this address, call ops
          before you go.
        </Text>
      </View>
    </Card>
  );
}
