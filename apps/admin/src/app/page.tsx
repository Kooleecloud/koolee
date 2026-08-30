import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Badge,
  BookingStatusBadge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DatabaseNotConfigured,
  PageHeader,
} from "@koolee/ui";
import {
  formatHourRangeInAirportTz,
  formatTimeInAirportTz,
  listAgentWorkload,
  listBookingsBoard,
  type AgentWorkload,
  type BoardRow,
} from "@koolee/core";

import { ConsoleMain } from "@/components/console";
import { OPS_CONSOLE_TZ } from "@/lib/airport-tz";
import { getConsoleDashboard } from "@/lib/console-dashboard";
import { tryGetCore } from "@/lib/core";
import { getAdminSession } from "@/lib/session";
import { NotificationsCard } from "./notifications-card";

export const dynamic = "force-dynamic";

/** How many upcoming windows the shift strip shows before it stops being a glance. */
const NEXT_UP_LIMIT = 6;

/**
 * A number and what it counts. The number leads because that is what an
 * operator reads across the row; the caption qualifies it.
 */
function StatCard({
  value,
  caption,
  action,
  children,
  tone,
}: {
  value: number;
  caption: string;
  action?: React.ReactNode;
  /** Breakdown or detail under the caption. */
  children?: React.ReactNode;
  tone?: "warning" | "destructive";
}) {
  return (
    <Card
      className={
        tone === "destructive"
          ? "border-destructive"
          : tone === "warning"
            ? "border-warning"
            : undefined
      }
    >
      <CardHeader>
        <CardTitle className="font-display text-3xl font-semibold tabular-nums">
          {value}
        </CardTitle>
        <CardDescription>{caption}</CardDescription>
      </CardHeader>
      {children || action ? (
        <CardContent className="flex flex-col items-start gap-3">
          {children}
          {action}
        </CardContent>
      ) : null}
    </Card>
  );
}

/**
 * Ops landing: today's real numbers — nothing here is hardcoded.
 *
 * Three counts, then the two questions a dispatcher actually opens this page
 * to answer: what is coming up in the next few hours, and who is free to take
 * it. Both were previously only answerable by leaving for the board and
 * reading it by eye.
 */
