import { and, eq, inArray, lte } from "drizzle-orm";
import {
  agreementAcceptances,
  airlineCutoffs,
  passportVerifications,
  pickupTasks,
  type Booking,
  type Database,
} from "@koolee/db";

import type { Session } from "../auth/types";
import { computeBagDropCutoffAt } from "../slots/cutoff";
import {
  bookingActionability,
  type BookingActionability,
} from "./actionability";
import { listBookingsForSession } from "./bookings";
import { getDisplayZones, zoneFor } from "./display-tz";
import { DRIVER_SELECTABLE_STATUSES } from "./driver-selection";

/**
 * The customer's trips, organised the way somebody actually reads them.
 *
 * WHY THIS IS A SERVICE AND NOT A PAGE. Three facts have to come together for
 * every row — where the booking sits in its lifecycle, where NOW sits against
 * its deadlines, and whether anything is waiting on the customer — and only
 * the first is on the booking row. A page assembling that itself would either
 * do it wrong or do it N times; and the moment a second surface needs "what
 * does this booking still want from me?", the logic forks.
 *
 * ONE QUERY PER FACT, never one per booking. `getBookingActionability` reads
 * the airline cutoff table on every call, which is fine for a trip page and
 * fifty round-trips for a list. The cutoff matrix is small (128 rows), so it
 * comes back whole and the PURE `bookingActionability` runs per booking — the
 * same function, the same answers, the same standing×phase axes. There is no
 * second rule engine here, which is the point.
 *
 * NEEDS ARE NOT STATUSES. "Accept the agreement" is not a lifecycle state; it
 * is a thing this booking is waiting for from this person, and the customer
 * reads the list to decide what to do next. Every need below is gated on
 * `actionability.can.*` first, so a booking past its bag-drop cutoff asks for
 * nothing — asking somebody to accept an agreement for a pickup that can no
 * longer happen is worse than saying nothing.
 */

/** What this booking is waiting on the customer for. */
export type TripNeed =
  /** Nobody can collect the bags until this is accepted. */
  | "accept_agreement"
  /** The shortlist is open and nobody is chosen yet. */
  | "choose_driver"
  /** Optional, and labelled as optional everywhere it is shown. */
  | "upload_passport";

export interface TripSummary {
  booking: Booking;
  /** The BOOKING's zone — the only one its times may be read in. */
  tz: string;
  actionability: BookingActionability;
  /** Empty when the booking is waiting on us rather than on them. */
  needs: TripNeed[];
}

export interface CustomerTrips {
  /** Soonest first. Everything still live. */
  upcoming: TripSummary[];
  /** Most recent first. Finished, cancelled, or the flight has gone. */
  past: TripSummary[];
}

/**
 * Bag-drop deadlines for a whole list, in one query.
 *
 * Keyed `AIRLINE:AIRPORT` and holding the STRICTEST minutes on record across
 * scopes, for the reason `resolveStrictestCutoffMinutes` documents: bookings
 * do not persist domestic vs international, and the looser row is a deadline
 * that runs late.
 */
async function cutoffMinutesByRoute(
  db: Database,
  now: Date,
): Promise<Map<string, number>> {
  const rows = await db
    .select({
      airline: airlineCutoffs.airlineIata,
      airport: airlineCutoffs.airportCode,
      minutes: airlineCutoffs.cutoffMinutesBeforeDeparture,
    })
    .from(airlineCutoffs)
    .where(lte(airlineCutoffs.effectiveFrom, now));

  const byRoute = new Map<string, number>();
  for (const row of rows) {
    const key = `${row.airline.toUpperCase()}:${row.airport}`;
    const existing = byRoute.get(key);
    byRoute.set(key, existing === undefined ? row.minutes : Math.max(existing, row.minutes));
  }
  return byRoute;
}

export interface ListCustomerTripsOptions {
  /** How many bookings to consider. Both lists are drawn from this window. */
  limit?: number;
}

