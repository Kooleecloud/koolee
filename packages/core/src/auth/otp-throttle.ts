import { and, eq, gte, lt, sql } from "drizzle-orm";
import { otpSendLog, type Database } from "@koolee/db";

import { hashDestination } from "./hash-destination";

/**
 * Server-side OTP send throttle, backed by `otp_send_log`.
 *
 * Compensating control for the one auth call that cannot carry a Turnstile
 * token: `updateUser({ phone | email })`, the anonymous → permanent upgrade.
 * The chain is sound because an attacker cannot reach that call without first
 * solving a challenge to obtain the anonymous session — and each session is
 * then capped here.
 *
 * The destination cap counts across ALL users on purpose: it is what blocks
 * farming a single number through a stream of fresh anonymous sessions.
 *
 * Only the HMAC of the destination is ever stored or queried
 * (`destination_hash`); the plaintext never reaches the table or the logs.
 */

/** Max sends per user per rolling window. */
export const OTP_MAX_SENDS_PER_USER = 3;
export const OTP_USER_WINDOW_MINUTES = 15;

/** Max sends per destination per rolling window, across all users. */
export const OTP_MAX_SENDS_PER_DESTINATION = 5;
export const OTP_DESTINATION_WINDOW_MINUTES = 60;

/** The transaction handle drizzle passes to a `db.transaction` callback. */
export type GuardTx = Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface RecordOtpSendInput {
  /** Supabase auth uid of the session requesting the send. */
  userId: string;
  /** E.164 phone or email. Hashed internally; the plaintext is never stored. */
  destination: string;
  /** Selects the hash namespace — a phone and an email never share a bucket. */
  kind: "phone" | "email";
  /** Injectable for tests. */
  now?: Date;
}

export interface OtpSendAllowance {
  allowed: boolean;
  reason?: "user_capped" | "destination_capped";
}

/**
 * Takes BOTH advisory locks a guarded send serializes on, in fixed order —
 * user first, then destination. The order is load-bearing: two requests that
 * lock the same (user, destination) pair in opposite orders can deadlock.
 *
 * The user lock is what makes the per-user cap hard under concurrency: with
 * only the destination lock, one session bursting sends to DIFFERENT numbers
 * never contends on any lock, and every burst member can pass the count check
 * before the first row is visible.
 *
 * `reconcile-claims.ts` locks only on the destination hash — it reads by
 * identifier, never by user — so it stays deadlock-free against this pair.
 */
export async function acquireOtpSendLocks(
  tx: GuardTx,
  userId: string,
  destinationHash: string,
): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${userId}, 0))`);
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${destinationHash}, 0))`,
  );
}

/**
 * The window checks + insert, assuming `acquireOtpSendLocks` already ran in
 * this transaction. Split out so `guardUpgradeOtpSend` can run the throttle
 * and claim reconciliation under ONE lock scope (see `upgrade-guard.ts`).
 */
export async function checkAndRecordOtpSend(
  tx: GuardTx,
  input: { userId: string; destinationHash: string; now: Date },
): Promise<OtpSendAllowance> {
  const userWindowStart = new Date(
    input.now.getTime() - OTP_USER_WINDOW_MINUTES * 60_000,
  );
  const destWindowStart = new Date(
    input.now.getTime() - OTP_DESTINATION_WINDOW_MINUTES * 60_000,
  );

  const [byUser] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(otpSendLog)
    .where(
      and(
        eq(otpSendLog.userId, input.userId),
        gte(otpSendLog.createdAt, userWindowStart),
      ),
    );
  if ((byUser?.count ?? 0) >= OTP_MAX_SENDS_PER_USER) {
    return { allowed: false, reason: "user_capped" as const };
  }

  const [byDest] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(otpSendLog)
    .where(
      and(
        eq(otpSendLog.destinationHash, input.destinationHash),
        gte(otpSendLog.createdAt, destWindowStart),
      ),
    );
  if ((byDest?.count ?? 0) >= OTP_MAX_SENDS_PER_DESTINATION) {
    return { allowed: false, reason: "destination_capped" as const };
  }

  await tx.insert(otpSendLog).values({
    userId: input.userId,
    destinationHash: input.destinationHash,
    createdAt: input.now,
  });
  return { allowed: true };
}

/**
 * Checks both rolling windows and, when allowed, records the send. Call this
 * BEFORE the Supabase call that triggers the SMS/email; skip the send when
 * `allowed` is false.
 *
 * Locks, counts, and insert run in ONE transaction, locks FIRST: without
 * them, a burst of concurrent requests could each pass the count checks
 * before any row is visible, making the limits soft under exactly the
 * conditions they exist to stop.
 *
 * For the upgrade path, prefer `guardUpgradeOtpSend` — it runs this AND claim
 * reconciliation without releasing the locks in between.
 */
export async function recordOtpSend(
  db: Database,
  input: RecordOtpSendInput,
): Promise<OtpSendAllowance> {
  const now = input.now ?? new Date();
  const destinationHash = hashDestination(input.destination, input.kind);

  return db.transaction(async (tx) => {
    await acquireOtpSendLocks(tx, input.userId, destinationHash);
    return checkAndRecordOtpSend(tx, { userId: input.userId, destinationHash, now });
  });
}

/**
 * Deletes log rows past the retention horizon. Both throttle windows fit well
 * inside 24h, so anything older carries no signal. Runs from the daily
 * cleanup job.
 */
export async function pruneOtpSendLog(
  db: Database,
  options: { olderThanHours?: number; now?: Date } = {},
): Promise<number> {
  const now = options.now ?? new Date();
  const hours = options.olderThanHours ?? 24;
  const cutoff = new Date(now.getTime() - hours * 3600_000);

  const deleted = await db
    .delete(otpSendLog)
    .where(lt(otpSendLog.createdAt, cutoff))
    .returning({ id: otpSendLog.id });
  return deleted.length;
}