export default async function AdminHomePage() {
  const session = await getAdminSession();
  if (!session) redirect("/login");

  const core = tryGetCore();
  // Shared with the rail's count badges — `cache()` makes this one query.
  const dashboard = await getConsoleDashboard();

  const now = new Date();
  let upcoming: BoardRow[] = [];
  let workload: AgentWorkload[] = [];

  if (core) {
    // Both degrade to their own empty states; neither is worth failing the
    // landing page over.
    [upcoming, workload] = await Promise.all([
      listBookingsBoard(
        core.db,
        {
          day: { on: now, tz: OPS_CONSOLE_TZ },
          sort: { key: "window", direction: "asc" },
          limit: 50,
        },
        // Beyond the horizon a booking is unassigned by design, not at risk.
        { now, assignmentHorizonHours: core.defaults.assignmentHorizonHours },
      ).catch(() => []),
      listAgentWorkload(core.db, { on: now, tz: OPS_CONSOLE_TZ }).catch(() => []),
    ]);
  }

  // "Next up" means still ahead of us: a window that has already closed is
  // history, and history belongs on the board, not on the shift strip.
  const nextUp = upcoming
    .filter((row) => {
      const end = row.booking.pickupWindowEnd ?? row.slotStart;
      return end !== null && end.getTime() >= now.getTime();
    })
    .slice(0, NEXT_UP_LIMIT);

  const todayTotal =
    dashboard?.todayByStatus.reduce((sum, row) => sum + row.count, 0) ?? 0;
  const busiest = Math.max(1, ...workload.map((agent) => agent.openTasks));

  return (
    <ConsoleMain>
      <PageHeader
        title="Operations"
        subtitle={
          core
            ? `Today's pickups, assignments, and anything that needs a human. Day boundary: ${OPS_CONSOLE_TZ.replace("_", " ")}.`
            : "Today's pickups, assignments, and anything that needs a human."
        }
      />

      {!core || !dashboard ? (
        <DatabaseNotConfigured />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard value={todayTotal} caption="bookings with a pickup window today">
              {dashboard.todayByStatus.length > 0 && (
                /* Friendly labels via BookingStatusBadge — the same rendering
                   the board and the customer's trip page use. This card used
                   to print raw enum keys (`agent_assigned`), which meant the
                   landing page and the board named the same state two
                   different ways. */
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                  {dashboard.todayByStatus.map((row) => (
                    <span key={row.status} className="inline-flex items-center gap-1">
                      <BookingStatusBadge status={row.status} />
                      <span className="text-xs font-medium tabular-nums text-muted-foreground">
                        {row.count}
                      </span>
                    </span>
                  ))}
                </div>
              )}
            </StatCard>

            <StatCard
              value={dashboard.unassignedToday}
              caption="paid today, no agent assigned"
              tone={dashboard.unassignedToday > 0 ? "warning" : undefined}
              action={
                dashboard.unassignedToday > 0 ? (
                  <Button asChild size="sm" variant="outline">
                    <Link href="/bookings?status=paid&today=1">Assign now</Link>
                  </Button>
                ) : undefined
              }
            />

            <StatCard
              value={dashboard.awaitingDriverToday}
              caption="sealed today, no driver on it"
              tone={dashboard.awaitingDriverToday > 0 ? "warning" : undefined}
              action={
                dashboard.awaitingDriverToday > 0 ? (
                  <Button asChild size="sm" variant="outline">
                    <Link href="/shifts">Shifts</Link>
                  </Button>
                ) : undefined
              }
            />

            <StatCard
              value={dashboard.exceptionsOpen}
              caption="exceptions open"
              tone={dashboard.exceptionsOpen > 0 ? "destructive" : undefined}
              action={
                dashboard.exceptionsOpen > 0 ? (
                  <Button asChild size="sm" variant="outline">
                    <Link href="/exceptions">Review</Link>
                  </Button>
                ) : undefined
              }
            />
          </div>

          <div className="grid items-start gap-6 lg:grid-cols-[1.6fr_1fr]">
            <Card>
              <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
                <div className="flex flex-col gap-1.5">
                  <CardTitle className="text-base">Next up</CardTitle>
                  <CardDescription>
                    Today&apos;s remaining pickup windows, earliest first. Times are
                    airport-local.
                  </CardDescription>
                </div>
                <Button asChild size="sm" variant="outline">
                  <Link href="/bookings?today=1">Full board</Link>
                </Button>
              </CardHeader>
              <CardContent>
                {nextUp.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Nothing left today. Tomorrow&apos;s windows are on the board.
                  </p>
                ) : (
                  <ul className="flex flex-col divide-y divide-border">
                    {nextUp.map(
                      ({
                        booking,
                        slotStart,
                        assigneeName,
                        assigneeEmail,
                        atRisk,
                        tz,
                      }) => (
                        <li key={booking.id} className="py-3 first:pt-0 last:pb-0">
                          <Link
                            href={`/bookings/${booking.id}`}
                            className="-mx-2 flex items-center justify-between gap-4 rounded-md px-2 py-1 transition-colors hover:bg-accent/5 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <span className="flex min-w-0 flex-col leading-tight">
                              <span className="truncate text-sm font-medium">
                                <span className="font-mono text-xs">{booking.ref}</span>
                                {" · "}
                                {booking.flightNumber} · {booking.departureAirport}
                              </span>
                              <span className="truncate text-xs text-muted-foreground">
                                {slotStart && booking.pickupWindowEnd
                                  ? formatHourRangeInAirportTz(
                                      slotStart,
                                      booking.pickupWindowEnd,
                                      tz,
                                    )
                                  : slotStart
                                    ? formatTimeInAirportTz(slotStart, tz)
                                    : "Unscheduled"}
                                {" · "}
                                {assigneeName ?? assigneeEmail ?? "unassigned"}
                              </span>
                            </span>
                            <span className="flex shrink-0 items-center gap-2">
                              {atRisk && <Badge variant="warning">at risk</Badge>}
                              <BookingStatusBadge status={booking.status} />
                            </span>
                          </Link>
                        </li>
                      ),
                    )}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Coverage today</CardTitle>
                <CardDescription>
                  Open verification and pickup tasks per active agent. An agent with
                  nothing on is who dispatch is looking for.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {workload.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No active agents.{" "}
                    <Link
                      href="/staff"
                      className="text-primary underline-offset-4 hover:underline"
                    >
                      Invite one
                    </Link>
                    .
                  </p>
                ) : (
                  <ul className="flex flex-col gap-3">
                    {workload.map((agent) => (
                      <li key={agent.userId} className="flex flex-col gap-1.5">
                        <div className="flex items-baseline justify-between gap-3 text-sm">
                          <span className="min-w-0 truncate">
                            {agent.fullName ?? agent.email ?? agent.userId}
                          </span>
                          <span className="shrink-0 tabular-nums text-muted-foreground">
                            {agent.openTasks} open
                          </span>
                        </div>
                        <div
                          className="h-1.5 w-full overflow-hidden rounded-full bg-navy-50"
                          role="img"
                          aria-label={`${agent.openTasks} open tasks`}
                        >
                          <div
                            className="h-full rounded-full bg-sky-400"
                            style={{ width: `${(agent.openTasks / busiest) * 100}%` }}
                          />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Last: configured once, then never looked at again. */}
          <NotificationsCard />
        </>
      )}
    </ConsoleMain>
  );
}
