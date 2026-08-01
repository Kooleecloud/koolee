import Link from "next/link";
import { format } from "date-fns";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@koolee/ui";
import { listBookings, type Booking } from "@koolee/core";

import { tryGetCore } from "@/lib/core";

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
  const core = tryGetCore();

  let exceptions: Booking[] = [];
  let unavailable = core === null;

  if (core) {
    try {
      exceptions = await listBookings(core.db, { status: "exception", limit: 100 });
    } catch {
      unavailable = true;
    }
  }

  return (
    <main className="container flex max-w-3xl flex-col gap-6 py-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Exceptions</h1>
        <p className="text-sm text-muted-foreground">Bookings that need a human.</p>
      </header>

      {unavailable ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Database not configured</CardTitle>
            <CardDescription>
              Set <code>DATABASE_URL</code> in <code>.env.local</code>.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : exceptions.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Nothing in exception</CardTitle>
            <CardDescription>Every booking is on its normal path.</CardDescription>
          </CardHeader>
        </Card>
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
                    Departs {format(booking.departureAt, "EEE d MMM, HH:mm")} ·{" "}
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
    </main>
  );
}
