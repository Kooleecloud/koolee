import Link from "next/link";
import { redirect } from "next/navigation";
import { Truck } from "lucide-react";
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
  getLaunchReadiness,
  listBookingsBoard,
  listShifts,
  type BoardRow,
  type LaunchReadiness,
  type ShiftRow,
} from "@koolee/core";

import { ConsoleMain } from "@/components/console";
import { OPS_CONSOLE_TZ } from "@/lib/airport-tz";
import { buildAttention } from "@/lib/attention";
import { getConsoleDashboard } from "@/lib/console-dashboard";
import { tryGetCore } from "@/lib/core";
import { getAdminSession } from "@/lib/session";
import { AttentionPanel } from "./attention-panel";
import { ReadinessPanel } from "./readiness-panel";

export const dynamic = "force-dynamic";

/** How many upcoming windows the strip shows before it stops being a glance. */
const NEXT_UP_LIMIT = 6;

/**
 * The console's landing page: what needs a human, then what is happening.
 *
 * WHAT IT USED TO BE, and why that failed. Four stat cards — bookings today,
 * unassigned, awaiting a driver, exceptions — over "Next up" and a per-agent
 * bar chart. On an ordinary day three of the four read `0`, a fourth card
 * orphaned itself onto a second row of a three-column grid, "Next up" said
 * "Nothing left today" inside a full-height card, and the bar chart listed
 * eight agents of whom seven had an empty bar.
 *
 * The result was a page whose SHAPE was identical whether everything was fine
 * or the fleet was on fire. Only the digits differed, so an operator had to
 * read four numbers to find out there was nothing to do, and the parts that
 * were fine took exactly as much room as the parts that were not.
 *
 * THE RULE NOW: nothing that is fine takes any space. The attention panel is
 * the first thing and is usually one green line; when it is not, its LENGTH is
 * the signal. Below it, only what is actually happening — today's remaining
 * windows and who is on the road. A readiness block sits between them while
 * the product cannot yet sell, and removes itself when it can.
 *
 * Three things were deliberately cut rather than moved: the per-agent bar
 * chart (seven empty bars ranked as loudly as the one that mattered), the
 * desktop-notifications card (configured once, then never looked at — it lives
 * in the settings sheet now, beside the profile), and the today-by-status
 * badge row (a fact about the day, not an action; the board has it with
 * filters).
 */
export default async function OpsHome() {
  const session = await getAdminSession();
  if (!session) redirect("/login");

  const core = tryGetCore();
  const now = new Date();

  const dashboard = await getConsoleDashboard();

  let today: BoardRow[] = [];
  let shifts: ShiftRow[] = [];
  let readiness: LaunchReadiness | null = null;

  if (core) {
    /*
     * All three degrade to their own empty state. A landing page an operator
     * opened to deal with an exception must not be taken down by the query
     * that draws the shift strip.
     */
    [today, shifts, readiness] = await Promise.all([
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
      listShifts(core.db, { limit: 20 }).catch(() => []),
      getLaunchReadiness(core.db).catch(() => null),
    ]);
  }

  const openShifts = shifts.filter((shift) => shift.endedAt === null);

  // "Next up" means still ahead of us: a window that has closed is history,
  // and history belongs on the board.
  const nextUp = today
    .filter((row) => {
      const end = row.booking.pickupWindowEnd ?? row.slotStart;
      return end !== null && end.getTime() >= now.getTime();
    })
    .slice(0, NEXT_UP_LIMIT);

  const todayTotal =
    dashboard?.todayByStatus.reduce((sum, row) => sum + row.count, 0) ?? 0;

  /*
   * The calm line's second sentence. Facts, not counters — it exists so
   * "nothing needs you" is not the only thing on a quiet screen, and so an
   * operator can confirm the console is actually looking at today.
   */
  const summary = [
    `${todayTotal} ${todayTotal === 1 ? "pickup" : "pickups"} today`,
    `${openShifts.length} ${openShifts.length === 1 ? "driver" : "drivers"} out`,
  ].join(" · ");

  const attention =
    dashboard && readiness
      ? buildAttention({ dashboard, readiness, today, openShifts })
      : [];

  return (
    <ConsoleMain>
      <PageHeader
        title="Operations"
        subtitle={
          core
            ? `Day boundary: ${OPS_CONSOLE_TZ.replace("_", " ")}.`
            : "Today's pickups, assignments, and anything that needs a human."
        }
      />

      {!core || !dashboard ? (
        <DatabaseNotConfigured />
      ) : (
        <>
          <AttentionPanel items={attention} summary={summary} />

          {readiness && <ReadinessPanel readiness={readiness} />}

          <div className="grid items-start gap-6 lg:grid-cols-[1.5fr_1fr]">
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
                    {todayTotal === 0
                      ? "Nothing booked for today."
                      : "Every window today has passed. Tomorrow's are on the board."}
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

            {/*
              WHO IS ACTUALLY ON THE ROAD. This existed only on `/shifts`, so
              the landing page could tell you two bookings were waiting on a
              driver and not that there was nobody driving — the two halves of
              one question, on two pages.

              Load, not capacity: "4 of 12" answers "can they take another
              one", which is what a dispatcher looking at this is deciding.
            */}
            <Card>
              <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
                <div className="flex flex-col gap-1.5">
                  <CardTitle className="text-base">On the road</CardTitle>
                  <CardDescription>Open shifts, and what is in each van.</CardDescription>
                </div>
                <Button asChild size="sm" variant="outline">
                  <Link href="/shifts">Shifts</Link>
                </Button>
              </CardHeader>
              <CardContent>
                {openShifts.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Nobody is out right now.{" "}
                    <Link
                      href="/shifts"
                      className="text-primary underline-offset-4 hover:underline"
                    >
                      Start a shift
                    </Link>
                    .
                  </p>
                ) : (
                  <ul className="flex flex-col gap-3">
                    {openShifts.map((shift) => (
                      <li key={shift.shiftId} className="flex items-center gap-3">
                        <Truck
                          aria-hidden="true"
                          className="size-4 shrink-0 text-muted-foreground"
                        />
                        <span className="flex min-w-0 flex-col leading-tight">
                          <span className="truncate text-sm font-medium">
                            {shift.staffName ?? shift.staffEmail ?? "A driver"}
                          </span>
                          <span className="truncate text-xs text-muted-foreground">
                            {shift.truckName} · since{" "}
                            {formatTimeInAirportTz(shift.startedAt, OPS_CONSOLE_TZ)}
                          </span>
                        </span>
                        <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
                          {shift.bagsOnBoard} / {shift.bagCapacity} bags
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </ConsoleMain>
  );
}
