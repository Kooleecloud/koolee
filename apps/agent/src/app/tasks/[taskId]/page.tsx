import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { format } from "date-fns";
import {
  BackLink,
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
            {booking.flightNumber} · {booking.departureAirport} · departs{" "}
            {format(booking.departureAt, "EEE d MMM, h:mm a")}
          </>
        }
        actions={<BookingStatusBadge status={booking.status} />}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {booking.paxName} · {bags.length} bag{bags.length === 1 ? "" : "s"}
          </CardTitle>
          <CardDescription>
            Window{" "}
            {task.scheduledStart
              ? `${format(task.scheduledStart, "h:mm a")}–${
                  task.scheduledEnd ? format(task.scheduledEnd, "h:mm a") : "…"
                }`
              : "unscheduled"}
            {booking.contactPhone ? <> · door contact {booking.contactPhone}</> : null}
          </CardDescription>
        </CardHeader>
      </Card>

      <VisitFlow view={view} />
    </ContentColumn>
  );
}
