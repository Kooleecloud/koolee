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
import { computeBagDropCutoffAt, getBooking, getTimeline } from "@koolee/core";

import { CustodyTimeline } from "@/components/custody-timeline";
import { CutoffCountdown } from "@/components/cutoff-countdown";
import { STATUS_LABEL, STATUS_VARIANT } from "@/lib/booking-status";
import { tryGetCore } from "@/lib/core";

export const dynamic = "force-dynamic";

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
            <h1 className="font-display text-display-sm font-semibold text-navy-800">
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
            <CardTitle className="font-display text-base">Chain of custody</CardTitle>
            <CardDescription>Every hand-off, recorded as it happens.</CardDescription>
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
      <header className="border-b bg-white">
        <div className="container flex h-16 max-w-3xl items-center justify-between">
          <Link
            href="/"
            className="rounded-md focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <KooleeLogo />
          </Link>
          <Button asChild variant="ghost" size="sm">
            <Link href="/trips">All trips</Link>
          </Button>
        </div>
      </header>
      <main className="container max-w-3xl py-10">{children}</main>
    </div>
  );
}
