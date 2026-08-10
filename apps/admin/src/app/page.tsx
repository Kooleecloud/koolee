import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ContentColumn,
  PageHeader,
} from "@koolee/ui";
import { getOpsDashboard, type OpsDashboard } from "@koolee/core";

import { EnvStatus } from "@/components/env-status";
import { AIRPORT_TZ } from "@/lib/airport-tz";
import { tryGetCore } from "@/lib/core";
import { getAdminSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Ops landing: today's real numbers — nothing here is hardcoded. */
export default async function AdminHomePage() {
  const session = await getAdminSession();
  if (!session) redirect("/login");

  const core = tryGetCore();
  let dashboard: OpsDashboard | null = null;
  if (core) {
    dashboard = await getOpsDashboard(core.db, AIRPORT_TZ).catch(() => null);
  }

  const todayTotal =
    dashboard?.todayByStatus.reduce((sum, row) => sum + row.count, 0) ?? 0;

  return (
    <ContentColumn>
      <PageHeader
        title="Operations"
        subtitle="Today's pickups, assignments, and anything that needs a human."
      />

      {dashboard && (
        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle className="text-3xl font-semibold">{todayTotal}</CardTitle>
              <CardDescription>bookings with a pickup window today</CardDescription>
            </CardHeader>
            {dashboard.todayByStatus.length > 0 && (
              <CardContent className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                {dashboard.todayByStatus.map((row) => (
                  <span key={row.status}>
                    {row.status.replace(/_/g, " ")}: {row.count}
                  </span>
                ))}
              </CardContent>
            )}
          </Card>

          <Card className={dashboard.unassignedToday > 0 ? "border-warning" : ""}>
            <CardHeader>
              <CardTitle className="text-3xl font-semibold">
                {dashboard.unassignedToday}
              </CardTitle>
              <CardDescription>paid today, no agent assigned</CardDescription>
            </CardHeader>
            {dashboard.unassignedToday > 0 && (
              <CardContent>
                <Button asChild size="sm" variant="outline">
                  <Link href="/bookings?status=paid">Assign now</Link>
                </Button>
              </CardContent>
            )}
          </Card>

          <Card className={dashboard.exceptionsOpen > 0 ? "border-destructive" : ""}>
            <CardHeader>
              <CardTitle className="text-3xl font-semibold">
                {dashboard.exceptionsOpen}
              </CardTitle>
              <CardDescription>exceptions open</CardDescription>
            </CardHeader>
            {dashboard.exceptionsOpen > 0 && (
              <CardContent>
                <Button asChild size="sm" variant="outline">
                  <Link href="/exceptions">Review</Link>
                </Button>
              </CardContent>
            )}
          </Card>
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <Button asChild>
          <Link href="/bookings">Bookings board</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/exceptions">Exceptions</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/staff">Staff</Link>
        </Button>
      </div>

      <EnvStatus appName="admin" />
    </ContentColumn>
  );
}