export async function listCustomerTrips(
  db: Database,
  session: Session,
  now: Date,
  options: ListCustomerTripsOptions = {},
): Promise<CustomerTrips> {
  // Session-scoped in core: a customer session can only ever list its own.
  const bookings = await listBookingsForSession(db, session, {
    limit: options.limit ?? 50,
  });
  if (bookings.length === 0) return { upcoming: [], past: [] };

  const ids = bookings.map((booking) => booking.id);

  const [zones, cutoffs, accepted, passports, unclaimedPickups] = await Promise.all([
    getDisplayZones(db),
    cutoffMinutesByRoute(db, now),
    db
      .select({ bookingId: agreementAcceptances.bookingId })
      .from(agreementAcceptances)
      .where(inArray(agreementAcceptances.bookingId, ids)),
    db
      .select({
        bookingId: passportVerifications.bookingId,
        status: passportVerifications.status,
      })
      .from(passportVerifications)
      .where(inArray(passportVerifications.bookingId, ids)),
    // A pickup task with no shift is a booking nobody has been chosen for.
    // `driverShiftId` is the real assignment target (schema/tasks.ts), so its
    // absence is the question "have you picked your driver?" in one column.
    db
      .select({ bookingId: pickupTasks.bookingId })
      .from(pickupTasks)
      .where(and(inArray(pickupTasks.bookingId, ids), eq(pickupTasks.status, "assigned"))),
  ]);

  const hasAccepted = new Set(accepted.map((row) => row.bookingId));
  const passportByBooking = new Map(passports.map((row) => [row.bookingId, row.status]));
  const awaitingDriver = new Set(unclaimedPickups.map((row) => row.bookingId));

  const summaries: TripSummary[] = bookings.map((booking) => {
    const minutes = cutoffs.get(
      `${booking.airlineIata.toUpperCase()}:${booking.departureAirport}`,
    );
    const actionability = bookingActionability(
      {
        status: booking.status,
        pickupWindowEnd: booking.pickupWindowEnd ?? null,
        departureAt: booking.departureAt,
        bagDropCutoffAt:
          minutes === undefined
            ? null
            : computeBagDropCutoffAt(booking.departureAt, minutes),
      },
      now,
    );

    const needs: TripNeed[] = [];
    if (actionability.can.acceptAgreement && !hasAccepted.has(booking.id)) {
      needs.push("accept_agreement");
    }
    if (
      actionability.can.selectDriver &&
      (DRIVER_SELECTABLE_STATUSES as readonly string[]).includes(booking.status) &&
      awaitingDriver.has(booking.id)
    ) {
      needs.push("choose_driver");
    }
    // Optional by design — the agent checks the passport at the door either
    // way — so it comes LAST and is worded as a nicety wherever it is shown.
    if (
      actionability.can.uploadPassport &&
      (passportByBooking.get(booking.id) ?? "pending") === "pending"
    ) {
      needs.push("upload_passport");
    }

    return {
      booking,
      tz: zoneFor(zones, booking.departureAirport),
      actionability,
      needs,
    };
  });

  /*
   * PAST is "there is nothing left to watch", not "the status is final".
   *
   * A cancelled or completed booking is obviously done. So is one whose flight
   * has departed, whatever its status says — a `paid` booking for yesterday's
   * plane is not upcoming, and leaving it at the top of the list under
   * "Upcoming" is how a history list becomes untrustworthy.
   */
  const isPast = (trip: TripSummary) =>
    trip.actionability.standing === "terminal" || trip.actionability.phase === "departed";

  const upcoming = summaries.filter((trip) => !isPast(trip));
  const past = summaries.filter(isPast);

  // Soonest first: by the window if it has one, otherwise by departure. A
  // booking with no window yet is still sorted somewhere honest rather than
  // sinking to the bottom.
  const orderKey = (trip: TripSummary) =>
    (trip.booking.pickupWindowStart ?? trip.booking.departureAt).getTime();

  upcoming.sort((a, b) => orderKey(a) - orderKey(b));
  past.sort((a, b) => b.booking.departureAt.getTime() - a.booking.departureAt.getTime());

  return { upcoming, past };
}
