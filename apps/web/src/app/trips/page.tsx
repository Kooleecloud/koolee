import Link from "next/link";
import { format } from "date-fns";
import {
  BookingStatusBadge,
  CTAButton,
  DatabaseNotConfigured,
  EmptyState,
  PageHeader,
} from "@koolee/ui";
import { redirect } from "next/navigation";
import { listBookings, type Booking } from "@koolee/core";

import { getAuthUser } from "@/lib/auth";
import { tryGetCore } from "@/lib/core";

export const metadata = { title: "My Trips" };
export const dynamic = "force-dynamic";

export default async function TripsPage() {
  // The proxy gates this route; re-check here so the query is always scoped.
  const authUser = await getAuthUser();
  if (!authUser || authUser.isAnonymous) redirect("/login?returnTo=%2Ftrips");

  const core = tryGetCore();

  let bookings: Booking[] = [];
  let unavailable = core === null;

  if (core) {
    try {
      bookings = await listBookings(core.db, { userId: authUser.id, limit: 50 });
    } catch {
      unavailable = true;
    }
  }

  return (
    <>
      <PageHeader title="My Trips" />

      {unavailable ? (
        <DatabaseNotConfigured />
      ) : bookings.length === 0 ? (
        <EmptyState
          title="No trips yet"
          description="Book a pickup and your live chain-of-custody timeline will appear here."
          action={
            <CTAButton asChild>
              <Link href="/book/zip">Book a pickup</Link>
            </CTAButton>
          }
        />
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
                <BookingStatusBadge status={booking.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
