import * as React from "react";
import { View } from "react-native";

import { ShiftCard } from "@/components/shift/shift-card";
import { TaskRow } from "@/components/task-row";
import { Card, CardDescription, CardHeader, CardTitle, Text } from "@/components/ui";
import { Screen } from "@/components/ui";
import { useTasks } from "@/lib/queries";

const OPEN = new Set(["pending", "assigned", "in_progress"]);

export default function TodayScreen() {
  const tasks = useTasks();
  const rows = React.useMemo(() => {
    const data = tasks.data;
    if (!data) return [];
    const all = [
      ...data.verification.map((r) => ({ kind: "verification" as const, ...r })),
      ...data.pickup.map((r) => ({ kind: "pickup" as const, ...r })),
    ].filter((r) => OPEN.has(r.task.status));
    all.sort((a, b) =>
      (a.task.scheduledStart ?? "9").localeCompare(b.task.scheduledStart ?? "9"),
    );
    return all;
  }, [tasks.data]);

  return (
    <Screen refreshing={tasks.isRefetching} onRefresh={() => void tasks.refetch()}>
      <View className="gap-1">
        <Text face="display" weight="semibold" className="text-3xl text-navy-800">
          Today
        </Text>
        <Text className="text-sm text-muted-foreground">
          {tasks.isLoading
            ? "Loading your jobs…"
            : rows.length === 0
              ? "Nothing assigned for today."
              : `${rows.length} to do`}
        </Text>
      </View>
      <ShiftCard />
      {tasks.isError ? (
        <Card>
          <CardHeader>
            <CardTitle>Can't reach the server</CardTitle>
            <CardDescription>Pull down to try again.</CardDescription>
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
      {!tasks.isLoading && rows.length === 0 && !tasks.isError ? (
        <Card>
          <CardHeader>
            <CardTitle>Nothing today</CardTitle>
            <CardDescription>
              When ops assigns you a pickup it shows up here.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : null}
    </Screen>
  );
}
