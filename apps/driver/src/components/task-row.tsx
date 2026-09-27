import { View } from "react-native";
import { MapPin } from "lucide-react-native";
import type { TaskBookingContext } from "@koolee/api-contract";

import { Badge, Card, Text } from "@/components/ui";
import { formatHour, formatHourRange, iso } from "@/lib/time";

/**
 * A minimal job row for phase 3 — enough to see the assignment on the phone.
 * Phase 4 replaces it with the JobCard / JourneyList port.
 */
export function TaskRow({
  kind,
  status,
  scheduledStart,
  scheduledEnd,
  tz,
  booking,
}: {
  kind: "verification" | "pickup";
  status: string;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  tz: string;
  booking: TaskBookingContext;
}) {
  const when = scheduledStart
    ? scheduledEnd
      ? formatHourRange(iso(scheduledStart), iso(scheduledEnd), tz)
      : formatHour(iso(scheduledStart), tz)
    : "Unscheduled";
  const badge =
    status === "done" ? (
      <Badge variant="success">Done</Badge>
    ) : status === "failed" ? (
      <Badge variant="destructive">Problem</Badge>
    ) : status === "in_progress" ? (
      <Badge variant="warning">In progress</Badge>
    ) : null;
  return (
    <Card className="gap-2 p-4">
      <View className="flex-row items-start justify-between gap-3">
        <View className="flex-1 gap-0.5">
          <Text face="display" weight="semibold" className="text-lg text-navy-800">
            {when}
          </Text>
          <Text weight="medium" className="text-base text-foreground" numberOfLines={1}>
            {booking.paxName}
          </Text>
        </View>
        <View className="items-end gap-1">
          <View className="rounded-md bg-tag-400 px-2.5 py-1">
            <Text face="mono" weight="semibold" className="text-sm text-navy-800">
              {booking.ref}
            </Text>
          </View>
          {badge}
        </View>
      </View>
      <View className="flex-row items-center gap-1.5">
        <MapPin size={14} color="#6b7a90" />
        <Text className="text-sm text-muted-foreground" numberOfLines={1}>
          {booking.addressLine1}, {booking.addressCity}
        </Text>
      </View>
      <Text className="text-xs text-muted-foreground">
        {kind === "verification" ? "Verify & seal" : "Collect & deliver"} ·{" "}
        {booking.bagCount} bag{booking.bagCount === 1 ? "" : "s"} · {booking.flightNumber}{" "}
        · {booking.departureAirport}
      </Text>
    </Card>
  );
}
