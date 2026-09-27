import {
  disableDriverPushTokens,
  listDriverPushTokens,
  registerDriverPushToken,
  unregisterDriverPushToken,
} from "@koolee/core";
import type {
  PushRegisterRequest,
  PushRegisterResponse,
  PushTestFailure,
  PushTestResponse,
  PushUnregisterRequest,
  PushUnregisterResponse,
} from "@koolee/api-contract";

import type { ApiContext } from "../context";
import { ApiHttpError } from "../errors";

/**
 * Push-token handlers for the native app. The user id comes from the bearer
 * session on the context — never from the body — which is the whole
 * authorization story: a person registers and removes only their own
 * devices. Core owns the upsert semantics (a token moves to whoever signed
 * in with it) and the token-shape check behind the contract's.
 */

export async function registerPushToken(
  ctx: ApiContext,
  body: PushRegisterRequest,
): Promise<PushRegisterResponse> {
  const { id } = await registerDriverPushToken(ctx.core, {
    userId: ctx.session.userId,
    token: body.token,
    platform: body.platform,
    deviceLabel: body.deviceLabel,
  });
  return { ok: true, id };
}

export async function unregisterPushToken(
  ctx: ApiContext,
  body: PushUnregisterRequest,
): Promise<PushUnregisterResponse> {
  const ok = await unregisterDriverPushToken(ctx.core, {
    userId: ctx.session.userId,
    token: body.token,
  });
  return { ok };
}

/**
 * A REAL push to the caller's own phones, through the Expo relay — the server
 * half of the Account tab's "did you see it?" check, the twin of the web
 * app's `/api/push/test`. Pushes only to the session user's devices, so the
 * worst anyone can do with it is notify themselves.
 *
 * REFUSE RATHER THAN PRETEND: with push switched off the runtime holds
 * `ConsoleExpoPushSender`, which logs and reports success. A person is about
 * to be asked whether a notification appeared, so a log line must not count
 * as a send — `delivers` is the only honest check.
 */
export async function sendTestPush(ctx: ApiContext): Promise<PushTestResponse> {
  const { core } = ctx;
  if (!core.expoPushSender.delivers) {
    throw new ApiHttpError(
      "not_configured",
      "Nothing was sent — notifications aren't set up on this environment yet, so there is nothing wrong with your phone.",
    );
  }

  const tokens = (await listDriverPushTokens(core.db, [ctx.session.userId])).map(
    (row) => row.token,
  );
  if (tokens.length === 0) {
    throw new ApiHttpError(
      "no_subscription",
      "This phone isn't registered for notifications any more. Turn them off and on again.",
    );
  }

  const result = await core.expoPushSender.send(
    tokens,
    {
      title: "Notifications are working",
      body: "This is the test we asked you about. Nothing to do.",
      // Unique per attempt: a stable tag lets a second test replace the
      // first silently, which is the failure this check exists to catch.
      tag: `push-test:${ctx.now.getTime()}`,
    },
    { urgency: "high" },
  );
  await disableDriverPushTokens(core.db, result.invalid, ctx.now);
  // `accepted`, never `delivered`: a ticket from the relay is not a receipt.
  if (result.sent > 0) return { accepted: true };
  return { accepted: false, failure: testFailureOf(result.errorCodes ?? []) };
}

/**
 * The relay's codes, sorted into what the person holding the phone can act
 * on. Credentials outrank everything: with no APNs key or FCM setup every
 * device fails, and "check your phone" would send a driver to Settings over
 * a step that belongs to whoever builds the app.
 */
function testFailureOf(codes: readonly string[]): PushTestFailure {
  if (codes.includes("InvalidCredentials") || codes.includes("DeveloperError")) {
    return "setup";
  }
  if (codes.includes("DeviceNotRegistered")) return "device";
  return "relay";
}
