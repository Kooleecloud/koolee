import type { Address } from "@koolee/db";

/**
 * The pickup snapshot columns a `bookings` insert needs, derived from the
 * address a test already created.
 *
 * WHY IT EXISTS. Since 0033 a booking carries its own doorstep, and four of
 * those columns are NOT NULL. Every integration test that inserts a booking
 * directly — nine of them, none sharing a factory — would otherwise repeat
 * the same eight lines, and a test that made up its own ZIP while pointing
 * `pickupAddressId` at an address with a different one would be exercising a
 * state production cannot produce.
 *
 * Deriving from the `Address` row keeps the two in step by construction,
 * which matters most for the zone and coverage tests: the ZIP the dispatch
 * query reads is now the booking's, not the address's.
 */
export function pickupSnapshotOf(address: Address) {
  return {
    pickupAddressId: address.id,
    pickupLine1: address.line1,
    pickupLine2: address.line2,
    pickupCity: address.city,
    pickupState: address.state,
    pickupZip: address.zip,
    pickupLat: address.lat,
    pickupLng: address.lng,
    pickupPlaceId: address.placeId,
  };
}
