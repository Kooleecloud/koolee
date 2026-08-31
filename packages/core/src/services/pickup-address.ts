import type { Booking } from "@koolee/db";

/**
 * The one reader for a booking's doorstep.
 *
 * WHY THIS EXISTS RATHER THAN A JOIN. Until 0033 the address lived only in
 * `addresses` and nine call sites joined through `bookings.pickup_address_id`
 * to reach it. That made the customer's saved-address row a live input to
 * historical records: editing "Home" to fix a typo rewrote the doorstep on a
 * pickup that had already happened, and deleting it was refused outright
 * because a booking still pointed at it.
 *
 * The address is now snapshotted onto the booking at creation and never
 * updated, exactly like `display_tz`. `pickup_address_id` survives as
 * PROVENANCE — which saved address this came from — and goes NULL when the
 * customer deletes that address. Nothing renders from it.
 *
 * So: every surface that needs to know where to knock calls this. It takes a
 * booking row and returns a value; there is no query, which is the point.
 */

export interface PickupAddress {
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  zip: string;
  /** Null when the address was typed rather than chosen from Places. */
  lat: number | null;
  lng: number | null;
  placeId: string | null;
}

/** The columns this reads. Accepts a whole `Booking` or any row carrying them. */
export type BookingWithPickupAddress = Pick<
  Booking,
  | "pickupLine1"
  | "pickupLine2"
  | "pickupCity"
  | "pickupState"
  | "pickupZip"
  | "pickupLat"
  | "pickupLng"
  | "pickupPlaceId"
>;

export function bookingPickupAddress(
  booking: BookingWithPickupAddress,
): PickupAddress {
  return {
    line1: booking.pickupLine1,
    line2: booking.pickupLine2,
    city: booking.pickupCity,
    state: booking.pickupState,
    zip: booking.pickupZip,
    lat: booking.pickupLat,
    lng: booking.pickupLng,
    placeId: booking.pickupPlaceId,
  };
}

/**
 * One line, for a maps link, an email, or a screen reader.
 *
 * Empty parts are dropped rather than rendered as stray commas — `line2` is
 * usually absent and a "22 W 34th St, , New York, NY 10001" is the kind of
 * detail that makes a confirmation email look automated.
 */
export function formatPickupAddressLine(address: PickupAddress): string {
  return [
    address.line1,
    address.line2,
    address.city,
    [address.state, address.zip].filter(Boolean).join(" "),
  ]
    .filter((part) => part && part.trim().length > 0)
    .join(", ");
}

/** The precise point, when there is one. Null means "fall back to the ZIP". */
export function pickupCoordinates(
  address: PickupAddress,
): { lat: number; lng: number } | null {
  return address.lat !== null && address.lng !== null
    ? { lat: address.lat, lng: address.lng }
    : null;
}
