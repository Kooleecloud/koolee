import Link from "next/link";
import { format } from "date-fns";
import { Badge, Card, CardDescription, CardHeader, CardTitle } from "@koolee/ui";
import { listBookings, type Booking, type BookingStatus } from "@koolee/core";

import { tryGetCore } from "@/lib/core";

export const metadata = { title: "Bookings" };
export const dynamic = "force-dynamic";

const STATUSES: BookingStatus[] = [
  "draft",
  "paid",
  "agent_assigned",
  "verified_sealed",
  "awaiting_pickup",
  "in_transit",
  "delivered_to_bagdrop",
  "completed",
  "exception",
  "cancelled",
];

export default async function BookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const filter = STATUSES.includes(status as BookingStatus)
    ? (status as BookingStatus)
    : undefined;

  const core = tryGetCore();
  let bookings: Booking[] = [];
  let unavailable = core === null;

  if (core) {
    try {
      bookings = await listBookings(core.db, {
        ...(filter ? { status: filter } : {}),
        limit: 200,
      });
    } catch {
      unavailable = true;
    }
  }

  return (
    <main className="container flex flex-col gap-6 py-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Bookings</h1>
        <p className="text-sm text-muted-foreground">
          {unavailable ? "Database not configured." : `${bookings.length} shown`}
        </p>
      </header>

      <nav className="flex flex-wrap gap-2 text-sm">
        <FilterLink href="/bookings" label="All" active={!filter} />
        {STATUSES.map((s) => (
          <FilterLink
            key={s}
            href={`/bookings?status=${s}`}
            label={s}
            active={filter === s}
          />
        ))}
      </nav>

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
            <CardTitle className="text-base">No bookings</CardTitle>
            <CardDescription>
              {filter ? `Nothing is ${filter}.` : "No bookings have been made yet."}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50 text-left">
              <tr>
                <th className="px-4 py-2 font-medium">Flight</th>
                <th className="px-4 py-2 font-medium">Passenger</th>
                <th className="px-4 py-2 font-medium">Departs</th>
                <th className="px-4 py-2 font-medium">Bags</th>
                <th className="px-4 py-2 font-medium">Price</th>
                <th className="px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {bookings.map((booking) => (
                <tr key={booking.id} className="hover:bg-accent/5">
                  <td className="px-4 py-2">
                    <Link
                      href={`/bookings/${booking.id}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {booking.flightNumber}
                    </Link>
                    <span className="ml-2 text-muted-foreground">
                      {booking.departureAirport}
                    </span>
                  </td>
                  <td className="px-4 py-2">{booking.paxName}</td>
                  <td className="px-4 py-2 whitespace-nowrap">
                    {format(booking.departureAt, "d MMM, HH:mm")}
                  </td>
                  <td className="px-4 py-2">{booking.bagCount}</td>
                  <td className="px-4 py-2">${(booking.priceCents / 100).toFixed(2)}</td>
                  <td className="px-4 py-2">
                    <Badge
                      variant={
                        booking.status === "exception"
                          ? "warning"
                          : booking.status === "cancelled"
                            ? "destructive"
                            : booking.status === "completed"
                              ? "success"
                              : "secondary"
                      }
                    >
                      {booking.status}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

function FilterLink({
  href,
  label,
  active,
}: {
  href: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={
        active
          ? "rounded-md bg-primary px-2.5 py-1 text-xs text-primary-foreground"
          : "rounded-md border px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent/10"
      }
    >
      {label}
    </Link>
  );
}
