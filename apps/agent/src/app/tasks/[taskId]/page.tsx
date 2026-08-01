import Link from "next/link";
import { format } from "date-fns";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
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
    <main className="container flex max-w-md flex-col gap-6 py-8">
      <header className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold tracking-tight">
            {kind === "pickup" ? "Collect and deliver" : "Verify and seal"}
          </h1>
          <p className="font-mono text-xs text-muted-foreground">{taskId}</p>
        </div>
        <Button asChild variant="ghost" size="sm">
          <Link href="/tasks">Back</Link>
        </Button>
      </header>

      {booking ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between gap-3 text-base">
              <span>
                {booking.flightNumber} · {booking.departureAirport}
              </span>
              <Badge variant="secondary">{booking.status}</Badge>
            </CardTitle>
            <CardDescription>
              Departs {format(booking.departureAt, "EEE d MMM, h:mm a")} · {timelineCount}{" "}
              custody event{timelineCount === 1 ? "" : "s"} so far
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Booking not loaded</CardTitle>
            <CardDescription>
              {core
                ? "Pass ?booking=<id> to load booking details for this task."
                : "Database not configured — set DATABASE_URL in .env.local."}
            </CardDescription>
          </CardHeader>
        </Card>
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
    </main>
  );
}
