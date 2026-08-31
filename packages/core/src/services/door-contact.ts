/**
 * The number the person at the door can be reached on.
 *
 * WHY THIS EXISTS, AND WHAT IT CHANGES.
 *
 * The agent app showed a disabled "No number" button on most jobs, and it was
 * not a bug in the app — it was reading `bookings.contact_phone`, which is
 * only ever set for EMAIL-ONLY customers (the funnel asks for a door number
 * precisely when it has no verified phone). Every customer who signed up with
 * a phone — the overwhelming majority, since phone OTP is the primary
 * identity — had their number on `users.phone` and it was deliberately never
 * selected: both agent contexts commented that "a driver has no business
 * reading a customer's phone off this join".
 *
 * That was the wrong call in practice. A driver standing outside a building
 * with no buzzer answer has exactly one useful action, and refusing them the
 * number does not protect the customer — it strands both of them, and the
 * fallback is a support call that ends with somebody reading the number out
 * anyway.
 *
 * WHAT IS STILL WITHHELD. This resolves ONE field and nothing else. Email,
 * verification timestamps and the rest of the user row remain unselected in
 * the agent contexts, and the number reaches only the assignee of a live task
 * on that booking — the same relationship that already grants them the
 * address, the traveller's name and their face.
 *
 * PRECEDENCE. The booking's own `contact_phone` wins when present: an
 * email-only customer typed it FOR this pickup, and it may be a different
 * number from any on the account (a hotel desk, the person actually home).
 */

export interface DoorContact {
  phone: string;
  /**
   * Where it came from. `booking` was given for this pickup specifically;
   * `account` is the customer's verified number. The agent app does not branch
   * on this — it exists so a support conversation can tell the two apart.
   */
  source: "booking" | "account";
}

export function doorContact(
  booking: { contactPhone: string | null },
  customer: { phone?: string | null } | null,
): DoorContact | null {
  const onBooking = booking.contactPhone?.trim();
  if (onBooking) return { phone: onBooking, source: "booking" };

  const onAccount = customer?.phone?.trim();
  if (onAccount) return { phone: onAccount, source: "account" };

  // A real state: an email-only customer who somehow reached a booking without
  // a door number. The agent app says so rather than pretending.
  return null;
}
