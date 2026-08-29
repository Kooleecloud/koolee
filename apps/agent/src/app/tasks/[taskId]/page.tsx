import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  BackLink,
  Badge,
  BookingStatusBadge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ContentColumn,
  DatabaseNotConfigured,
  PageHeader,
} from "@koolee/ui";
import {
  dstTransitionNote,
  formatHourRangeInAirportTz,
  formatInstantInAirportTz,
  getAssignedTask,
  getVisitContext,
  VISIT_EVENT_TYPES,
  type TaskKind,
} from "@koolee/core";

import { tryGetCore } from "@/lib/core";
import { getAgentSession } from "@/lib/session";

import { VisitFlow, type VisitView } from "./visit-flow";

export const dynamic = "force-dynamic";

export default async function TaskDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ taskId: string }>;
  searchParams: Promise<{ kind?: string }>;
}) {
  const { taskId } = await params;
  const { kind: rawKind = "verification" } = await searchParams;
  const kind: TaskKind = rawKind === "pickup" ? "pickup" : "verification";

  const session = await getAgentSession();
  if (!session) redirect("/login");

  const core = tryGetCore();
  if (!core) {
    return (
      <ContentColumn width="focused">
        <PageHeader title="Task" />
        <DatabaseNotConfigured />
      </ContentColumn>
    );
  }

  /* --- pickup tasks keep the placeholder card (driver flow is later) --- */
  if (kind === "pickup") {
    const assigned = await getAssignedTask(core.db, {
      taskId,
      kind,
      assigneeUserId: session.userId,
    }).catch(() => null);
    if (!assigned) notFound();

    return (
      <ContentColumn width="focused">
        <BackLink href="/tasks" linkComponent={Link} className="self-start">
          Back
        </BackLink>
        <PageHeader
          title="Collect and deliver"
          subtitle={<span className="font-mono text-xs">{taskId}</span>}
        />
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pickup</CardTitle>
            <CardDescription>
              Collect the sealed bags and deliver them to the airline&apos;s bag drop.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm text-muted-foreground">
            <p>
              TODO(agent-flow): confirming collection should call{" "}
              <code>applyTransitionForSession</code> with <code>start_transit</code>, then{" "}
              <code>deliver_to_bagdrop</code> on arrival, capturing location with each.
            </p>
            <Button disabled>Confirm collection</Button>
          </CardContent>
        </Card>
      </ContentColumn>
    );
  }

  /* --- verification: the guided visit ---------------------------------- */
  const context = await getVisitContext(core.db, session, taskId).catch(() => null);
  if (!context) notFound();

  const { task, booking, bags, timeline } = context;
  // Non-null on the two DST nights a year, when the wall-clock label alone is
  // ambiguous (two 1 AMs) or looks wrong (no 2 AM).
  const windowNote = task.scheduledStart
    ? dstTransitionNote(task.scheduledStart, context.tz)
    : null;

  const view: VisitView = {
    taskId: task.id,
    paxName: booking.paxName,
    bookingStatus: booking.status,
    arrived: timeline.some((e) => e.eventType === VISIT_EVENT_TYPES.arrived),
    identityVerified: timeline.some(
      (e) => e.eventType === VISIT_EVENT_TYPES.identityVerified,
    ),
    bags: bags.map((bag) => ({
      id: bag.id,
      ordinal: bag.ordinal,
      sealId: bag.sealId,
      weightKg: bag.weightKg,
      photoCount: bag.photoUrls.length,
    })),
    done: task.status === "done",
    exception: booking.status === "exception" || task.status === "failed",
  };

  return (
    <ContentColumn width="focused">
      <BackLink href="/tasks" linkComponent={Link} className="self-start">
        Back
      </BackLink>

      <PageHeader
        title="Verify and seal"
        subtitle={
          <>
            {/* The ref leads: it is the token on the customer's email and the
                one an agent reads back to ops over the phone. */}
            <span className="font-mono">{booking.ref}</span> · {booking.flightNumber} ·{" "}
            {booking.departureAirport} · departs{" "}
            {formatInstantInAirportTz(booking.departureAt, context.tz)}
          </>
        }
        actions={<BookingStatusBadge status={booking.status} />}
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
            <span>
              {booking.paxName} · {bags.length} bag{bags.length === 1 ? "" : "s"}
            </span>
            {/* Read-only. An agent needs to know the job is paid for before
                handling someone's luggage; taking the money is ops' business
                and this app holds no payment credentials to do it with. */}
            {context.paymentStatus === "authorized" ||
            context.paymentStatus === "captured" ? (
              <Badge variant="success">Payment authorized</Badge>
            ) : (
              <Badge variant="warning">
                Payment not cleared — check with ops before collecting
              </Badge>
            )}
          </CardTitle>
          {/* Every time here is the BOOKING's zone, never the device's — the
              agent must be reading the same window the customer bought. */}
          <CardDescription>
            Window{" "}
            {task.scheduledStart
              ? task.scheduledEnd
                ? formatHourRangeInAirportTz(
                    task.scheduledStart,
                    task.scheduledEnd,
                    context.tz,
                  )
                : `${formatInstantInAirportTz(task.scheduledStart, context.tz)}–…`
              : "unscheduled"}
            {windowNote ? <> · {windowNote}</> : null}
            {booking.contactPhone ? <> · door contact {booking.contactPhone}</> : null}
          </CardDescription>
        </CardHeader>
      </Card>

      <VisitFlow view={view} />
    </ContentColumn>
  );
}
