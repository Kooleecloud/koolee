import "server-only";

import * as Sentry from "@sentry/nextjs";
import {
  createRuntime,
  SentryOpsAlerter,
  tryCreateRuntime,
  type CoreConfig,
  type OpsAlerter,
  type PushSender,
  type PaymentProviderConfig,
} from "@koolee/core";

import { env, optionalEnv, pushNotificationsEnabled } from "@/env";
import { createWebPushSender } from "@koolee/core/web-push";
import { inngestEmitter } from "@/lib/event-emitter";

/**
 * Builds the injected `CoreConfig` from this app's validated environment.
 * `packages/core` reads no environment variables.
 *
 * Admin gets real Stripe when a key is present because refunds are issued from
 * the ops console.
 */
function resolvePaymentConfig(): PaymentProviderConfig {
  const secretKey = optionalEnv("STRIPE_SECRET_KEY");
  return secretKey
    ? { kind: "stripe", secretKey, currency: "usd" }
    : { kind: "fake", currency: "usd" };
}

/**
 * The assignment horizon, as a NUMBER of hours.
 *
 * Kept as a plain string in `env.ts` (every var there is optional and never
 * throws) and parsed here, because the failure mode matters: a typo must fall
 * back to the core default rather than boot the app with `NaN` hours, which
 * would make `withinAssignmentHorizon` false for everything and quietly stop
 * assigning anybody. Zero and negatives are rejected for the same reason —
 * they are not a configuration anyone means.
 */
export function resolveAssignmentHorizonHours(): number | undefined {
  const raw = optionalEnv("ASSIGNMENT_HORIZON_HOURS");
  if (raw === undefined) return undefined;
  const hours = Number(raw);
  if (!Number.isFinite(hours) || hours <= 0) {
    console.warn(
      `[env] ASSIGNMENT_HORIZON_HOURS="${raw}" is not a positive number; using the default.`,
    );
    return undefined;
  }
  return hours;
}

/** `defaults` for `createRuntime`. Omitted keys keep the core default. */
function resolveDefaults(): { assignmentHorizonHours?: number } {
  const assignmentHorizonHours = resolveAssignmentHorizonHours();
  return assignmentHorizonHours === undefined ? {} : { assignmentHorizonHours };
}

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

/** Throws when the database is not configured. Use in mutation paths. */
export function getCore(): CoreConfig {
  return createRuntime({
    databaseUrl: env.DATABASE_URL,
    ...resolvePushSender(),
    ...resolveOpsAlerter(),
    defaults: resolveDefaults(),
    payments: resolvePaymentConfig(),
    // An ops override can move a booking to `exception` too; core emits from
    // the transition, so the console needs the same adapter the other apps
    // have.
    emitter: inngestEmitter,
  });
}

/** Null when the database is not configured, so pages render an empty state. */
export function tryGetCore(): CoreConfig | null {
  return tryCreateRuntime({
    databaseUrl: env.DATABASE_URL,
    ...resolvePushSender(),
    ...resolveOpsAlerter(),
    defaults: resolveDefaults(),
    payments: resolvePaymentConfig(),
    emitter: inngestEmitter,
  });
}
