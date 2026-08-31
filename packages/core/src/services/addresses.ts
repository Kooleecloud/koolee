import { and, desc, eq, inArray } from "drizzle-orm";
import {
  addresses,
  bookings,
  type Address,
  type BookingStatus,
  type Database,
} from "@koolee/db";

import type { Session } from "../auth/types";
import { assertInCoverage } from "../coverage/nyc-zips";
import { ConflictError, NotAuthorizedError, NotFoundError } from "../errors";
import { resolveAddressPoint } from "./customers";

/**
 * Saved-address CRUD for the customer account area.
 *
 * Ownership is enforced HERE (authorization lives in core, not RLS): every
 * mutation resolves the row by (id, session.userId) so someone else's
 * address id behaves exactly like a missing one. Coverage is asserted on
 * every save — an out-of-area address never reaches the database.
 */

export interface SavedAddressInput {
  label?: string | null;
  line1: string;
  line2?: string | null;
  city: string;
  state: string;
  zip: string;
  /**
   * The precise point behind the address, when Places supplied one.
   *
   * Absent is ordinary — a hand-typed address has none — and the ZIP centroid
   * is written instead (`resolveAddressPoint`). What must NEVER happen is a
   * coordinate arriving with an address it does not belong to: the caller
   * clears these the moment any address field is hand-edited, for the same
   * reason the funnel's pickup step does. A point that is confidently wrong
   * misprices the trip and sends the driver to the wrong door.
   */
  lat?: number | null;
  lng?: number | null;
  placeId?: string | null;
}

/**
 * Statuses where a pickup at this address is still going to happen.
 *
 * `draft` is in the list: an unpaid booking in the funnel is somebody
 * mid-checkout, and pulling the address out from under them is worse than a
 * sentence asking them to finish first. Everything terminal, delivered, or in
 * an exception is out — those trips have no future visit to protect.
 */
const LIVE_BOOKING_STATUSES: readonly BookingStatus[] = [
  "draft",
  "paid",
  "agent_assigned",
  "verified_sealed",
  "awaiting_pickup",
  "in_transit",
];

function requireCustomer(session: Session): void {
  if (session.kind !== "customer") {
    throw new NotAuthorizedError("Only customers manage saved addresses.");
  }
}

export async function listAddressesForSession(
  db: Database,
  session: Session,
): Promise<Address[]> {
  requireCustomer(session);
  return db
    .select()
    .from(addresses)
    .where(eq(addresses.userId, session.userId))
    .orderBy(desc(addresses.createdAt));
}

export async function createAddressForSession(
  db: Database,
  session: Session,
  input: SavedAddressInput,
): Promise<Address> {
  requireCustomer(session);
  const zip = assertInCoverage(input.zip);

  const point = await resolveAddressPoint(db, zip, input);

  const [row] = await db
    .insert(addresses)
    .values({
      userId: session.userId,
      label: input.label?.trim() || null,
      line1: input.line1,
      line2: input.line2 ?? null,
      city: input.city,
      state: input.state.toUpperCase(),
      zip,
      lat: point.lat,
      lng: point.lng,
      placeId: input.placeId ?? null,
    })
    .returning();
  if (!row) throw new Error("Insert of address returned no row");
  return row;
}

export async function updateAddressForSession(
  db: Database,
  session: Session,
  addressId: string,
  input: SavedAddressInput,
): Promise<Address> {
  requireCustomer(session);
  const zip = assertInCoverage(input.zip);

  const point = await resolveAddressPoint(db, zip, input);

  const [row] = await db
    .update(addresses)
    .set({
      label: input.label?.trim() || null,
      line1: input.line1,
      line2: input.line2 ?? null,
      city: input.city,
      state: input.state.toUpperCase(),
      zip,
      // Rewritten, not merged: an edit that moved the address must not keep
      // the old point. `resolveAddressPoint` falls back to the new ZIP's
      // centroid, which is the correct coarse answer for a hand-edited row.
      lat: point.lat,
      lng: point.lng,
      placeId: input.placeId ?? null,
    })
    // Ownership in the WHERE clause: a foreign id updates zero rows.
    .where(and(eq(addresses.id, addressId), eq(addresses.userId, session.userId)))
    .returning();
  if (!row) throw new NotFoundError("Address", addressId);
  return row;
}

/**
 * Deletes a saved address.
 *
 * IT NO LONGER MATTERS WHETHER A BOOKING USED IT. Until 0033 this refused —
 * `bookings.pickup_address_id` was `ON DELETE RESTRICT` and the booking held
 * no address of its own, so the row was load-bearing evidence and the customer
 * got "that address is part of a booking's record and can't be deleted" for
 * an address they had used once, a year ago, and would never use again.
 *
 * The booking now carries its own snapshot of the doorstep, so deleting this
 * takes nothing with it: the FK is `ON DELETE SET NULL` and only the
 * PROVENANCE pointer goes null. What the agent saw, what the email said and
 * what a dispute would read are all still on the booking.
 *
 * The ONE thing still refused is deleting an address a LIVE booking is
 * counting on — not because the record needs it, but because a customer who
 * deletes "Home" the night before a pickup has almost certainly mistaken this
 * for cancelling, and a booking whose address just vanished from their account
 * is a support call either way. Finished trips place no such claim.
 */
export async function deleteAddressForSession(
  db: Database,
  session: Session,
  addressId: string,
): Promise<void> {
  requireCustomer(session);

  const owned = await db.query.addresses.findFirst({
    where: and(eq(addresses.id, addressId), eq(addresses.userId, session.userId)),
    columns: { id: true },
  });
  if (!owned) throw new NotFoundError("Address", addressId);

  const live = await db.query.bookings.findFirst({
    where: and(
      eq(bookings.pickupAddressId, addressId),
      inArray(bookings.status, LIVE_BOOKING_STATUSES),
    ),
    columns: { id: true, ref: true },
  });
  if (live) {
    throw new ConflictError(
      "address",
      `Booking ${live.ref} has a pickup scheduled at this address. You can remove it once that trip is done.`,
    );
  }

  await db
    .delete(addresses)
    .where(and(eq(addresses.id, addressId), eq(addresses.userId, session.userId)));
}

/** A single owned address, for the funnel's saved-address prefill. */
export async function getAddressForSession(
  db: Database,
  session: Session,
  addressId: string,
): Promise<Address | null> {
  requireCustomer(session);
  const row = await db.query.addresses.findFirst({
    where: and(eq(addresses.id, addressId), eq(addresses.userId, session.userId)),
  });
  return row ?? null;
}
