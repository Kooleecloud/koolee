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
  ContentColumn,
  DatabaseNotConfigured,
  PageHeader,
} from "@koolee/ui";
import { availableEvents, EVENT_TYPES, getBooking, getTimeline } from "@koolee/core";

import { TransitionControls } from "@/components/transition-controls";
import { tryGetCore } from "@/lib/core";

export const dynamic = "force-dynamic";

const ALL_EVENTS = Object.keys(EVENT_TYPES);

export default async function BookingDetailPage({
  params,
}: {
  params: Promise<{ bookingId: string }>;
}) {
  const { bookingId } = await params;
  const core = tryGetCore();

  if (!core) {
    return (
      <ContentColumn>
        <DatabaseNotConfigured />
      </ContentColumn>
    );
  }

  const booking = await getBooking(core.db, bookingId).catch(() => null);
  if (!booking) notFound();

  const timeline = await getTimeline(core.db, bookingId).catch(() => []);
  const legal = availableEvents(booking.status);

  return (
    <ContentColumn>
      <PageHeader
        title={`${booking.flightNumber} · ${booking.departureAirport}`}
        subtitle={<span className="font-mono text-xs">{booking.id}</span>}
        actions={
          <>
            <BookingStatusBadge status={booking.status} />
            <BackLink href="/bookings" linkComponent={Link}>
              Back
            </BackLink>
          </>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Passenger</dt>
            <dd>{booking.paxName}</dd>
            <dt className="text-muted-foreground">Departs</dt>
            <dd>{format(booking.departureAt, "EEE d MMM yyyy, HH:mm")}</dd>
            <dt className="text-muted-foreground">Bags</dt>
            <dd>{booking.bagCount}</dd>
            <dt className="text-muted-foreground">Price</dt>
            <dd>
              ${(booking.priceCents / 100).toFixed(2)} {booking.currency.toUpperCase()}
            </dd>
            <dt className="text-muted-foreground">Created</dt>
            <dd>{format(booking.createdAt, "d MMM yyyy, HH:mm")}</dd>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Manual state override</CardTitle>
          <CardDescription>
            Legal moves from <strong>{booking.status}</strong>:{" "}
            {legal.length > 0 ? legal.join(", ") : "none — this status is terminal"}.
            Every override is written to the custody log.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TransitionControls
            bookingId={booking.id}
            events={ALL_EVENTS}
            legalEvents={legal}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Custody log</CardTitle>
          <CardDescription>
            Append-only. {timeline.length} event
            {timeline.length === 1 ? "" : "s"}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {timeline.length === 0 ? (
            <p className="text-sm text-muted-foreground">No events yet.</p>
          ) : (
            <ol className="flex flex-col divide-y text-sm">
              {timeline.map((event) => (
                <li key={event.id} className="flex flex-col gap-1 py-2.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-mono text-xs">{event.eventType}</span>
                    <time
                      dateTime={event.createdAt.toISOString()}
                      className="text-xs text-muted-foreground"
                    >
                      {format(event.createdAt, "d MMM HH:mm:ss")}
                    </time>
                  </div>
                  {event.metadata && (
                    <pre className="overflow-x-auto rounded-sm bg-muted/50 p-2 text-[11px]">
                      {JSON.stringify(event.metadata, null, 2)}
                    </pre>
                  )}
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </ContentColumn>
  );
}
