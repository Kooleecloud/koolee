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
  KooleeLogo,
} from "@koolee/ui";
import { listBookings, type Booking } from "@koolee/core";

import { tryGetCore } from "@/lib/core";

export const metadata = { title: "My trips" };
export const dynamic = "force-dynamic";

export default async function TripsPage() {
  const core = tryGetCore();

  let bookings: Booking[] = [];
  let unavailable = core === null;

  if (core) {
    try {
      // TODO(auth): filter by the signed-in customer's userId once the session
      // is wired. Unfiltered is fine on localhost, not in production.
      bookings = await listBookings(core.db, { limit: 50 });
    } catch {
      unavailable = true;
    }
  }

  return (
    <div className="min-h-dvh">
      <header className="border-b">
        <div className="container flex h-14 max-w-3xl items-center justify-between">
          <Link href="/">
            <KooleeLogo />
          </Link>
          <Button asChild size="sm">
            <Link href="/book/flight">Book a pickup</Link>
          </Button>
        </div>
      </header>

      <main className="container flex max-w-3xl flex-col gap-6 py-8">
        <h1 className="text-2xl font-semibold tracking-tight">My trips</h1>

        {unavailable ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Database not configured</CardTitle>
              <CardDescription>
                Set <code>DATABASE_URL</code> in <code>.env.local</code>, then run{" "}
                <code>pnpm db:migrate &amp;&amp; pnpm seed</code>.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : bookings.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">No trips yet</CardTitle>
              <CardDescription>Book a pickup and it will show up here.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild>
                <Link href="/book/flight">Book a pickup</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <ul className="flex flex-col gap-3">
            {bookings.map((booking) => (
              <li key={booking.id}>
                <Link
                  href={`/trips/${booking.id}`}
                  className="flex items-center justify-between gap-4 rounded-lg border p-4 transition-colors hover:bg-accent/10"
                >
                  <span className="flex flex-col gap-1">
                    <span className="font-medium">
                      {booking.flightNumber} · {booking.departureAirport}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {format(booking.departureAt, "EEE d MMM, h:mm a")} ·{" "}
                      {booking.bagCount} {booking.bagCount === 1 ? "bag" : "bags"}
                    </span>
                  </span>
                  <Badge variant="secondary">{booking.status}</Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
