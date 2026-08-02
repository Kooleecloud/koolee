import Link from "next/link";
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
import { getBooking, getTimeline, type Booking } from "@koolee/core";

import { VerificationChecklist } from "@/components/verification-checklist";
import { tryGetCore } from "@/lib/core";

export const dynamic = "force-dynamic";

export default async function TaskDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ taskId: string }>;
  searchParams: Promise<{ kind?: string; booking?: string }>;
}) {
  const { taskId } = await params;
  const { kind = "verification", booking: bookingId } = await searchParams;

  const core = tryGetCore();
  let booking: Booking | null = null;
  let timelineCount = 0;

  if (core && bookingId) {
    booking = await getBooking(core.db, bookingId).catch(() => null);
    if (booking) {
      timelineCount = (await getTimeline(core.db, bookingId).catch(() => [])).length;
    }
  }

  return (
    <ContentColumn width="narrow">
      <BackLink href="/tasks" linkComponent={Link} className="self-start">
        Back
      </BackLink>

      <PageHeader
        title={kind === "pickup" ? "Collect and deliver" : "Verify and seal"}
        subtitle={<span className="font-mono text-xs">{taskId}</span>}
      />

      {booking ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between gap-3 text-base">
              <span>
                {booking.flightNumber} · {booking.departureAirport}
              </span>
              <BookingStatusBadge status={booking.status} />
            </CardTitle>
            <CardDescription>
              Departs {format(booking.departureAt, "EEE d MMM, h:mm a")} · {timelineCount}{" "}
              custody event{timelineCount === 1 ? "" : "s"} so far
            </CardDescription>
          </CardHeader>
        </Card>
      ) : core ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Booking not loaded</CardTitle>
            <CardDescription>
              {"Pass ?booking=<id> to load booking details for this task."}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <DatabaseNotConfigured />
      )}

      {kind === "verification" ? (
        <VerificationChecklist
          bagCount={booking?.bagCount ?? 1}
          paxName={booking?.paxName ?? "—"}
        />
      ) : (
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
      )}

      <Button asChild variant="outline">
        <Link href="/scan">Open camera</Link>
      </Button>
    </ContentColumn>
  );
}
