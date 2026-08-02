import { eq } from "drizzle-orm";
import { bookings } from "@koolee/db";

import type { CoreConfig } from "../config";
import { NotFoundError } from "../errors";

/**
 * Booking confirmation + receipt email.
 *
 * Goes through the `Notifier` seam, which is the ConsoleNotifier until Resend
 * is wired (TODO(resend) in notifications/notifier.ts) — so this is safe to
 * call today and starts sending for real the moment credentials exist.
 */
export async function sendBookingConfirmationEmail(
  config: CoreConfig,
  input: { bookingId: string; email: string },
): Promise<void> {
  const booking = await config.db.query.bookings.findFirst({
    where: eq(bookings.id, input.bookingId),
  });
  if (!booking) throw new NotFoundError("Booking", input.bookingId);

  const dollars = (booking.priceCents / 100).toFixed(2);
  await config.notifier.sendEmail({
    to: input.email,
    subject: `Koolee pickup confirmed — ${booking.flightNumber} from ${booking.departureAirport}`,
    body:
      `Your pickup is booked.\n\n` +
      `Flight ${booking.flightNumber} from ${booking.departureAirport}\n` +
      `${booking.bagCount} bag(s) · $${dollars} authorized (charged at pickup)\n\n` +
      `Every bag is ID-verified, sealed with a serialized tag, photographed at ` +
      `each hand-off, and delivered to your airline's bag drop.\n\n` +
      `Track your pickup: /trips/${booking.id}\n`,
  });
}
