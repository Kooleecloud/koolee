import Link from "next/link";
import { redirect } from "next/navigation";
import { format } from "date-fns";
import {
  Badge,
  Button,
  ContentColumn,
  DatabaseNotConfigured,
  EmptyState,
  PageHeader,
} from "@koolee/ui";
import { listAssignedTasks, type PickupTask, type VerificationTask } from "@koolee/core";

import { EnvStatus } from "@/components/env-status";
import { tryGetCore } from "@/lib/core";
import { getAgentSession } from "@/lib/session";

export const dynamic = "force-dynamic";

type Row =
  { kind: "verification"; task: VerificationTask } | { kind: "pickup"; task: PickupTask };

/** Agent home: TODAY's visits, in pickup-window order — the shift at a glance. */
export default async function AgentHomePage() {
  const session = await getAgentSession();
  if (!session) redirect("/login");

  const core = tryGetCore();
  let today: Row[] = [];
  let unavailable = core === null;

  if (core) {
    try {
      const tasks = await listAssignedTasks(core.db, session.userId);
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      const endOfToday = new Date(startOfToday);
      endOfToday.setDate(endOfToday.getDate() + 1);

      today = [
        ...tasks.verification.map((task) => ({ kind: "verification" as const, task })),
        ...tasks.pickup.map((task) => ({ kind: "pickup" as const, task })),
      ]
        .filter(({ task }) => {
          if (!task.scheduledStart) return task.status !== "done";
          return task.scheduledStart >= startOfToday && task.scheduledStart < endOfToday;
        })
        .sort(
          (a, b) =>
            (a.task.scheduledStart?.getTime() ?? Infinity) -
            (b.task.scheduledStart?.getTime() ?? Infinity),
        );
    } catch {
      unavailable = true;
    }
  }

  return (
    <ContentColumn>
      <PageHeader
        title="Today"
        subtitle="Your visits, in pickup-window order. Verify, seal, photograph — then hand off for delivery to the airline's bag drop."
      />

      {unavailable ? (
        <DatabaseNotConfigured />
      ) : today.length === 0 ? (
        <EmptyState
          title="Nothing scheduled today"
          description="Visits assigned to you will show up here in pickup-window order."
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {today.map(({ kind, task }) => (
            <li key={`${kind}-${task.id}`}>
              <Link
                href={`/tasks/${task.id}?kind=${kind}`}
                className="flex items-start justify-between gap-3 rounded-lg border border-border bg-white p-4 shadow-xs transition-colors hover:bg-accent/10"
              >
                <span className="flex flex-col gap-1">
                  <span className="font-medium">
                    {kind === "verification" ? "Verify and seal" : "Collect and deliver"}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {task.scheduledStart
                      ? format(task.scheduledStart, "h:mm a")
                      : "Unscheduled"}
                    {task.scheduledEnd ? `–${format(task.scheduledEnd, "h:mm a")}` : ""}
                  </span>
                </span>
                <Badge
                  variant={
                    task.status === "done"
                      ? "success"
                      : task.status === "failed"
                        ? "destructive"
                        : task.status === "in_progress"
                          ? "warning"
                          : "secondary"
                  }
                >
                  {task.status.replace("_", " ")}
                </Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-3 sm:flex-row">
        <Button asChild variant="outline">
          <Link href="/tasks">All my tasks</Link>
        </Button>
      </div>

      <EnvStatus appName="agent" />
    </ContentColumn>
  );
}
