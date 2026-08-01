import Link from "next/link";
import { notFound } from "next/navigation";
import { format } from "date-fns";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  KooleeLogo,
} from "@koolee/ui";
import {
  computeBagDropCutoffAt,
  getBooking,
  getTimeline,
  type BookingStatus,
} from "@koolee/core";

import { CustodyTimeline } from "@/components/custody-timeline";
import { CutoffCountdown } from "@/components/cutoff-countdown";
import { tryGetCore } from "@/lib/core";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<BookingStatus, string> = {
  draft: "Awaiting payment",
  paid: "Booked",
  agent_assigned: "Agent assigned",
  verified_sealed: "Verified and sealed",
  awaiting_pickup: "Ready for pickup",
  in_transit: "On the way to the airport",
  delivered_to_bagdrop: "Delivered to bag drop",
  completed: "Complete",
  exception: "Needs attention",
  cancelled: "Cancelled",
};

const STATUS_VARIANT: Record<
  BookingStatus,
  "default" | "secondary" | "success" | "warning" | "destructive"
> = {
  draft: "secondary",
  paid: "default",
  agent_assigned: "default",
  verified_sealed: "default",
  awaiting_pickup: "default",
  in_transit: "default",
  delivered_to_bagdrop: "success",
  completed: "success",
  exception: "warning",
  cancelled: "destructive",
};

export default async function TripPage({
  params,
}: {
  params: Promise<{ bookingId: string }>;
}) {
  const { bookingId } = await params;
  const core = tryGetCore();

  if (!core) {
    return (
      <Shell>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Database not configured</CardTitle>
            <CardDescription>
              Set <code>DATABASE_URL</code> in <code>.env.local</code> to load bookings.
            </CardDescription>
          </CardHeader>
        </Card>
      </Shell>
    );
  }

  // TODO(auth): resolve the customer session and use `getBookingForSession`,
  // which enforces `canActOnBooking`. Right now anyone with the booking id can
  // read the trip page. That is acceptable for a localhost scaffold and is not
  // acceptable in production.
  const booking = await getBooking(core.db, bookingId).catch(() => null);
  if (!booking) notFound();

  const timeline = await getTimeline(core.db, bookingId).catch(() => []);

  // TODO: persist the resolved cutoff on the booking so the banner does not
  // have to assume. Until then, show the countdown only when we can look it up.
  const cutoffRow = await core.db.query.airlineCutoffs
    .findFirst({
      where: (t, { and, eq }) =>
        and(
          eq(t.airlineIata, booking.airlineIata),
          eq(t.airportCode, booking.departureAirport),
        ),
    })
    .catch(() => undefined);

  const cutoffAt = cutoffRow
    ? computeBagDropCutoffAt(booking.departureAt, cutoffRow.cutoffMinutesBeforeDeparture)
    : null;

  const isActive = !["completed", "cancelled"].includes(booking.status);

  return (
    <Shell>
      <div className="flex flex-col gap-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              {booking.flightNumber} · {booking.departureAirport}
            </h1>
            <p className="text-sm text-muted-foreground">
              {format(booking.departureAt, "EEE d MMM yyyy, h:mm a")} · {booking.bagCount}{" "}
              {booking.bagCount === 1 ? "bag" : "bags"} · {booking.paxName}
            </p>
          </div>
          <Badge variant={STATUS_VARIANT[booking.status]}>
            {STATUS_LABEL[booking.status]}
          </Badge>
        </header>

        {cutoffAt && isActive && (
          <CutoffCountdown
            cutoffAtIso={cutoffAt.toISOString()}
            airlineIata={booking.airlineIata}
            airportCode={booking.departureAirport}
          />
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Chain of custody</CardTitle>
            <CardDescription>Every handover, recorded as it happens.</CardDescription>
          </CardHeader>
          <CardContent>
            <CustodyTimeline events={timeline} />
          </CardContent>
        </Card>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh">
      <header className="border-b">
        <div className="container flex h-14 max-w-3xl items-center justify-between">
          <Link href="/">
            <KooleeLogo />
          </Link>
          <Button asChild variant="ghost" size="sm">
            <Link href="/trips">All trips</Link>
          </Button>
        </div>
      </header>
      <main className="container max-w-3xl py-8">{children}</main>
    </div>
  );
}
