import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  Avatar,
  BackLink,
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DatabaseNotConfigured,
  EmptyState,
  PageHeader,
} from "@koolee/ui";
import {
  formatInstantInAirportTz,
  getStaffWorkHistory,
  listShifts,
  listStaffMembers,
  staffHistoryRange,
  type ShiftRow,
  type StaffTaskRow,
  type StaffWorkHistory,
} from "@koolee/core";

import { ConsoleMain } from "@/components/console";
import { OPS_CONSOLE_TZ } from "@/lib/airport-tz";
import { signAvatarUrl } from "@/lib/avatars";
import { tryGetCore } from "@/lib/core";
import { getAdminSession } from "@/lib/session";

import { StaffPhotoDialog } from "../staff-photo-dialog";
import { DateRangeFilter } from "./date-range-filter";

export const dynamic = "force-dynamic";

/**
 * One person's work.
 *
 * Every number here is DERIVED from `verification_tasks`, `pickup_tasks` and
 * the bookings they point at. There is no counter column and no `staff_stats`
 * table, because a counter on a write path is a thing that has to be kept in
 * step with what it counts, and that is how a number becomes confidently wrong
 * and stays that way.
 *
 * The consequence is stated on the page rather than hidden: anything that is
 * not a task row cannot be counted. Emails sent, kilometres driven, hours on
 * shift beyond the clock-on and clock-off instants — none of those exist in
 * this database, and a reader must not take a missing number for a zero.
 *
 * TIMES ARE IN THE CONSOLE'S ZONE, not per booking — the same choice `/shifts`
 * makes and for the same reason: this page is a person's calendar, not one
 * flight's. Each ROW still names its booking's airport so a cross-airport day
 * stays readable.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;
  return { title: `Staff · ${userId.slice(0, 8)}` };
}

export default async function StaffMemberPage({
  params,
  searchParams,
}: {
  params: Promise<{ userId: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const session = await getAdminSession();
  if (!session) redirect("/login");

  const { userId } = await params;
  const { from, to } = await searchParams;
  const range = staffHistoryRange(from, to);

  const core = tryGetCore();
  if (!core) {
    return (
      <ConsoleMain>
        <BackLink href="/staff" linkComponent={Link} className="self-start">
          All staff
        </BackLink>
        <DatabaseNotConfigured />
      </ConsoleMain>
    );
  }

  // `listStaffMembers` is the one identity read that already joins users;
  // filtering here rather than adding a by-id variant keeps one query shape.
  const member = (await listStaffMembers(core.db)).find((row) => row.userId === userId);
  if (!member) notFound();

  const [history, shifts, avatarUrl]: [StaffWorkHistory, ShiftRow[], string | null] =
    await Promise.all([
      getStaffWorkHistory(core.db, { staffUserId: userId, ...range }),
      // Shifts are NOT range-filtered: a driver's shift list is short, and
      // reading "no shifts" because the date box is set to last week would be
      // a worse answer than a few extra rows.
      listShifts(core.db, { staffUserId: userId, limit: 30 }),
      signAvatarUrl(member.avatarStoragePath),
    ]);

  const name = member.fullName ?? member.email ?? userId;

  return (
    <ConsoleMain>
      <BackLink href="/staff" linkComponent={Link} className="self-start">
        All staff
      </BackLink>

      <PageHeader
        title={name}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Badge variant={member.role === "admin" ? "default" : "secondary"}>
              {member.role}
            </Badge>
            {member.canDrive ? <Badge variant="outline">can drive</Badge> : null}
            {member.active ? (
              <Badge variant="success">active</Badge>
            ) : (
              <Badge variant="warning">deactivated</Badge>
            )}
            {member.email ? (
              <span className="text-sm text-muted-foreground">{member.email}</span>
            ) : null}
          </span>
        }
        actions={
          <span className="flex items-center gap-3">
            <Avatar size="lg" name={name} src={avatarUrl} alt="" />
            <StaffPhotoDialog userId={userId} name={name} currentUrl={avatarUrl} />
          </span>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Work</CardTitle>
          <CardDescription>
            Counted from task rows — nothing here is bookkept, so nothing here can
            drift from what actually happened. Anything that is not a task row (emails
            sent, distance driven) is not in this database at all and is therefore
            absent rather than zero.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <DateRangeFilter userId={userId} from={from ?? ""} to={to ?? ""} />

          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Count label="Verification visits" value={history.counts.verificationsDone} />
            <Count label="Pickup runs" value={history.counts.pickupsDone} />
            <Count label="Still open" value={history.counts.open} />
            <Count
              label="Failed"
              value={history.counts.failed}
              alarm={history.counts.failed > 0}
            />
          </dl>

          {history.rows.length === 0 ? (
            <EmptyState
              title="Nothing in this range"
              description="Widen the dates, or this person has not been assigned work yet."
            />
          ) : (
            <ul className="console-rows flex flex-col gap-2">
              {history.rows.map((row) => (
                <li key={`${row.kind}:${row.taskId}`}>
                  <TaskRow row={row} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Shifts</CardTitle>
          <CardDescription>
            Clock-on and clock-off, most recent first. Times are {OPS_CONSOLE_TZ} — a
            shift belongs to a person&apos;s day, not to any one flight.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {shifts.length === 0 ? (
            <EmptyState
              title="No shifts"
              description={
                member.canDrive
                  ? "This driver has not clocked on yet."
                  : "This person is not cleared to drive, so they have no shifts."
              }
            />
          ) : (
            <ul className="console-rows flex flex-col gap-2">
              {shifts.map((shift) => (
                <li
                  key={shift.shiftId}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-lg border border-border bg-card p-3 text-sm"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="font-medium text-navy-800">{shift.truckName}</span>
                    <span className="text-xs text-muted-foreground">
                      {formatInstantInAirportTz(shift.startedAt, OPS_CONSOLE_TZ)} →{" "}
                      {shift.endedAt
                        ? formatInstantInAirportTz(shift.endedAt, OPS_CONSOLE_TZ)
                        : "still out"}
                    </span>
                  </span>
                  {shift.endedAt ? (
                    <Badge variant="secondary">closed</Badge>
                  ) : (
                    <Badge variant="success">{shift.bagsOnBoard} bags on board</Badge>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </ConsoleMain>
  );
}

/** One task, linking to the booking it belongs to. */
function TaskRow({ row }: { row: StaffTaskRow }) {
  return (
    <Link
      href={`/bookings/${row.bookingId}`}
      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-lg border border-border bg-card p-3 text-sm transition-colors hover:border-sky-300 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="flex min-w-0 flex-col">
        <span className="font-medium text-navy-800">
          {row.kind === "verification" ? "Verify & seal" : "Collect & deliver"} ·{" "}
          {row.paxName}
        </span>
        <span className="text-xs text-muted-foreground">
          <span className="font-mono">{row.bookingRef}</span> · {row.departureAirport} ·{" "}
          {row.at
            ? formatInstantInAirportTz(row.at, OPS_CONSOLE_TZ)
            : "no time recorded"}
        </span>
      </span>
      <Badge
        variant={
          row.status === "done"
            ? "success"
            : row.status === "failed"
              ? "destructive"
              : "secondary"
        }
      >
        {row.status}
      </Badge>
    </Link>
  );
}

/**
 * One derived count.
 *
 * `StatBadge` in @koolee/ui is deliberately not used here: its own header says
 * it is for PROCESS facts on the marketing site ("never for made-up counts"),
 * and these are query results in an operational console. Same house
 * typography, different job.
 */
function Count({
  label,
  value,
  alarm = false,
}: {
  label: string;
  value: number;
  alarm?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-3 ${alarm ? "border-warning bg-warning/5" : "border-border bg-card"}`}
    >
      <dd className="font-display text-2xl font-semibold tabular-nums text-navy-800">
        {value}
      </dd>
      <dt className="text-xs text-muted-foreground">{label}</dt>
    </div>
  );
}
