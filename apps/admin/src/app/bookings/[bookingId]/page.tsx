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
      <main className="container max-w-3xl py-8">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Database not configured</CardTitle>
            <CardDescription>
              Set <code>DATABASE_URL</code> in <code>.env.local</code>.
            </CardDescription>
          </CardHeader>
        </Card>
      </main>
    );
  }

  const booking = await getBooking(core.db, bookingId).catch(() => null);
  if (!booking) notFound();

  const timeline = await getTimeline(core.db, bookingId).catch(() => []);
  const legal = availableEvents(booking.status);

  return (
    <main className="container flex max-w-3xl flex-col gap-6 py-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {booking.flightNumber} · {booking.departureAirport}
          </h1>
          <p className="font-mono text-xs text-muted-foreground">{booking.id}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={booking.status === "exception" ? "warning" : "secondary"}>
            {booking.status}
          </Badge>
          <Button asChild variant="ghost" size="sm">
            <Link href="/bookings">Back</Link>
          </Button>
        </div>
      </header>

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
                    <pre className="overflow-x-auto rounded bg-muted/50 p-2 text-[11px]">
                      {JSON.stringify(event.metadata, null, 2)}
                    </pre>
                  )}
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
