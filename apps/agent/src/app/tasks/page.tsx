import Link from "next/link";
import { format } from "date-fns";
import {
  Badge,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  ContentColumn,
  DatabaseNotConfigured,
  EmptyState,
  PageHeader,
} from "@koolee/ui";
import { listAssignedTasks, type PickupTask, type VerificationTask } from "@koolee/core";

import { tryGetCore } from "@/lib/core";
import { tryGetAgentSession } from "@/lib/session";

export const metadata = { title: "My tasks" };
export const dynamic = "force-dynamic";

type Row =
  { kind: "verification"; task: VerificationTask } | { kind: "pickup"; task: PickupTask };

export default async function TasksPage() {
  const sessionResult = await tryGetAgentSession();
  if ("error" in sessionResult) {
    return (
      <ContentColumn width="narrow">
        <PageHeader title="My tasks" />
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="text-base">Not signed in</CardTitle>
            <CardDescription>{sessionResult.error}</CardDescription>
          </CardHeader>
        </Card>
      </ContentColumn>
    );
  }

  const session = sessionResult.session;
  const core = tryGetCore();

  let rows: Row[] = [];
  let unavailable = core === null;

  if (core && session) {
    try {
      const tasks = await listAssignedTasks(core.db, session.userId);
      rows = [
        ...tasks.verification.map((task) => ({ kind: "verification" as const, task })),
        ...tasks.pickup.map((task) => ({ kind: "pickup" as const, task })),
      ].sort(
        (a, b) =>
          (a.task.scheduledStart?.getTime() ?? Infinity) -
          (b.task.scheduledStart?.getTime() ?? Infinity),
      );
    } catch {
      unavailable = true;
    }
  }

  return (
    <ContentColumn width="narrow">
      <PageHeader title="My tasks" />
      {unavailable ? (
        <DatabaseNotConfigured />
      ) : rows.length === 0 ? (
        <EmptyState
          title="Nothing assigned"
          description="Verification and pickup tasks assigned to you will appear here."
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map(({ kind, task }) => (
            <li key={`${kind}-${task.id}`}>
              <Link
                href={`/tasks/${task.id}?kind=${kind}`}
                className="flex items-start justify-between gap-3 rounded-lg border p-4 transition-colors hover:bg-accent/10"
              >
                <span className="flex flex-col gap-1">
                  <span className="font-medium">
                    {kind === "verification" ? "Verify and seal" : "Collect and deliver"}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {task.scheduledStart
                      ? format(task.scheduledStart, "EEE d MMM, h:mm a")
                      : "Unscheduled"}
                  </span>
                </span>
                <Badge variant={task.status === "done" ? "success" : "secondary"}>
                  {task.status}
                </Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </ContentColumn>
  );
}
