import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Badge,
  Button,
  Card,
  ContentColumn,
  DatabaseNotConfigured,
  EmptyState,
  PageHeader,
} from "@koolee/ui";
import {
  airportLocalDayBounds,
  formatHourRangeInAirportTz,
  formatInstantInAirportTz,
  listAssignedTasks,
  type PickupTask,
  type VerificationTask,
} from "@koolee/core";

import { EnvStatus } from "@/components/env-status";
import { tryGetCore } from "@/lib/core";
import { getAgentSession } from "@/lib/session";

export const dynamic = "force-dynamic";

type Row =
  | { kind: "verification"; task: VerificationTask; tz: string }
  | { kind: "pickup"; task: PickupTask; tz: string };

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
      const now = new Date();

      today = [
        ...tasks.verification.map((row) => ({ kind: "verification" as const, ...row })),
        ...tasks.pickup.map((row) => ({ kind: "pickup" as const, ...row })),
      ]
        .filter(({ task, tz }) => {
          if (!task.scheduledStart) return task.status !== "done";
          // "Today" means today AT THE AIRPORT, per task. `setHours(0,0,0,0)`
          // was server-local, and production runs in UTC — which starts the
          // agent's day at 8 PM the previous evening and drops the real
          // morning's visits off this list.
          const { start, end } = airportLocalDayBounds(now, tz);
          return task.scheduledStart >= start && task.scheduledStart < end;
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
          {today.map(({ kind, task, tz }) => (
            <li key={`${kind}-${task.id}`}>
              <Card asChild interactive>
                <Link
                  href={`/tasks/${task.id}?kind=${kind}`}
                  className="flex items-start justify-between gap-3 p-4"
                >
                  <span className="flex flex-col gap-1">
                    <span className="font-medium">
                      {kind === "verification"
                        ? "Verify and seal"
                        : "Collect and deliver"}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {task.scheduledStart
                        ? task.scheduledEnd
                          ? formatHourRangeInAirportTz(
                              task.scheduledStart,
                              task.scheduledEnd,
                              tz,
                            )
                          : formatInstantInAirportTz(task.scheduledStart, tz)
                        : "Unscheduled"}
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
              </Card>
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
