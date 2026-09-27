import { z } from "zod";

import { uuid } from "./common";

/**
 * `POST` / `DELETE /api/v1/push/register` — the native app's Expo push token.
 *
 * One opaque string per install, minted by `expo-notifications` on the
 * device; the server never sees an APNs or FCM token. Registering it again
 * is how the app keeps it fresh (on every launch, and on sign-in), and the
 * server moves the token to whoever is signed in now, so a phone that
 * changes hands stops receiving the previous driver's jobs. Unregister on
 * sign-out.
 */

/**
 * The two forms current SDKs issue. Core also accepts Expo's legacy bare-UUID
 * form for callers that bypass this route; the app never produces one.
 */
export const EXPO_PUSH_TOKEN_PATTERN = /^(?:ExponentPushToken|ExpoPushToken)\[.+\]$/;

export const expoPushTokenSchema = z
  .string()
  .regex(EXPO_PUSH_TOKEN_PATTERN, "That is not an Expo push token.");

export const PUSH_PLATFORMS = ["ios", "android"] as const;
export const pushPlatformSchema = z.enum(PUSH_PLATFORMS);
export type PushPlatform = z.infer<typeof pushPlatformSchema>;

export const pushRegisterRequestSchema = z.object({
  token: expoPushTokenSchema,
  platform: pushPlatformSchema,
  /** e.g. "iPhone 17 Pro". Shown back to the person; never parsed. */
  deviceLabel: z.string().trim().min(1).max(120).optional(),
});
export type PushRegisterRequest = z.infer<typeof pushRegisterRequestSchema>;

export const pushRegisterResponseSchema = z.object({
  ok: z.literal(true),
  /** The `driver_push_tokens` row — stable across re-registers of the same token. */
  id: uuid,
});
export type PushRegisterResponse = z.infer<typeof pushRegisterResponseSchema>;

export const pushUnregisterRequestSchema = z.object({
  token: expoPushTokenSchema,
});
export type PushUnregisterRequest = z.infer<typeof pushUnregisterRequestSchema>;

/** `ok: false` means nothing matched — which is also what somebody else's token looks like. */
export const pushUnregisterResponseSchema = z.object({
  ok: z.boolean(),
});
export type PushUnregisterResponse = z.infer<typeof pushUnregisterResponseSchema>;

/**
 * `POST /api/v1/push/test` — a REAL push to the caller's own devices, through
 * the relay, for the "did you see it?" check on the Account tab. The same
 * check the web agent app runs over web push, and for the same reason: an OS
 * switch, Focus or an alert style of "None" all report success with the
 * screen empty, so the product asks a human.
 *
 * Refusals: 503 `not_configured` (push is off on this environment — nothing
 * was sent), 409 `no_subscription` (this person has no active device).
 */
export const PUSH_TEST_FAILURES = [
  /** Koolee's side: push credentials missing or wrong for this app (APNs/FCM). */
  "setup",
  /** The phone's token is dead — the app was reinstalled or push was revoked. */
  "device",
  /** The relay or the network failed this time. Worth another try. */
  "relay",
] as const;
export const pushTestFailureSchema = z.enum(PUSH_TEST_FAILURES);
export type PushTestFailure = z.infer<typeof pushTestFailureSchema>;

export const pushTestResponseSchema = z.object({
  /** The relay TOOK it. Never "delivered" — no such receipt exists. */
  accepted: z.boolean(),
  /**
   * Why not, when not. Only what the relay said: "setup" and "device" are
   * the relay's own error codes, never a guess about the phone, so the app
   * tells a driver to check Settings only when nothing else explains it.
   */
  failure: pushTestFailureSchema.optional(),
});
export type PushTestResponse = z.infer<typeof pushTestResponseSchema>;
