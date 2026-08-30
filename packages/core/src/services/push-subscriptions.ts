import { and, eq, inArray } from "drizzle-orm";
import {
  pushSubscriptions,
  staffMembers,
  type Database,
  type PushApp,
} from "@koolee/db";

import type { CoreConfig } from "../config";
import type { PushPayload, PushTarget, PushUrgency } from "../notifications/push";

/**
 * Push subscriptions: storage, authorization, and the fan-out.
 *
 * AUTHORIZATION IS ONE SENTENCE: a user manages only their own
 * subscriptions. Every function here takes the user id the SERVER derived
 * from the session — never a value off a request body — and scopes its
 * writes with it. There is no admin path for editing somebody else's
 * devices, because there is no reason for one.
 *
 * PUSH IS NEVER LOAD-BEARING. `pushToUsers` swallows everything: a dead
 * provider, a network failure, a sender that throws. The caller is an Inngest
 * step whose EMAIL is the real notification, and a failed push must not fail
 * it, retry it, or duplicate it. See notifications/push.ts.
 */

export interface SavePushSubscriptionInput {
  /** Derived from the session by the caller. Never from the request body. */
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  app: PushApp;
  label?: string | undefined;
}

/**
 * Registers (or re-registers) a device.
 *
 * Upsert on `endpoint`, NOT on (user, endpoint): an endpoint identifies one
 * browser install globally, so a device that changes hands must MOVE to the
 * new user rather than gain a second row — otherwise the previous person
 * keeps getting notifications about somebody else's bags. The conflict
 * update therefore overwrites `user_id` deliberately.
 *
 * Also the re-registration path used by the service worker's
 * `pushsubscriptionchange`: same call, same semantics, so a browser rotating
 * a subscription heals itself instead of leaving a row that will 410 forever.
 */
export async function savePushSubscription(
  config: CoreConfig,
  input: SavePushSubscriptionInput,
): Promise<{ id: string }> {
  const [row] = await config.db
    .insert(pushSubscriptions)
    .values({
      userId: input.userId,
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      auth: input.auth,
      app: input.app,
      label: input.label ?? null,
      lastSeenAt: config.clock.now(),
    })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: {
        userId: input.userId,
        p256dh: input.p256dh,
        auth: input.auth,
        app: input.app,
        label: input.label ?? null,
        lastSeenAt: config.clock.now(),
      },
    })
    .returning({ id: pushSubscriptions.id });

  return { id: row!.id };
}

/**
 * Removes one of the caller's own devices.
 *
 * Scoped by `user_id` as well as `endpoint`: without it, knowing somebody
 * else's endpoint (a value that travels through logs and proxies) would be
 * enough to silence their notifications. Returns false when nothing matched,
 * which is also what an attempt on another user's row looks like — the two
 * are deliberately indistinguishable to the caller.
 */
export async function deletePushSubscription(
  config: CoreConfig,
  input: { userId: string; endpoint: string },
): Promise<boolean> {
  const deleted = await config.db
    .delete(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.userId, input.userId),
        eq(pushSubscriptions.endpoint, input.endpoint),
      ),
    )
    .returning({ id: pushSubscriptions.id });

  return deleted.length > 0;
}

/**
 * Records that a HUMAN confirmed they saw a test notification.
 *
 * The only trustworthy signal this channel works. Everything else — granted
 * permission, a 201 from the push service, a resolved `showNotification` —
 * is compatible with an empty screen.
 */
export async function markPushSubscriptionVerified(
  config: CoreConfig,
  input: { userId: string; endpoint: string },
): Promise<boolean> {
  const updated = await config.db
    .update(pushSubscriptions)
    .set({ verifiedAt: config.clock.now(), lastSeenAt: config.clock.now() })
    .where(
      and(
        eq(pushSubscriptions.userId, input.userId),
        eq(pushSubscriptions.endpoint, input.endpoint),
      ),
    )
    .returning({ id: pushSubscriptions.id });

  return updated.length > 0;
}

