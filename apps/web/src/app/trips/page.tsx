import Link from "next/link";
import { format } from "date-fns";
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CTAButton,
  KooleeLogo,
} from "@koolee/ui";
import { listBookings, type Booking } from "@koolee/core";

import { STATUS_LABEL, STATUS_VARIANT } from "@/lib/booking-status";
import { tryGetCore } from "@/lib/core";

export const metadata = { title: "My Trips" };
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
      <header className="border-b bg-white">
        <div className="container flex h-16 max-w-3xl items-center justify-between">
          <Link
            href="/"
            className="rounded-md focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <KooleeLogo />
          </Link>
          <CTAButton size="sm" asChild>
            <Link href="/book/flight">Book a pickup</Link>
          </CTAButton>
        </div>
      </header>

      <main className="container flex max-w-3xl flex-col gap-6 py-10">
        <h1 className="font-display text-display-sm font-semibold text-navy-800">
          My Trips
        </h1>

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
              <CardDescription>
                Book a pickup and your live chain-of-custody timeline will appear here.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <CTAButton asChild>
                <Link href="/book/flight">Book a pickup</Link>
              </CTAButton>
            </CardContent>
          </Card>
        ) : (
          <ul className="flex flex-col gap-3">
            {bookings.map((booking) => (
              <li key={booking.id}>
                <Link
                  href={`/trips/${booking.id}`}
                  className="flex items-center justify-between gap-4 rounded-xl border border-border bg-white p-5 shadow-xs transition-all hover:-translate-y-0.5 hover:shadow-lift focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="flex flex-col gap-1">
                    <span className="font-display font-semibold text-navy-800">
                      {booking.flightNumber} · {booking.departureAirport}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {format(booking.departureAt, "EEE d MMM, h:mm a")} ·{" "}
                      {booking.bagCount} {booking.bagCount === 1 ? "bag" : "bags"}
                    </span>
                  </span>
                  <Badge variant={STATUS_VARIANT[booking.status]}>
                    {STATUS_LABEL[booking.status]}
                  </Badge>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
