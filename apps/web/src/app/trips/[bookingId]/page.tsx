import Link from "next/link";
import { notFound } from "next/navigation";
import { format } from "date-fns";
import {
  BackLink,
  BookingStatusBadge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DatabaseNotConfigured,
  PageHeader,
} from "@koolee/ui";
import { computeBagDropCutoffAt, getBookingForSession } from "@koolee/core";

import { CustodyTimeline } from "@/components/custody-timeline";
import { CutoffCountdown } from "@/components/cutoff-countdown";
import { tryGetCore } from "@/lib/core";
import { getCustomerSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function TripPage({
  params,
}: {
  params: Promise<{ bookingId: string }>;
}) {
  const { bookingId } = await params;
  const core = tryGetCore();

  if (!core) {
    return <DatabaseNotConfigured />;
  }

  // Authorization lives in core: `getBookingForSession` enforces
  // `canActOnBooking` and 404s (not 403s) on other people's bookings.
  const session = await getCustomerSession();
  if (!session) notFound();

  const result = await getBookingForSession(core.db, session, bookingId).catch(
    () => null,
  );
  if (!result) notFound();

  const { booking, timeline } = result;

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
    <>
      <BackLink href="/trips" linkComponent={Link} className="self-start">
        All trips
      </BackLink>

      <PageHeader
        title={`${booking.flightNumber} · ${booking.departureAirport}`}
        subtitle={
          <>
            {format(booking.departureAt, "EEE d MMM yyyy, h:mm a")} · {booking.bagCount}{" "}
            {booking.bagCount === 1 ? "bag" : "bags"} · {booking.paxName}
          </>
        }
        actions={<BookingStatusBadge status={booking.status} />}
      />

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
    </>
  );
}
