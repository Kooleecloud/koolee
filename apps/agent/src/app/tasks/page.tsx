import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Badge,
  Card,
  ContentColumn,
  DatabaseNotConfigured,
  EmptyState,
  PageHeader,
} from "@koolee/ui";
import {
  airportLocalDay,
  formatDayInAirportTz,
  formatHourInAirportTz,
  listAssignedTasks,
  type PickupTask,
  type TaskBookingContext,
  type VerificationTask,
} from "@koolee/core";

import { tryGetCore } from "@/lib/core";
import { getAgentSession } from "@/lib/session";

export const metadata = { title: "My tasks" };
export const dynamic = "force-dynamic";

type Row = {
  kind: "verification" | "pickup";
  task: VerificationTask | PickupTask;
  tz: string;
  booking: TaskBookingContext;
};

/**
 * What each kind actually asks of the agent.
 *
 * The two task kinds used to be told apart by their label alone, in otherwise
 * identical tiles — so a queue of six read as six copies of the same thing.
 * The kind now leads the row as a coloured chip with the verb the agent
 * performs, because "am I sealing bags at a door or driving them to a
 * terminal?" is the first question every row has to answer.
 */
const KIND = {
  verification: {
    label: "Verify & seal",
    hint: "at the door",
    chip: "bg-tag-100 text-tag-800 ring-1 ring-tag-200",
  },
  pickup: {
    label: "Collect & deliver",
    hint: "to the bag drop",
    chip: "bg-sky-100 text-sky-800 ring-1 ring-sky-300",
  },
} as const;

/** Status chips: only the states an agent must react to get colour. */
function statusVariant(status: string) {
  if (status === "done") return "success" as const;
  if (status === "failed") return "destructive" as const;
  if (status === "in_progress") return "warning" as const;
  return "secondary" as const;
}

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

  // Grouped into days so the list reads as a shift rather than a pile. The day
  // is the task's OWN airport-local day — an agent working one airport reads
  // their own calendar, and a cross-airport day boundary stays honest.
  const days: { key: string; heading: string; rows: Row[] }[] = [];
  for (const row of rows) {
    const key = row.task.scheduledStart
      ? airportLocalDay(row.task.scheduledStart, row.tz)
      : "unscheduled";
    const last = days.at(-1);
    if (last?.key === key) {
      last.rows.push(row);
      continue;
    }
    days.push({
      key,
      heading: row.task.scheduledStart
        ? formatDayInAirportTz(row.task.scheduledStart, row.tz)
        : "Unscheduled",
      rows: [row],
    });
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
        <div className="flex flex-col gap-6">
          {days.map((day) => (
            <section key={day.key} className="flex flex-col gap-2">
              <h2 className="text-sm font-medium text-muted-foreground">{day.heading}</h2>
              {/* One task per row: these rows carry an address and a name, and
                  a multi-column grid squeezes both into ellipses on the phone
                  this app actually runs on. */}
              <ul className="flex flex-col gap-2">
                {day.rows.map(({ kind, task, tz, booking }) => {
                  const meta = KIND[kind];
                  return (
                    <li key={`${kind}-${task.id}`}>
                      <Card asChild interactive>
                        <Link
                          href={`/tasks/${task.id}?kind=${kind}`}
                          className="flex flex-col gap-2 p-4"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={`rounded-full px-2 py-0.5 text-xs font-medium ${meta.chip}`}
                            >
                              {meta.label}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {meta.hint}
                            </span>
                            <Badge
                              variant={statusVariant(task.status)}
                              className="ml-auto"
                            >
                              {task.status.replace("_", " ")}
                            </Badge>
                          </div>

                          {/* The window leads: an agent plans by clock first,
                            then decides which of the day's stops this is. */}
                          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                            <span className="font-display text-base font-semibold text-navy-800">
                              {task.scheduledStart
                                ? formatHourInAirportTz(task.scheduledStart, tz)
                                : "Unscheduled"}
                            </span>
                            <span className="text-sm font-medium">{booking.paxName}</span>
                            <span className="text-sm text-muted-foreground">
                              · {booking.bagCount} bag{booking.bagCount === 1 ? "" : "s"}
                            </span>
                          </div>

                          <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
                            <span>
                              {booking.addressLine1}, {booking.addressCity}
                            </span>
                            <span>
                              <span className="font-mono">{booking.ref}</span> ·{" "}
                              {booking.flightNumber} · {booking.departureAirport}
                            </span>
                          </div>
                        </Link>
                      </Card>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </ContentColumn>
  );
}
