import { eq } from "drizzle-orm";
import { bookings } from "@koolee/db";

import type { CoreConfig } from "../config";
import { NotFoundError } from "../errors";
import {
  dstTransitionNote,
  formatInstantInAirportTz,
  formatWindowInAirportTz,
} from "../slots/cutoff";
import { resolveDisplayTz } from "./display-tz";

/**
 * Booking confirmation + receipt email.
 *
 * Goes through the `Notifier` seam, which is the ConsoleNotifier until Resend
 * is wired (TODO(resend) in notifications/notifier.ts) — so this is safe to
 * call today and starts sending for real the moment credentials exist.
 *
 * TIMEZONE: an email has no browser to fall back on, so every time here is
 * rendered explicitly in the booking's zone, abbreviation included. This is
 * also the artifact customers screenshot and forward to whoever is at the
 * house — a bare "10:00 AM" in it outlives every well-labelled screen.
 */
export async function sendBookingConfirmationEmail(
  config: CoreConfig,
  input: { bookingId: string; email: string },
): Promise<void> {
  const booking = await config.db.query.bookings.findFirst({
    where: eq(bookings.id, input.bookingId),
  });
  if (!booking) throw new NotFoundError("Booking", input.bookingId);

  const tz = await resolveDisplayTz(config.db, booking.departureAirport);

  const window =
    booking.pickupWindowStart && booking.pickupWindowEnd
      ? formatWindowInAirportTz(booking.pickupWindowStart, booking.pickupWindowEnd, tz)
      : booking.pickupWindowStart
        ? formatInstantInAirportTz(booking.pickupWindowStart, tz)
        : null;

  // Only ever non-null on the two DST nights a year — but those windows sell
  // like any other, and the label alone is ambiguous on one of them.
  const windowNote = booking.pickupWindowStart
    ? dstTransitionNote(booking.pickupWindowStart, tz)
    : null;

  const dollars = (booking.priceCents / 100).toFixed(2);
  await config.notifier.sendEmail({
    to: input.email,
    subject: `Koolee pickup confirmed — ${booking.flightNumber} from ${booking.departureAirport}`,
    body:
      `Your pickup is booked.\n\n` +
      (window
        ? `Pickup window: ${window}\n` +
          (windowNote ? `  (${windowNote})\n` : "") +
          `All times are local to ${booking.departureAirport}.\n\n`
        : "") +
      `Flight ${booking.flightNumber} from ${booking.departureAirport}\n` +
      `Departs ${formatInstantInAirportTz(booking.departureAt, tz)}\n` +
      `${booking.bagCount} bag(s) · $${dollars} authorized (charged at pickup)\n\n` +
      `Every bag is ID-verified, sealed with a serialized tag, photographed at ` +
      `each hand-off, and delivered to your airline's bag drop.\n\n` +
      `Track your pickup: /trips/${booking.id}\n`,
  });
}
