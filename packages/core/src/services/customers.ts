import { and, eq, notExists } from "drizzle-orm";
import {
  addresses,
  bookings,
  users,
  type Address,
  type Database,
  type User,
} from "@koolee/db";

import { ConflictError, NotFoundError } from "../errors";
import { assertInCoverage } from "../coverage/nyc-zips";

/**
 * Customer and address services.
 *
 * Every customer row is keyed by the Supabase auth uid (`users.id =
 * auth.uid()`): the funnel materialises it via `ensureCustomerFromAuth` (the
 * anonymous session IS a valid customer at draft time), and the verified
 * identity is attached in place by `attachVerifiedPhone`/`attachEmail` — the
 * uid never changes on upgrade. The scaffold-era path that created customers
 * as a side effect of booking (`upsertCustomerByPhone` and friends) is gone;
 * booking creation resolves `userId` from the session, nothing else.
 */

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
 * Never requires a phone — an anonymous funnel user has none until the
 * payment gate.
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
 *
 * Also refuses a row that owns any `bookings` — an anonymous user cannot
 * reach the payment step, so such a row is an invariant violation to
 * investigate, not silently destroy. (The `bookings.user_id` ON DELETE
 * RESTRICT would reject it anyway; checking first keeps the phone-conflict
 * flow's cleanup a clean no-op instead of a thrown-and-swallowed error.)
 */
export async function deleteAnonymousCustomer(
  db: Database,
  authUserId: string,
): Promise<boolean> {
  const deleted = await db
    .delete(users)
    .where(
      and(
        eq(users.id, authUserId),
        eq(users.isAnonymous, true),
        notExists(
          db.select({ one: bookings.id }).from(bookings).where(eq(bookings.userId, users.id)),
        ),
      ),
    )
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

