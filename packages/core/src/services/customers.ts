import { and, eq } from "drizzle-orm";
import { addresses, users, type Address, type Database, type User } from "@koolee/db";

import { assertInCoverage } from "../coverage/nyc-zips";

/**
 * Customer and address services.
 *
 * TODO(auth): the booking flow calls `ensureCustomerWithAddress` because
 * customer sign-in is not wired into it yet. Once the Supabase phone-OTP
 * session is threaded through (see `packages/core/src/auth`), the flow should
 * resolve `userId` from the session and only ever *add* an address to an
 * already-authenticated user. Creating a user as a side effect of booking is a
 * scaffold convenience, not the intended model.
 */

export interface UpsertCustomerInput {
  /** E.164. The natural key for a customer. */
  phone: string;
  fullName?: string | null;
  email?: string | null;
}

export async function upsertCustomerByPhone(
  db: Database,
  input: UpsertCustomerInput,
): Promise<User> {
  const [row] = await db
    .insert(users)
    .values({
      phone: input.phone,
      fullName: input.fullName ?? null,
      email: input.email ?? null,
      role: "customer",
    })
    .onConflictDoUpdate({
      target: users.phone,
      set: {
        fullName: input.fullName ?? null,
        email: input.email ?? null,
      },
    })
    .returning();

  if (!row) throw new Error("Upsert of customer returned no row");
  return row;
}

export interface AddressInput {
  line1: string;
  line2?: string | null;
  city: string;
  state: string;
  zip: string;
  lat?: number | null;
  lng?: number | null;
  placeId?: string | null;
}

/**
 * Finds an identical address for the user, or creates one.
 *
 * Deduplicating on the full address keeps repeat bookings from accumulating a
 * row per booking. Coverage is asserted here so an out-of-area address never
 * reaches the database.
 */
export async function ensureAddress(
  db: Database,
  userId: string,
  input: AddressInput,
): Promise<Address> {
  const zip = assertInCoverage(input.zip);

  const existing = await db
    .select()
    .from(addresses)
    .where(
      and(
        eq(addresses.userId, userId),
        eq(addresses.line1, input.line1),
        eq(addresses.zip, zip),
      ),
    )
    .limit(1);

  const found = existing[0];
  if (found) return found;

  const [created] = await db
    .insert(addresses)
    .values({
      userId,
      line1: input.line1,
      line2: input.line2 ?? null,
      city: input.city,
      state: input.state.toUpperCase(),
      zip,
      lat: input.lat ?? null,
      lng: input.lng ?? null,
      placeId: input.placeId ?? null,
    })
    .returning();

  if (!created) throw new Error("Insert of address returned no row");
  return created;
}

export interface EnsureCustomerWithAddressInput extends AddressInput {
  phone: string;
  fullName?: string | null;
  email?: string | null;
}

/** Convenience for the booking flow: customer + address in one call. */
export async function ensureCustomerWithAddress(
  db: Database,
  input: EnsureCustomerWithAddressInput,
): Promise<{ user: User; address: Address }> {
  const user = await upsertCustomerByPhone(db, {
    phone: input.phone,
    fullName: input.fullName ?? null,
    email: input.email ?? null,
  });

  const address = await ensureAddress(db, user.id, input);
  return { user, address };
}
