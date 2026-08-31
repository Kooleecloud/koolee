import Link from "next/link";
import { Plane } from "lucide-react";
import { Badge, BookingStatusBadge, Card } from "@koolee/ui";
import {
  formatInstantInAirportTz,
  formatWindowInAirportTz,
  type TripNeed,
  type TripSummary,
} from "@koolee/core";

import { flightRouteLabel, flightRouteText } from "@/lib/flight-label";

/**
 * One trip, in a list.
 *
 * TWO DENSITIES, one component. An upcoming trip is something you are about to
 * live through and may need to act on; a past one is a receipt. Rendering both
 * from the same file is what keeps them recognisably the same object — a
 * separate "history card" drifts into a different vocabulary within a slice.
 *
 * WHAT A CARD LEADS WITH. The route, not the flight number. "AI144 · EWR" is
 * the one detail nobody remembers about their own trip, and a history list of
 * them is a list of things that all look alike; "EWR → DEL" is how somebody
 * actually recalls a journey. See `flightRouteLabel` for what happens when we
 * do not know the destination, which is ordinary.
 *
 * THE PASSENGER NAME IS ON BOTH DENSITIES, and that is not padding. A booking
 * can be made FOR somebody else — a parent booking their student's pickup, an
 * assistant booking their director's — and in that account's history the
 * traveller's name is the only thing that tells two otherwise identical trips
 * apart.
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

const dollars = (cents: number, currency: string) =>
  `$${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;

const bagsLabel = (count: number) => `${count} ${count === 1 ? "bag" : "bags"}`;

/**
 * The route line every card leads with, in both densities. The flight number
 * rides along underneath as a detail rather than as the headline.
 */
function RouteHeading({ trip }: { trip: TripSummary }) {
  const { booking } = trip;
  return (
    <span className="flex min-w-0 flex-col gap-1">
      <span className="font-display font-semibold text-navy-800">
        {/* The arrow is decorative: a screen reader gets "EWR to DEL". */}
        <span aria-hidden>{flightRouteLabel(booking)}</span>
        <span className="sr-only">{flightRouteText(booking)}</span>
      </span>
      <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Plane aria-hidden className="size-3.5 shrink-0 text-sky-700" />
        {booking.flightNumber} · {formatInstantInAirportTz(booking.departureAt, trip.tz)}
      </span>
    </span>
  );
}

export function UpcomingTripCard({ trip }: { trip: TripSummary }) {
  const { booking } = trip;
  return (
    <Card asChild interactive>
      <Link href={`/trips/${booking.id}`} className="flex flex-col gap-4 p-5">
        <span className="flex items-start justify-between gap-4">
          <RouteHeading trip={trip} />
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
          <TripFact label="Traveller" value={booking.paxName} />
          <TripFact label="Bags" value={bagsLabel(booking.bagCount)} />
          {/* "Total", not "Paid" — a booking can sit unpaid, and `priceCents`
              is the quote either way. */}
          <TripFact
            label="Total"
            value={dollars(booking.priceCents, booking.currency)}
          />
          <TripFact label="Reference" value={booking.ref} />
        </dl>
      </Link>
    </Card>
  );
}

/**
 * A finished trip.
 *
 * IT USED TO BE ONE LINE — flight number, airport, departure, ref — on the
 * theory that history is scanned rather than read. That was the right instinct
 * and the wrong content: a line of flight numbers is unscannable, because the
 * one field it led with is the one nobody recalls. So this stays compact and
 * one tap from everything, but it carries what makes a trip RECOGNISABLE: the
 * route, when it flew, who travelled, how many bags, and what it cost.
 */
export function PastTripCard({ trip }: { trip: TripSummary }) {
  const { booking } = trip;
  return (
    <Card asChild interactive>
      <Link
        href={`/trips/${booking.id}`}
        className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
      >
        <RouteHeading trip={trip} />

        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground sm:justify-end">
          <span>{booking.paxName}</span>
          <span aria-hidden>·</span>
          <span>{bagsLabel(booking.bagCount)}</span>
          <span aria-hidden>·</span>
          <span>{dollars(booking.priceCents, booking.currency)}</span>
          <span aria-hidden>·</span>
          <span className="font-mono text-xs">{booking.ref}</span>
          <BookingStatusBadge status={booking.status} />
        </span>
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
