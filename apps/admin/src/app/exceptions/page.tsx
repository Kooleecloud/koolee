import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ContentColumn,
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
    <ContentColumn>
      <PageHeader title="Exceptions" subtitle="Bookings that need a human." />

      {unavailable ? (
        <DatabaseNotConfigured />
      ) : exceptions.length === 0 ? (
        <EmptyState
          title="Nothing in exception"
          description="Every booking is on its normal path."
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {exceptions.map((booking) => (
            <li key={booking.id}>
              <Link
                href={`/bookings/${booking.id}`}
                className="flex items-center justify-between gap-4 rounded-lg border border-warning/40 bg-warning/5 p-4 transition-colors hover:bg-warning/10"
              >
                <span className="flex flex-col gap-1">
                  <span className="font-medium">
                    {booking.flightNumber} · {booking.departureAirport}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    Departs{" "}
                    {formatInstantInAirportTz(
                      booking.departureAt,
                      zoneFor(zones, booking.departureAirport),
                    )}{" "}
                    ·{" "}
                    {booking.paxName}
                  </span>
                </span>
                <Button variant="outline" size="sm" asChild>
                  <span>Open</span>
                </Button>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Card className="border-dashed">
        <CardHeader>
          <CardTitle className="text-base">Resolution workflows</CardTitle>
          <CardDescription>
            Rejected-bag and lost-bag flows are out of scope for this scaffold. Use the
            manual state overrides on a booking&apos;s detail page in the meantime — every
            override is recorded in the custody log.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          See the TODO(exceptions) note in this file.
        </CardContent>
      </Card>
    </ContentColumn>
  );
}
