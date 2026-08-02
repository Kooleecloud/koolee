import { and, eq } from "drizzle-orm";
import { addresses, users, type Address, type Database, type User } from "@koolee/db";

import { ConflictError, NotFoundError } from "../errors";
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

    if (!row) {
      throw new Error("Update of authenticated customer returned no row", {
        cause: error,
      });
    }
    return row;
  }
}

/**
 * Postgres unique_violation (23505).
 *
 * drizzle-orm ≥ 0.44 wraps driver errors in `DrizzleQueryError` with the
 * postgres-js error on `cause`, so walk the cause chain rather than assuming
 * the code sits on the top-level error.
 */
function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  while (typeof current === "object" && current !== null) {
    if ((current as { code?: unknown }).code === "23505") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Auth lifecycle: anonymous funnel user → verified customer            */
/* ------------------------------------------------------------------ */

export interface EnsureCustomerFromAuthInput {
  /** Supabase auth user id (`auth.uid()`). Becomes `users.id`. */
  authUserId: string;
  /** True when the Supabase session is anonymous (guest funnel). */
  isAnonymous: boolean;
  /** E.164, when the auth user already carries a verified phone. */
  phone?: string | null;
  email?: string | null;
  fullName?: string | null;
}

/**
 * Idempotently materialises the `public.users` row for an auth user and
 * touches `last_seen_at`. Called the first time funnel state is persisted
 * (anonymous session) and on every sign-in.
 *
 * Unlike `upsertCustomerFromAuth` this never requires a phone — an anonymous
 * funnel user has none until the payment gate.
 */
export async function ensureCustomerFromAuth(
  db: Database,
  input: EnsureCustomerFromAuthInput,
): Promise<User> {
  const now = new Date();

  const [inserted] = await db
    .insert(users)
    .values({
      id: input.authUserId,
      phone: input.phone ?? null,
      email: input.email ?? null,
      fullName: input.fullName ?? null,
      isAnonymous: input.isAnonymous,
      ...(input.phone ? { phoneVerifiedAt: now } : {}),
      role: "customer",
      lastSeenAt: now,
    })
    .onConflictDoNothing({ target: users.id })
    .returning();

  if (inserted) return inserted;

  const [updated] = await db
    .update(users)
    .set({ lastSeenAt: now })
    .where(eq(users.id, input.authUserId))
    .returning();

  if (!updated) {
    // Insert conflicted on something other than the PK (phone/email unique).
    const existing = await db.query.users.findFirst({
      where: eq(users.id, input.authUserId),
    });
    if (existing) return existing;
    throw new ConflictError(
      input.phone ? "phone" : "email",
      "Could not create the customer row: a unique identifier is already taken.",
    );
  }
  return updated;
}

export async function getCustomerById(db: Database, id: string): Promise<User | null> {
  const row = await db.query.users.findFirst({ where: eq(users.id, id) });
  return row ?? null;
}

/**
 * Records a successful phone OTP verification. The uid never changes — this is
 * the anonymous → permanent upgrade (or a returning sign-in touch).
 */
export async function attachVerifiedPhone(
  db: Database,
  input: { authUserId: string; phone: string },
): Promise<User> {
  const now = new Date();
  try {
    const [row] = await db
      .update(users)
      .set({
        phone: input.phone,
        phoneVerifiedAt: now,
        isAnonymous: false,
        lastSeenAt: now,
      })
      .where(eq(users.id, input.authUserId))
      .returning();

    if (!row) throw new NotFoundError("User", input.authUserId);
    return row;
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError("phone");
    throw error;
  }
}

/**
 * Records an email on the account. `verified: true` for the email-OTP upgrade
 * path (§3.3); `verified: false` for the fire-and-forget post-booking attach,
 * where `email_verified_at` is set later by the confirmation callback.
 */
export async function attachEmail(
  db: Database,
  input: { authUserId: string; email: string; verified: boolean },
): Promise<User> {
  const now = new Date();
  try {
    const [row] = await db
      .update(users)
      .set({
        email: input.email,
        emailVerifiedAt: input.verified ? now : null,
        ...(input.verified ? { isAnonymous: false } : {}),
        lastSeenAt: now,
      })
      .where(eq(users.id, input.authUserId))
      .returning();

    if (!row) throw new NotFoundError("User", input.authUserId);
    return row;
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError("email");
    throw error;
  }
}

/** Marks the email verified after the confirmation link/OTP round-trips. */
export async function markEmailVerified(
  db: Database,
  input: { authUserId: string; email?: string | null },
): Promise<User | null> {
  const [row] = await db
    .update(users)
    .set({
      emailVerifiedAt: new Date(),
      ...(input.email ? { email: input.email } : {}),
    })
    .where(eq(users.id, input.authUserId))
    .returning();
  return row ?? null;
}

export interface CompleteProfileInput {
  authUserId: string;
  fullName?: string | null;
  email?: string | null;
}

/** Saves the optional profile and stamps `profile_completed_at`. */
export async function completeProfile(
  db: Database,
  input: CompleteProfileInput,
): Promise<User> {
  try {
    const [row] = await db
      .update(users)
      .set({
        ...(input.fullName !== undefined ? { fullName: input.fullName } : {}),
        ...(input.email ? { email: input.email } : {}),
        profileCompletedAt: new Date(),
      })
      .where(eq(users.id, input.authUserId))
      .returning();

    if (!row) throw new NotFoundError("User", input.authUserId);
    return row;
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError("email");
    throw error;
  }
}

/**
 * Deletes an orphaned anonymous `public.users` row after its draft has been
 * re-parented onto an existing account (phone-conflict flow). Refuses to touch
 * non-anonymous rows; returns false when nothing was deleted.
 */
export async function deleteAnonymousCustomer(
  db: Database,
  authUserId: string,
): Promise<boolean> {
  const deleted = await db
    .delete(users)
    .where(and(eq(users.id, authUserId), eq(users.isAnonymous, true)))
    .returning({ id: users.id });
  return deleted.length > 0;
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
