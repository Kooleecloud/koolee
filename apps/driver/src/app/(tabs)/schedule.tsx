import * as React from "react";
import { View } from "react-native";

import { TaskRow } from "@/components/task-row";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  Screen,
  Text,
} from "@/components/ui";
import { useTasks } from "@/lib/queries";

export default function ScheduleScreen() {
  const tasks = useTasks();
  const rows = React.useMemo(() => {
    const data = tasks.data;
    if (!data) return [];
    const all = [
      ...data.verification.map((r) => ({ kind: "verification" as const, ...r })),
      ...data.pickup.map((r) => ({ kind: "pickup" as const, ...r })),
    ];
    all.sort((a, b) =>
      (b.task.scheduledStart ?? "").localeCompare(a.task.scheduledStart ?? ""),
    );
    return all;
  }, [tasks.data]);

  return (
    <Screen refreshing={tasks.isRefetching} onRefresh={() => void tasks.refetch()}>
      <View className="gap-1">
        <Text face="display" weight="semibold" className="text-3xl text-navy-800">
          Schedule
        </Text>
        <Text className="text-sm text-muted-foreground">
          Everything assigned to you, newest first.
        </Text>
      </View>
      {rows.length === 0 && !tasks.isLoading ? (
        <Card>
          <CardHeader>
            <CardTitle>Nothing assigned</CardTitle>
            <CardDescription>
              Pickups assigned to you show up here as soon as ops schedules them.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}
      {rows.map((r) => (
        <TaskRow
          key={`${r.kind}:${r.task.id}`}
          kind={r.kind}
          status={r.task.status}
          scheduledStart={r.task.scheduledStart}
          scheduledEnd={r.task.scheduledEnd}
          tz={r.tz}
          booking={r.booking}
        />
      ))}
    </Screen>
  );
}
