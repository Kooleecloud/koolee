import { and, eq, exists, lt, not } from "drizzle-orm";
import { bookingDrafts, bookings, users, type Database } from "@koolee/db";

import { pruneOtpSendLog } from "../auth/otp-throttle";

/**
 * Abandoned-draft + anonymous-user GC.
 *
 * Deletes `public.users` rows that are (a) anonymous, (b) idle past the
 * horizon, and (c) own NO `bookings` row of any status — then deletes the
 * matching Supabase auth user via the injected admin callback.
 *
 * Why "no bookings at all" rather than the softer "no non-draft booking": an
 * anonymous user cannot reach the payment step, so a real `bookings` row under
 * one is already an invariant violation — and deleting it is impossible anyway
 * (custody_events is append-only and cascade-deletes would trip the trigger;
 * bookings.user_id is ON DELETE RESTRICT). Such users are skipped and counted
 * so ops can investigate. Their funnel draft lives in `booking_drafts`, which
 * cascade-deletes with the user row.
 */

export interface CleanupAnonymousUsersOptions {
  /** Idle horizon in days. Default 7. */
  olderThanDays?: number;
  /** Injectable for tests. */
  now?: Date;
  /**
   * Deletes the Supabase auth user (`supabase.auth.admin.deleteUser`). Runs
   * AFTER the row delete commits; a failure is logged, not fatal — the auth
   * row is orphaned but harmless and the next run retries nothing (the
   * public row is gone), so failures are surfaced via the result counts.
   */
  deleteAuthUser?: (userId: string) => Promise<void>;
  log?: (message: string) => void;
}

export interface CleanupAnonymousUsersResult {
  scanned: number;
  deletedUsers: number;
  deletedDrafts: number;
  skippedWithBookings: number;
  authDeleteFailures: number;
  /** OTP-throttle log rows past the 24h retention horizon, deleted. */
  prunedOtpSends: number;
}

export async function cleanupAnonymousUsers(
  db: Database,
  options: CleanupAnonymousUsersOptions = {},
): Promise<CleanupAnonymousUsersResult> {
  const now = options.now ?? new Date();
  const days = options.olderThanDays ?? 7;
  const log = options.log ?? ((m: string) => console.log(`[cleanup-anon] ${m}`));
  const cutoff = new Date(now.getTime() - days * 24 * 3600_000);

  const hasAnyBooking = exists(
    db.select({ one: bookings.id }).from(bookings).where(eq(bookings.userId, users.id)),
  );

  const stale = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.isAnonymous, true), lt(users.lastSeenAt, cutoff)));

  // Defensive second pass: never touch a user with ANY booking, even though
  // the funnel makes that impossible for anonymous users.
  const deletable = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(eq(users.isAnonymous, true), lt(users.lastSeenAt, cutoff), not(hasAnyBooking)),
    );

  const skippedWithBookings = stale.length - deletable.length;
  if (skippedWithBookings > 0) {
    log(
      `WARNING: ${skippedWithBookings} stale anonymous user(s) own bookings — skipped. This should be impossible; investigate.`,
    );
  }

  let deletedUsers = 0;
  let deletedDrafts = 0;
  let authDeleteFailures = 0;

  for (const { id } of deletable) {
    try {
      await db.transaction(async (tx) => {
        const drafts = await tx
          .delete(bookingDrafts)
          .where(eq(bookingDrafts.userId, id))
          .returning({ id: bookingDrafts.id });
        deletedDrafts += drafts.length;

        // Re-checked inside the transaction so a booking created between the
        // scan and the delete aborts this user (FK RESTRICT backs this up).
        const rows = await tx
          .delete(users)
          .where(and(eq(users.id, id), eq(users.isAnonymous, true)))
          .returning({ id: users.id });
        if (rows.length === 0) throw new Error("user changed underneath the cleanup");
      });
      deletedUsers += 1;

      if (options.deleteAuthUser) {
        try {
          await options.deleteAuthUser(id);
        } catch (error) {
          authDeleteFailures += 1;
          log(
            `auth delete failed for ${id}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    } catch (error) {
      log(`skipping ${id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  let prunedOtpSends = 0;
  try {
    prunedOtpSends = await pruneOtpSendLog(db, { now });
  } catch (error) {
    log(
      `otp_send_log prune failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const result: CleanupAnonymousUsersResult = {
    scanned: stale.length,
    deletedUsers,
    deletedDrafts,
    skippedWithBookings,
    authDeleteFailures,
    prunedOtpSends,
  };
  log(
    `scanned=${result.scanned} deletedUsers=${result.deletedUsers} deletedDrafts=${result.deletedDrafts} skippedWithBookings=${result.skippedWithBookings} authDeleteFailures=${result.authDeleteFailures} prunedOtpSends=${result.prunedOtpSends}`,
  );
  return result;
}
