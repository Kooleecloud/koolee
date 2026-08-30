import Link from "next/link";
import { Plane } from "lucide-react";
import { Badge, BookingStatusBadge, Card } from "@koolee/ui";
import {
  formatInstantInAirportTz,
  formatWindowInAirportTz,
  type TripNeed,
  type TripSummary,
} from "@koolee/core";

/**
 * One trip, in a list.
 *
 * TWO DENSITIES, one component. An upcoming trip is something you are about to
 * live through and may need to act on; a past one is a receipt. Rendering both
 * from the same file is what keeps them recognisably the same object — a
 * separate "history card" drifts into a different vocabulary within a slice.
 *
 * The needs badges are the reason this exists at all. Before it, a customer
 * with an unaccepted agreement saw a list of identical cards and no indication
 * that one of them could not be collected — they found out when an agent stood
 * at their door unable to proceed.
 */

/** The customer's words for each thing a booking is waiting on. */
const NEED_LABEL: Record<TripNeed, string> = {
  accept_agreement: "Accept the agreement",
  choose_driver: "Choose your driver",
  upload_passport: "Add your passport (optional)",
};

/** Optional needs are informational; the other two actually block a pickup. */
const NEED_VARIANT: Record<TripNeed, "warning" | "secondary"> = {
  accept_agreement: "warning",
  choose_driver: "warning",
  upload_passport: "secondary",
};

export function TripNeedsBadges({ needs }: { needs: readonly TripNeed[] }) {
  if (needs.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-1.5">
      {needs.map((need) => (
        <Badge key={need} variant={NEED_VARIANT[need]}>
          {NEED_LABEL[need]}
        </Badge>
      ))}
    </span>
  );
}

function windowLabel(trip: TripSummary): string {
  const { pickupWindowStart, pickupWindowEnd } = trip.booking;
  if (pickupWindowStart && pickupWindowEnd) {
    return formatWindowInAirportTz(pickupWindowStart, pickupWindowEnd, trip.tz);
  }
  if (pickupWindowStart) return formatInstantInAirportTz(pickupWindowStart, trip.tz);
  return "Not scheduled yet";
}

export function UpcomingTripCard({ trip }: { trip: TripSummary }) {
  const { booking } = trip;
  return (
    <Card asChild interactive>
      <Link href={`/trips/${booking.id}`} className="flex flex-col gap-4 p-5">
        <span className="flex items-start justify-between gap-4">
          <span className="flex flex-col gap-1">
            <span className="font-display font-semibold text-navy-800">
              {booking.flightNumber} · {booking.departureAirport}
            </span>
            <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Plane aria-hidden className="size-3.5 shrink-0 text-sky-700" />
              {formatInstantInAirportTz(booking.departureAt, trip.tz)}
            </span>
          </span>
          <BookingStatusBadge status={booking.status} />
        </span>

        {/* What this booking wants from THEM, above the facts — a customer
            scanning the list is looking for something to do. */}
        <TripNeedsBadges needs={trip.needs} />

        {/* Running late is not a refusal and must not read as one: the
            controls still work right up to the airline's bag drop closing. */}
        {trip.actionability.lateNotice ? (
          <span className="text-sm text-amber-700">{trip.actionability.lateNotice}</span>
        ) : trip.actionability.blockedReason ? (
          <span className="text-sm text-destructive">
            {trip.actionability.blockedReason}
          </span>
        ) : null}

        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border pt-4 text-sm sm:grid-cols-3">
          <TripFact label="Pickup window" value={windowLabel(trip)} />
          <TripFact label="Passenger" value={booking.paxName} />
          <TripFact
            label="Bags"
            value={`${booking.bagCount} ${booking.bagCount === 1 ? "bag" : "bags"}`}
          />
          {/* "Total", not "Paid" — a booking can sit unpaid, and `priceCents`
              is the quote either way. */}
          <TripFact
            label="Total"
            value={`$${(booking.priceCents / 100).toFixed(2)} ${booking.currency.toUpperCase()}`}
          />
          <TripFact label="Reference" value={booking.ref} />
        </dl>
      </Link>
    </Card>
  );
}

/**
 * A finished trip: one line, no facts grid.
 *
 * History is scanned, not read. Everything a receipt needs — the seals, the
 * photos, the payment — is one tap away on the trip page, and repeating the
 * grid here would make ten past trips a page of scrolling for information
 * nobody is looking for.
 */
export function PastTripCard({ trip }: { trip: TripSummary }) {
  const { booking } = trip;
  return (
    <Card asChild interactive>
      <Link
        href={`/trips/${booking.id}`}
        className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 p-4"
      >
        <span className="flex min-w-0 flex-col">
          <span className="font-medium text-navy-800">
            {booking.flightNumber} · {booking.departureAirport}
          </span>
          <span className="text-sm text-muted-foreground">
            {formatInstantInAirportTz(booking.departureAt, trip.tz)} ·{" "}
            <span className="font-mono text-xs">{booking.ref}</span>
          </span>
        </span>
        <BookingStatusBadge status={booking.status} />
      </Link>
    </Card>
  );
}

function TripFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-medium text-navy-800">{value}</dd>
    </div>
  );
}
