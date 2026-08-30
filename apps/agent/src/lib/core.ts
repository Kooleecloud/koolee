import "server-only";

import * as Sentry from "@sentry/nextjs";
import {
  createRuntime,
  SentryOpsAlerter,
  tryCreateRuntime,
  type CoreConfig,
  type OpsAlerter,
  type PushSender,
} from "@koolee/core";
import { createWebPushSender } from "@koolee/core/web-push";

import { env, optionalEnv, pushNotificationsEnabled } from "@/env";
import { inngestEmitter } from "@/lib/event-emitter";

/**
 * The real web-push sender when all three VAPID values are present, otherwise
 * nothing — `createRuntime` then falls back to `ConsolePushSender`.
 *
 * EVERY APP THAT SENDS NEEDS ONE, and that is the whole lesson here. This app
 * sends exactly one thing — a test push to yourself, from `/api/push/test` —
 * and it had no real sender, so it fell back to `ConsolePushSender`, which
 * logs a line and **reports success**. The "did you see it?" check, whose
 * entire purpose is catching silent non-delivery, was asking about
 * notifications that had never been sent.
 */
function resolvePushSender(): { pushSender?: PushSender } {
  const sender = createWebPushSender({
    // Checked first, and it wins: with the switch off a fully configured
    // environment still sends nothing.
    enabled: pushNotificationsEnabled(),
    publicKey: optionalEnv("VAPID_PUBLIC_KEY"),
    privateKey: optionalEnv("VAPID_PRIVATE_KEY"),
    subject: optionalEnv("VAPID_SUBJECT"),
  });
  return sender === null ? {} : { pushSender: sender };
}

/**
 * Ops alerts go to Sentry when there is a DSN, and to the console either way.
 *
 * `SentryOpsAlerter` (core) holds the mapping and — the part that matters —
 * swallows its own failures: twelve of the seventeen `opsAlerter.alert` call
 * sites are unwrapped Inngest steps, so an alerter that throws would turn "we
 * could not tell ops about a failed email" into a failing, retrying job.
 *
 * `captureEvent` is passed as a plain function rather than the SDK, because
 * `packages/core` may not depend on `@sentry/nextjs`.
 */
function resolveOpsAlerter(): { opsAlerter?: OpsAlerter } {
  if (!optionalEnv("NEXT_PUBLIC_SENTRY_DSN")) return {};
  return {
    opsAlerter: new SentryOpsAlerter({
      capture: (event) => Sentry.captureEvent(event),
    }),
  };
}

/**
 * Builds the injected `CoreConfig` from this app's validated environment.
 * `packages/core` reads no environment variables.
 *
 * The agent app never takes a payment — captures are triggered through core by
 * the pickup flow, not by an agent holding a card reader — so it always wires
 * the fake provider. STRIPE_SECRET_KEY is deliberately absent from this app's
 * env schema so a compromised agent device cannot reach live Stripe
 * credentials.
 */
export function getCore(): CoreConfig {
  return createRuntime({
    databaseUrl: env.DATABASE_URL,
    ...resolvePushSender(),
    ...resolveOpsAlerter(),
    payments: { kind: "fake", currency: "usd" },
    // `reportVisitException` raises `booking/exception_raised` from inside
    // core; this adapter is what turns it into an ops alert email. Without
    // it, a field exception is silent outside the exceptions board.
    emitter: inngestEmitter,
  });
}

/** Null when the database is not configured, so pages render an empty state. */
export function tryGetCore(): CoreConfig | null {
  return tryCreateRuntime({
    databaseUrl: env.DATABASE_URL,
    ...resolvePushSender(),
    ...resolveOpsAlerter(),
    payments: { kind: "fake", currency: "usd" },
    emitter: inngestEmitter,
  });
}
