import { eq } from "drizzle-orm";
import { bookings, type Booking } from "@koolee/db";

import type { CoreConfig } from "../config";
import { NotFoundError } from "../errors";
import { buildBookingConfirmationEmail, type PriceLine } from "../notifications/emails";
import { tripUrlFor } from "../notifications/links";
import type { EmailMessage } from "../notifications/notifier";
import { formatInstantInAirportTz, formatWindowInAirportTz } from "../slots/cutoff";
import { resolveDisplayTz } from "./display-tz";
import { bookingPickupAddress, formatPickupAddressLine } from "./pickup-address";

/**
 * Booking confirmation + receipt email — ONE builder, two dispatch points.
 *
 * The two are the `booking/confirmed` Inngest function (the normal path) and
 * `attachEmailPostBooking` (a guest who had no email when they paid and adds
 * one on the confirmed screen). They used to be two different emails: the
 * Inngest path sent the branded HTML template while this file hand-rolled a
 * plain-text body with a RELATIVE trip link (`/trips/<id>`), which is not a
 * link at all once it is in somebody's inbox. Whoever paid as a guest got the
 * worse email, and nothing in the type system said so.
 *
 * `assembleBookingConfirmationEmail` is the single place the row data becomes
 * a message; both callers dispatch it through the same `Notifier` seam and
 * differ only in what they do when the send fails.
 *
 * TIMEZONE: an email has no browser to fall back on, so every time here is
 * rendered explicitly in the booking's zone, abbreviation included (this is
 * the artifact customers screenshot and forward to whoever is at the house —
 * a bare "10:00 AM" in it outlives every well-labelled screen).
 */

export interface AssembleConfirmationEmailInput {
  booking: Booking;
  /** Verified at the call site — this function does not decide who to email. */
  to: string;
  /** Absolute app origin (NEXT_PUBLIC_APP_URL). Absent → no trip-link CTA. */
  appOrigin?: string | undefined;
}

/**
 * Reads the rows the template needs (address, zone) and builds the message.
 *
 * The price breakdown persisted at booking time is the truth of what was
 * charged — never recomputed here, because prices may have changed since.
 */
export async function assembleBookingConfirmationEmail(
  config: CoreConfig,
  input: AssembleConfirmationEmailInput,
): Promise<EmailMessage> {
  const { booking } = input;

  // Off the booking (0033). A confirmation is a record of what was agreed, so
  // it must render the address the booking was MADE for — not whatever the
  // saved address says today.
  const address = bookingPickupAddress(booking);
  const tz = await resolveDisplayTz(config.db, booking.departureAirport);

  const windowLabel =
    booking.pickupWindowStart && booking.pickupWindowEnd
      ? formatWindowInAirportTz(booking.pickupWindowStart, booking.pickupWindowEnd, tz)
      : "see your trip page";

  const bd = booking.priceBreakdown;
  const priceLines: PriceLine[] = bd
    ? [
        { label: "Base fee", amountCents: bd.baseFeeCents },
        { label: "Bags", amountCents: bd.bagsCents },
        { label: "Distance", amountCents: bd.distanceCents },
        ...(bd.leadTimeAdjustmentCents !== 0
          ? [
              {
                label: "Lead-time adjustment",
                amountCents: bd.leadTimeAdjustmentCents,
              },
            ]
          : []),
        ...bd.discounts.map((d) => ({ label: d.label, amountCents: -d.amountCents })),
      ]
    : [];

  const tripUrl = tripUrlFor(input.appOrigin, booking.id);

  return buildBookingConfirmationEmail({
    to: input.to,
    bookingRef: booking.ref,
    paxName: booking.paxName,
    flightNumber: booking.flightNumber,
    departureAirport: booking.departureAirport,
    windowLabel,
    departureLabel: formatInstantInAirportTz(booking.departureAt, tz),
    addressLine: formatPickupAddressLine(address),
    bagCount: booking.bagCount,
    priceLines,
    totalCents: bd?.totalCents ?? 0,
    ...(tripUrl === undefined ? {} : { tripUrl }),
  });
}

export interface SendConfirmationEmailInput {
  bookingId: string;
  email: string;
  /** Absolute app origin (NEXT_PUBLIC_APP_URL). Absent → no trip-link CTA. */
  appOrigin?: string | undefined;
}

/**
 * Sends the confirmation to an address supplied by the caller.
 *
 * Used by the guest-adds-email-after-payment path only. The ordinary path is
 * the `booking/confirmed` Inngest function, which owns its own idempotency
 * envelope; this one is driven by a human clicking Save and therefore has
 * none of its own — see the note in `attachEmailPostBooking` for why the two
 * cannot both fire for the same booking.
 */
export async function sendBookingConfirmationEmail(
  config: CoreConfig,
  input: SendConfirmationEmailInput,
): Promise<void> {
  const booking = await config.db.query.bookings.findFirst({
    where: eq(bookings.id, input.bookingId),
  });
  if (!booking) throw new NotFoundError("Booking", input.bookingId);

  const message = await assembleBookingConfirmationEmail(config, {
    booking,
    to: input.email,
    appOrigin: input.appOrigin,
  });
  await config.notifier.sendEmail(message);
}