/** The caller's own devices, for a settings screen. */
export async function listPushSubscriptionsForUser(
  db: Database,
  userId: string,
): Promise<
  {
    id: string;
    endpoint: string;
    label: string | null;
    app: string;
    createdAt: Date;
    verifiedAt: Date | null;
  }[]
> {
  return db
    .select({
      id: pushSubscriptions.id,
      endpoint: pushSubscriptions.endpoint,
      label: pushSubscriptions.label,
      app: pushSubscriptions.app,
      createdAt: pushSubscriptions.createdAt,
      verifiedAt: pushSubscriptions.verifiedAt,
    })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId));
}

/** Every device belonging to any of these people. */
export async function listPushTargets(
  db: Database,
  userIds: string[],
): Promise<PushTarget[]> {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (ids.length === 0) return [];

  return db
    .select({
      id: pushSubscriptions.id,
      endpoint: pushSubscriptions.endpoint,
      p256dh: pushSubscriptions.p256dh,
      auth: pushSubscriptions.auth,
    })
    .from(pushSubscriptions)
    .where(inArray(pushSubscriptions.userId, ids));
}

/**
 * "Ops" as an audience: every ACTIVE admin who has a subscription.
 *
 * Derived from `staff_members`, deliberately — no notification-role column,
 * no ops-recipients table. A counter or a roster on a write path is a thing
 * that has to be kept in step with what it counts (§7); admin-ness already
 * lives in one place and this reads it.
 */
export async function listAdminPushTargets(db: Database): Promise<PushTarget[]> {
  return db
    .select({
      id: pushSubscriptions.id,
      endpoint: pushSubscriptions.endpoint,
      p256dh: pushSubscriptions.p256dh,
      auth: pushSubscriptions.auth,
    })
    .from(pushSubscriptions)
    .innerJoin(staffMembers, eq(staffMembers.userId, pushSubscriptions.userId))
    .where(and(eq(staffMembers.role, "admin"), eq(staffMembers.active, true)));
}

/** Deletes subscriptions the push service reported as gone (404/410). */
export async function prunePushSubscriptions(
  db: Database,
  subscriptionIds: string[],
): Promise<number> {
  if (subscriptionIds.length === 0) return 0;
  const deleted = await db
    .delete(pushSubscriptions)
    .where(inArray(pushSubscriptions.id, subscriptionIds))
    .returning({ id: pushSubscriptions.id });
  return deleted.length;
}

export interface PushFanOutResult {
  targeted: number;
  sent: number;
  failed: number;
  pruned: number;
}

/**
 * Send one payload to every device of every named person, then prune the dead.
 *
 * NEVER THROWS. Not "rarely" — never. Every call site is inside an Inngest
 * function that has already sent, or is about to send, the email that is the
 * actual notification; a push failure there must leave that email and that
 * function untouched. A caller that wants to know what happened reads the
 * result.
 */
export async function pushToUsers(
  config: CoreConfig,
  userIds: string[],
  payload: PushPayload,
  options: { urgency?: PushUrgency } = {},
): Promise<PushFanOutResult> {
  try {
    const targets = await listPushTargets(config.db, userIds);
    return await pushToTargets(config, targets, payload, options);
  } catch (error) {
    console.error(`[push] fan-out failed for tag ${payload.tag}`, error);
    return { targeted: 0, sent: 0, failed: 0, pruned: 0 };
  }
}

/** Same contract as `pushToUsers`, for an audience resolved another way. */
export async function pushToTargets(
  config: CoreConfig,
  targets: PushTarget[],
  payload: PushPayload,
  options: { urgency?: PushUrgency } = {},
): Promise<PushFanOutResult> {
  if (targets.length === 0) return { targeted: 0, sent: 0, failed: 0, pruned: 0 };

  try {
    const result = await config.pushSender.send(targets, payload, options);
    const pruned = await prunePushSubscriptions(config.db, result.expired);
    return {
      targeted: targets.length,
      sent: result.sent,
      failed: result.failed,
      pruned,
    };
  } catch (error) {
    console.error(`[push] send failed for tag ${payload.tag}`, error);
    return { targeted: targets.length, sent: 0, failed: targets.length, pruned: 0 };
  }
}
