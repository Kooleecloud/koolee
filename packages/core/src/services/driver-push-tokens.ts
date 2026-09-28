import { and, eq, inArray, isNull } from "drizzle-orm";
import { driverPushTokens, type Database, type PushPlatform } from "@koolee/db";

import type { CoreConfig } from "../config";
import { InvalidInputError } from "../errors";

/**
 * Expo push tokens for the native driver app: storage and authorization.
 *
 * SAME TWO RULES AS `push-subscriptions.ts`, because it is the same problem
 * with a different target shape:
 *
 *  - a person manages only their own devices. Every write takes the user id
 *    the SERVER derived from the bearer session — never a value off a
 *    request body — and scopes itself with it;
 *  - the token is unique on its own, not per (user, token), so a phone that
 *    changes hands MOVES to whoever signed in on it. Two rows would mean the
 *    previous driver keeps being told about somebody else's pickups.
 *
 * The one difference: a dead token is DISABLED, not deleted. Expo reports
 * `DeviceNotRegistered` for an uninstalled app, and the same install coming
 * back re-registers the very same token — clearing the flag is cleaner than
 * a delete-then-insert that loses `created_at`.
 */

/**
 * The shape Expo's own `Expo.isExpoPushToken` accepts: the two bracketed
 * forms the app receives today, plus the bare-UUID form older SDKs issued.
 *
 * Mirrored here rather than imported because `expo-server-sdk` pulls
 * `undici` in at module scope and this file is reachable from the package
 * barrel, which client bundles import. The wire contract in
 * `@koolee/api-contract` narrows it further to the bracketed forms; this is
 * the last line, for callers that bypass the route.
 */
const EXPO_PUSH_TOKEN_BRACKETED = /^(?:ExponentPushToken|ExpoPushToken)\[.+\]$/;
const EXPO_PUSH_TOKEN_UUID = /^[a-z\d]{8}-[a-z\d]{4}-[a-z\d]{4}-[a-z\d]{4}-[a-z\d]{12}$/i;

export function isExpoPushToken(token: unknown): token is string {
  if (typeof token !== "string") return false;
  return EXPO_PUSH_TOKEN_BRACKETED.test(token) || EXPO_PUSH_TOKEN_UUID.test(token);
}

export interface RegisterDriverPushTokenInput {
  /** Derived from the session by the caller. Never from the request body. */
  userId: string;
  token: string;
  platform: PushPlatform;
  deviceLabel?: string | undefined;
}

/**
 * Registers (or re-registers) a device. Upsert on `token` alone — see the
 * header for why the conflict update overwrites `user_id` on purpose — and
 * a re-register always re-enables: the app only asks for a token when it
 * is installed and allowed to notify, which is exactly the state a disabled
 * row says it is not in.
 */
export async function registerDriverPushToken(
  config: CoreConfig,
  input: RegisterDriverPushTokenInput,
): Promise<{ id: string }> {
  if (!isExpoPushToken(input.token)) {
    throw new InvalidInputError("token", "That is not an Expo push token.");
  }

  const now = config.clock.now();
  const [row] = await config.db
    .insert(driverPushTokens)
    .values({
      userId: input.userId,
      token: input.token,
      platform: input.platform,
      deviceLabel: input.deviceLabel ?? null,
      lastSeenAt: now,
      disabledAt: null,
    })
    .onConflictDoUpdate({
      target: driverPushTokens.token,
      set: {
        userId: input.userId,
        platform: input.platform,
        deviceLabel: input.deviceLabel ?? null,
        lastSeenAt: now,
        disabledAt: null,
      },
    })
    .returning({ id: driverPushTokens.id });

  return { id: row!.id };
}

/**
 * Removes one of the caller's own devices — the sign-out path.
 *
 * Scoped by `user_id` as well as `token`: a token travels through logs and
 * crash reports, and knowing one must not be enough to silence somebody
 * else's phone. False when nothing matched, which is also what an attempt
 * on another user's row looks like; the two are deliberately
 * indistinguishable to the caller.
 */
export async function unregisterDriverPushToken(
  config: CoreConfig,
  input: { userId: string; token: string },
): Promise<boolean> {
  const deleted = await config.db
    .delete(driverPushTokens)
    .where(
      and(
        eq(driverPushTokens.userId, input.userId),
        eq(driverPushTokens.token, input.token),
      ),
    )
    .returning({ id: driverPushTokens.id });

  return deleted.length > 0;
}

export interface DriverPushTarget {
  id: string;
  userId: string;
  token: string;
  platform: string;
}

/** Every ACTIVE device (not disabled) belonging to any of these people. */
export async function listDriverPushTokens(
  db: Database,
  userIds: readonly string[],
): Promise<DriverPushTarget[]> {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (ids.length === 0) return [];

  return db
    .select({
      id: driverPushTokens.id,
      userId: driverPushTokens.userId,
      token: driverPushTokens.token,
      platform: driverPushTokens.platform,
    })
    .from(driverPushTokens)
    .where(
      and(inArray(driverPushTokens.userId, ids), isNull(driverPushTokens.disabledAt)),
    );
}

/**
 * Marks tokens Expo reported as `DeviceNotRegistered`. The row stays — see
 * the header — so a re-register from the same install revives it. Returns
 * how many were newly disabled.
 */
export async function disableDriverPushTokens(
  db: Database,
  tokens: readonly string[],
  now: Date = new Date(),
): Promise<number> {
  if (tokens.length === 0) return 0;
  const updated = await db
    .update(driverPushTokens)
    .set({ disabledAt: now })
    .where(
      and(
        inArray(driverPushTokens.token, [...tokens]),
        isNull(driverPushTokens.disabledAt),
      ),
    )
    .returning({ id: driverPushTokens.id });
  return updated.length;
}
