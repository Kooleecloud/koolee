import { and, eq, sql, type SQL } from "drizzle-orm";
import { bookingDrafts, users, type Database } from "@koolee/db";

import { hashDestination } from "./hash-destination";

/**
 * `phone_change` / `email_change` collision reconciliation.
 *
 * Supabase resolves a phone-change verification by matching the submitted
 * number against `auth.users.phone_change`, which is NOT unique. The funnel
 * deliberately produces abandoned anonymous sessions that may have written a
 * `phone_change` value — so two rows can claim the same number, and
 * `verifyOtp({ type: "phone_change" })` could attach the phone to the wrong
 * row, landing a customer in a stranger's session.
 *
 * Run one of these BEFORE every phone/email-change OTP send:
 *
 *  - colliding ANONYMOUS rows are disposable abandoned sessions: their draft,
 *    `public.users` row, and auth user are deleted, removing the competing
 *    claim at the source;
 *  - a colliding PERMANENT row is never touched: the caller gets
 *    `conflict: true` and must route into the sign-in branch instead of
 *    `updateUser` — detecting this BEFORE the send saves a verification fee
 *    and replaces after-the-fact error-message parsing.
 *
 * Reads of `auth.users` go through the service-role SQL connection (read-only
 * — GoTrue owns all writes to that table); the auth-user delete goes through
 * the injected admin callback so this package stays free of the Supabase SDK.
 */

export interface ReconcileClaimsOptions {
  /** The session performing the upgrade — never touched. */
  currentUserId: string;
  /**
   * Deletes the Supabase auth user (`supabase.auth.admin.deleteUser`).
   * Called inside the transaction so a failure rolls back the row deletes.
   */
  deleteAuthUser?: (userId: string) => Promise<void>;
  log?: (message: string) => void;
}

export interface ReconcileClaimsResult {
  /** True when a permanent account already holds the identifier. */
  conflict: boolean;
  /** Anonymous colliding sessions removed (draft + row + auth user). */
  removedAnonymousUserIds: string[];
}

/** Reconciles claims on a phone number. `phone` must be E.164. */
export async function reconcilePhoneClaims(
  db: Database,
  phone: string,
  options: ReconcileClaimsOptions,
): Promise<ReconcileClaimsResult> {
  // GoTrue stores phones without the leading "+" — match both forms.
  const bare = phone.replace(/^\+/, "");
  return reconcileClaims(db, {
    // Same lock key as the OTP throttle (`recordOtpSend`), so the two guards
    // on one destination serialize instead of deadlocking.
    lockKey: hashDestination(phone, "phone"),
    where: sql`(phone in (${phone}, ${bare}) or phone_change in (${phone}, ${bare}))`,
    options,
  });
}

/** Reconciles claims on an email address. */
export async function reconcileEmailClaims(
  db: Database,
  email: string,
  options: ReconcileClaimsOptions,
): Promise<ReconcileClaimsResult> {
  const normalized = email.toLowerCase();
  return reconcileClaims(db, {
    // Same lock key as the OTP throttle (`recordOtpSend`) — see above.
    lockKey: hashDestination(email, "email"),
    where: sql`(lower(email) = ${normalized} or lower(email_change) = ${normalized})`,
    options,
  });
}

interface AuthUserClaim {
  id: string;
  is_anonymous: boolean;
}

async function reconcileClaims(
  db: Database,
  input: { lockKey: string; where: SQL; options: ReconcileClaimsOptions },
): Promise<ReconcileClaimsResult> {
  const { lockKey, where, options } = input;
  const log = options.log ?? ((m: string) => console.log(`[reconcile-claims] ${m}`));

  return db.transaction(async (tx) => {
    // Serialize concurrent claims on the same identifier: without this, two
    // requests could each see the other's row as "anonymous colliding" and
    // interleave deletes with sends.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);

    const rows = (await tx.execute(
      sql`select id::text as id, is_anonymous
          from auth.users
          where id <> ${options.currentUserId}::uuid and ${where}`,
    )) as unknown as AuthUserClaim[];

    const claims = Array.from(rows);
    const permanent = claims.filter((row) => !row.is_anonymous);
    if (permanent.length > 0) {
      // Existing account: hands off. The caller routes into sign-in.
      return { conflict: true, removedAnonymousUserIds: [] };
    }

    const removed: string[] = [];
    for (const claim of claims) {
      await tx.delete(bookingDrafts).where(eq(bookingDrafts.userId, claim.id));
      await tx
        .delete(users)
        .where(and(eq(users.id, claim.id), eq(users.isAnonymous, true)));

      // Inside the transaction on purpose: an admin-API failure must roll the
      // row deletes back. The inverse race (auth user deleted, commit fails)
      // leaves an orphaned public row the nightly GC collects.
      if (options.deleteAuthUser) await options.deleteAuthUser(claim.id);

      removed.push(claim.id);
      log(`removed abandoned anonymous claim ${claim.id}`);
    }

    return { conflict: false, removedAnonymousUserIds: removed };
  });
}
