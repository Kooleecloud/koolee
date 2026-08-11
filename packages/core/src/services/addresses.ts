import { and, desc, eq } from "drizzle-orm";
import { addresses, bookings, type Address, type Database } from "@koolee/db";

import type { Session } from "../auth/types";
import { assertInCoverage } from "../coverage/nyc-zips";
import { ConflictError, NotAuthorizedError, NotFoundError } from "../errors";

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
}

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

  const [row] = await db
    .update(addresses)
    .set({
      label: input.label?.trim() || null,
      line1: input.line1,
      line2: input.line2 ?? null,
      city: input.city,
      state: input.state.toUpperCase(),
      zip,
    })
    // Ownership in the WHERE clause: a foreign id updates zero rows.
    .where(and(eq(addresses.id, addressId), eq(addresses.userId, session.userId)))
    .returning();
  if (!row) throw new NotFoundError("Address", addressId);
  return row;
}

/**
 * Deletes a saved address. An address referenced by a booking is part of the
 * custody record (`bookings.pickup_address_id` is ON DELETE RESTRICT) — that
 * comes back as a typed conflict for the UI, checked first so the customer
 * gets a sentence instead of a database error.
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

  const used = await db.query.bookings.findFirst({
    where: eq(bookings.pickupAddressId, addressId),
    columns: { id: true },
  });
  if (used) {
    throw new ConflictError(
      "address",
      "That address is part of a booking's record and can't be deleted.",
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
