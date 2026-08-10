/**
 * Short human-quotable reference for a booking.
 *
 * The last segment of the UUID: six hex characters, which is short enough for
 * an operator to read out on a call and 16.7M-wide, so two rows on one board
 * will not collide. Deliberately a display convention over the real id, not a
 * second identifier — nothing looks a booking up by this, and the full UUID is
 * still the link target and is shown on the detail page.
 */
export function bookingRef(id: string): string {
  return id.slice(-6).toUpperCase();
}
