import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Badge,
  Button,
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
  getDisplayZones,
  listBookings,
  zoneFor,
  type Booking,
} from "@koolee/core";

import { ConsoleMain } from "@/components/console";
import { tryGetCore } from "@/lib/core";
import { getAdminSession } from "@/lib/session";

export const metadata = { title: "Exceptions" };
export const dynamic = "force-dynamic";

/**
 * Exceptions queue.
 *
 * Lists bookings currently in the `exception` status. Deliberately read-only
 * for now — the resolution workflows (rejected bag, lost bag, re-dispatch,
 * partial refund) are explicitly out of scope for this scaffold, and a
 * half-built resolution UI would be worse than none.
 *
 * TODO(exceptions): build the resolution flows. Each needs its own reason
 * codes, evidence requirements, and a refund policy, and each must append to
 * the custody log rather than editing it.
 */
export default async function ExceptionsPage() {
  const session = await getAdminSession();
  if (!session) redirect("/login");

  const core = tryGetCore();

  let exceptions: Booking[] = [];
  let zones: Record<string, string> = {};
  let unavailable = core === null;

  if (core) {
    try {
      // Exceptions can span airports, so each row renders in its own zone.
      [exceptions, zones] = await Promise.all([
        listBookings(core.db, { status: "exception", limit: 100 }),
        getDisplayZones(core.db),
      ]);
    } catch {
      unavailable = true;
    }
  }

  return (
    <ConsoleMain>
      <PageHeader
        title="Exceptions"
        subtitle={
          unavailable
            ? "Database not configured."
            : exceptions.length === 0
              ? "Bookings that need a human. Nothing is stuck right now."
              : `${exceptions.length} booking${exceptions.length === 1 ? "" : "s"} stopped on the way to the airport.`
        }
      />

      {unavailable ? (
        <DatabaseNotConfigured />
      ) : exceptions.length === 0 ? (
        <EmptyState
          title="Nothing in exception"
          description="Every booking is on its normal path."
        />
      ) : (
        /* `Card asChild interactive` rather than a hand-rolled
           `rounded-lg border bg-…`: DESIGN.md's rule is that every raised
           surface in every app is a Card, and the copies that grew around it
           had already drifted on elevation. The warning tint is the one thing
           this row overrides — it is the queue's whole signal. */
        <ul className="console-rows flex flex-col gap-3">
          {exceptions.map((booking) => (
            <li key={booking.id}>
              {/* Card on the Link, not on the li: `interactive` carries the
                  focus ring, and the ring has to sit on the element that
                  actually takes focus. */}
              <Card asChild interactive className="border-warning/40 bg-warning/5">
                <Link
                  href={`/bookings/${booking.id}`}
                  className="flex items-center justify-between gap-4 p-4"
                >
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="flex flex-wrap items-center gap-2 font-medium">
                      {/* The ops alert email names the booking by its ref, so
                          that is what has to be scannable on this board. */}
                      <span className="font-mono">{booking.ref}</span>
                      <span aria-hidden="true" className="text-muted-foreground">
                        ·
                      </span>
                      {booking.flightNumber}
                      <Badge variant="secondary">{booking.departureAirport}</Badge>
                    </span>
                    <span className="text-sm text-muted-foreground">
                      Departs{" "}
                      {formatInstantInAirportTz(
                        booking.departureAt,
                        zoneFor(zones, booking.departureAirport),
                      )}{" "}
                      · {booking.paxName} · {booking.bagCount} bag
                      {booking.bagCount === 1 ? "" : "s"}
                    </span>
                  </span>
                  <Button variant="outline" size="sm" asChild>
                    <span>Open</span>
                  </Button>
                </Link>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Card className="border-dashed">
        <CardHeader>
          <CardTitle className="text-base">Resolving an exception</CardTitle>
          <CardDescription>
            Open the booking and use the resolution panel there: cancel and refund,
            put the bags back in transit, or close it out as complete. Each one asks
            for a reason and writes it to the custody trail, which is append-only —
            nothing you do here can erase what happened.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Dedicated flows for the common cases — rejected bag, lost bag, re-dispatch,
          partial refund — are not built yet. Until they are, the reason you type is
          what the next person reads, so write it for them.
        </CardContent>
      </Card>
    </ConsoleMain>
  );
}
