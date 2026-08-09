import type { Database } from "@koolee/db";

import { hashDestination } from "./hash-destination";
import {
  acquireOtpSendLocks,
  checkAndRecordOtpSend,
  type OtpSendAllowance,
} from "./otp-throttle";
import {
  emailClaimSpec,
  phoneClaimSpec,
  reconcileClaimsHoldingLock,
  type ReconcileClaimsOptions,
  type ReconcileClaimsResult,
} from "./reconcile-claims";

/**
 * The two pre-send controls for an anonymous → permanent upgrade — the OTP
 * throttle and claim reconciliation — as ONE transaction under one lock
 * scope (user lock, then destination lock, held for the duration of both).
 *
 * Running them as two transactions releases the destination lock between the
 * throttle's commit and reconcile's re-acquisition; two sessions claiming the
 * same destination can interleave into that gap, and either side's claim can
 * be the one reconciled away. Merged, a session's throttle + reconcile are
 * atomic with respect to every other guarded send for the same destination.
 *
 * What this deliberately does NOT serialize: the Supabase send itself
 * (`updateUser`) happens after this returns, outside the lock. A claimant
 * that passed its guard but has not yet verified can still be reconciled
 * away by a LATER guarded send for the same destination — that is the
 * designed last-claimant-wins behavior (acceptance test 15), not a race.
 *
 * Transaction semantics worth knowing:
 *  - a `conflict` result COMMITS the throttle row — probing a registered
 *    number still counts against the caps (acceptance test 16);
 *  - a thrown reconcile (e.g. the admin-API delete fails) rolls the whole
 *    transaction back, throttle row included: the send never happened, so it
 *    is not counted.
 */

export interface UpgradeSendGuardInput {
  /** Supabase auth uid of the session performing the upgrade. */
  userId: string;
  /** E.164 phone or normalized email. Hashed internally; never stored. */
  destination: string;
  kind: "phone" | "email";
  /**
   * False skips reconciliation — for environments whose database has no
   * GoTrue `auth` schema (bare local Postgres). Callers should derive this
   * from an explicit flag, not from sniffing error codes.
   */
  reconcile?: boolean;
  deleteAuthUser?: ReconcileClaimsOptions["deleteAuthUser"];
  log?: ReconcileClaimsOptions["log"];
  /** Injectable for tests. */
  now?: Date;
}

export interface UpgradeSendGuardResult extends OtpSendAllowance, ReconcileClaimsResult {}

export async function guardUpgradeOtpSend(
  db: Database,
  input: UpgradeSendGuardInput,
): Promise<UpgradeSendGuardResult> {
  const now = input.now ?? new Date();
  const spec =
    input.kind === "phone"
      ? phoneClaimSpec(input.destination)
      : emailClaimSpec(input.destination);
  // `spec.lockKey` IS the destination hash — the throttle and reconcile
  // deliberately share the key, so the one destination lock covers both.
  const destinationHash = hashDestination(input.destination, input.kind);

  return db.transaction(async (tx) => {
    await acquireOtpSendLocks(tx, input.userId, destinationHash);

    const allowance = await checkAndRecordOtpSend(tx, {
      userId: input.userId,
      destinationHash,
      now,
    });
    if (!allowance.allowed) {
      return { ...allowance, conflict: false, removedAnonymousUserIds: [] };
    }

    if (input.reconcile === false) {
      return { allowed: true, conflict: false, removedAnonymousUserIds: [] };
    }

    const reconciled = await reconcileClaimsHoldingLock(tx, spec.where, {
      currentUserId: input.userId,
      deleteAuthUser: input.deleteAuthUser,
      log: input.log,
    });
    return { allowed: true, ...reconciled };
  });
}
