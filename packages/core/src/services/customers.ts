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

export interface UpsertCustomerFromAuthInput {
  /** Supabase auth user id (`auth.uid()`). Used as `users.id` on first sign-in. */
  authUserId: string;
  /** E.164. Must match the phone the OTP was verified against. */
  phone: string;
  fullName?: string | null;
  email?: string | null;
}

/**
 * Upserts the customer row after a verified phone-OTP sign-in, keyed by the
 * Supabase auth user id.
 *
 * Inserting with `id = auth.uid()` is what makes the RLS policies in
 * packages/db work — they compare `auth.uid()` to `bookings.user_id`. Two
 * conflict cases are handled:
 *
 *  - Same phone, pre-auth scaffold row (random id): the phone unique index
 *    wins and the legacy row is kept, id unchanged. Server-side reads still
 *    authorize via `canActOnBooking`, so this only forfeits client-side RLS
 *    for that legacy user.
 *  - Same auth id, changed phone (number migrated in Supabase): the primary
 *    key wins; we fall back to updating the row by id.
 */
export async function upsertCustomerFromAuth(
  db: Database,
  input: UpsertCustomerFromAuthInput,
): Promise<User> {
  try {
    const [row] = await db
      .insert(users)
      .values({
        id: input.authUserId,
        phone: input.phone,
        fullName: input.fullName ?? null,
        email: input.email ?? null,
        role: "customer",
      })
      .onConflictDoUpdate({
        target: users.phone,
        set: {
          phone: input.phone,
          ...(input.fullName !== undefined ? { fullName: input.fullName } : {}),
          ...(input.email !== undefined ? { email: input.email } : {}),
        },
      })
      .returning();

    if (!row) throw new Error("Upsert of authenticated customer returned no row");
    return row;
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    // Primary-key conflict: the auth user exists under a different phone.
    const [row] = await db
      .update(users)
      .set({
        phone: input.phone,
        ...(input.fullName !== undefined ? { fullName: input.fullName } : {}),
        ...(input.email !== undefined ? { email: input.email } : {}),
      })
      .where(eq(users.id, input.authUserId))
      .returning();

    if (!row) throw new Error("Update of authenticated customer returned no row");
    return row;
  }
}

/** Postgres unique_violation (23505), as surfaced by postgres-js. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
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
