/**
 * Short, human-quotable reference for a booking.
 *
 * Bookings have no ticket or PNR column — the airline's own ticket number is
 * never captured — so there is nothing "official" to show. A raw UUID is
 * useless over the phone, so this derives a stable short code from it: same
 * booking, same code, every time, with no extra column and nothing to migrate.
 *
 * Not an identifier for lookups. Six hex characters collide eventually; this
 * exists so a customer and an agent can agree on which trip they mean, and the
 * agent still resolves it against the full id.
 */
export function bookingReference(bookingId: string): string {
  const hex = bookingId.replace(/[^0-9a-fA-F]/g, "");
  if (hex.length < 6) return "KL-------".slice(0, 3 + hex.length).toUpperCase();
  return `KL-${hex.slice(-6).toUpperCase()}`;
}
