import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Badge,
  ContentColumn,
  DatabaseNotConfigured,
  EmptyState,
  PageHeader,
} from "@koolee/ui";
import {
  formatInstantInAirportTz,
  listAssignedTasks,
  type PickupTask,
  type VerificationTask,
} from "@koolee/core";

import { tryGetCore } from "@/lib/core";
import { getAgentSession } from "@/lib/session";

export const metadata = { title: "My tasks" };
export const dynamic = "force-dynamic";

type Row =
  | { kind: "verification"; task: VerificationTask; tz: string }
  | { kind: "pickup"; task: PickupTask; tz: string };

export default async function TasksPage() {
  // The role gate: only an active `agent` staff session sees a task list —
  // and only its OWN tasks (listAssignedTasks scopes by assignee).
  const session = await getAgentSession();
  if (!session) redirect("/login");

  const core = tryGetCore();

  let rows: Row[] = [];
  let unavailable = core === null;

  if (core) {
    try {
      const tasks = await listAssignedTasks(core.db, session.userId);
      rows = [
        ...tasks.verification.map((row) => ({ kind: "verification" as const, ...row })),
        ...tasks.pickup.map((row) => ({ kind: "pickup" as const, ...row })),
        // Sorted by absolute instant, never by rendered local time: with more
        // than one airport in the list, a 9 AM Pacific visit would otherwise
        // sort above a 10 AM Eastern one that happens three hours earlier.
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
    <ContentColumn>
      <PageHeader title="My tasks" />
      {unavailable ? (
        <DatabaseNotConfigured />
      ) : rows.length === 0 ? (
        <EmptyState
          title="Nothing assigned"
          description="Verification and pickup tasks assigned to you will appear here."
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map(({ kind, task, tz }) => (
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
                      ? formatInstantInAirportTz(task.scheduledStart, tz)
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
