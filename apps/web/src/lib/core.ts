import "server-only";

import * as Sentry from "@sentry/nextjs";
import {
  createRuntime,
  SentryOpsAlerter,
  tryCreateRuntime,
  type CoreConfig,
  type OpsAlerter,
  type EtaEstimatorConfig,
  type NotifierConfig,
  type PushSender,
  type PaymentProviderConfig,
  type TicketExtractorConfig,
} from "@koolee/core";

import { env, optionalEnv, pushNotificationsEnabled } from "@/env";
import { inngestEmitter } from "@/lib/event-emitter";
import { createWebPushSender } from "@koolee/core/web-push";

/**
 * Builds the injected `CoreConfig` from this app's validated environment.
 *
 * `packages/core` reads no environment variables — apps resolve credentials
 * and pass plain values in. This module is the only place in apps/web that
 * turns env into a runtime.
 */

/** Stripe when a key is present, otherwise the in-memory fake. */
export function resolvePaymentConfig(): PaymentProviderConfig {
  const secretKey = optionalEnv("STRIPE_SECRET_KEY");
  if (!secretKey) return { kind: "fake", currency: "usd" };

  const webhookSecret = optionalEnv("STRIPE_WEBHOOK_SECRET");
  return {
    kind: "stripe",
    secretKey,
    ...(webhookSecret === undefined ? {} : { webhookSecret }),
    currency: "usd",
  };
}

/** True when real card collection is possible in the browser. */
export function hasStripeCheckout(): boolean {
  return (
    Boolean(optionalEnv("STRIPE_SECRET_KEY")) &&
    Boolean(optionalEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY"))
  );
}

/**
 * The pay step's three honest configurations:
 *  - "ready": both Stripe keys present — the Payment Element collects a card;
 *  - "fake": no secret key — the in-memory FakePaymentProvider, dev only;
 *  - "misconfigured": secret key WITHOUT a publishable key. The runtime would
 *    authorize against real Stripe but the browser can never confirm, so the
 *    pay step must refuse loudly instead of pretending either mode works.
 */
export function stripeCheckoutState(): "ready" | "fake" | "misconfigured" {
  if (hasStripeCheckout()) return "ready";
  return optionalEnv("STRIPE_SECRET_KEY") ? "misconfigured" : "fake";
}

/**
 * Claude-powered ticket extraction iff `ANTHROPIC_API_KEY` is set, otherwise
 * the free in-process heuristic. One env var is the whole switch.
 */
export function resolveExtractionConfig(): TicketExtractorConfig {
  const apiKey = optionalEnv("ANTHROPIC_API_KEY");
  return apiKey ? { kind: "claude", apiKey } : { kind: "heuristic" };
}

/**
 * Whether a ticket upload may hand its RAW extraction diagnostics back to the
 * browser — every segment the model read, the leg it chose and why.
 *
 * Opt-in, off by default, and never appropriate on the production project:
 * the payload is a developer tool containing the customer's own itinerary.
 * See TICKET_EXTRACTION_DEBUG in env.ts.
 */
export function ticketExtractionDebugEnabled(): boolean {
  const flag = optionalEnv("TICKET_EXTRACTION_DEBUG");
  return flag === "1" || flag === "true";
}

/**
 * Real email iff `RESEND_API_KEY` is set, otherwise the console notifier —
 * dev is unchanged by the Resend integration. Production REQUIRES the key
 * (fail-closed boot gate in env.ts).
 */
export function resolveNotifierConfig(): NotifierConfig {
  const apiKey = optionalEnv("RESEND_API_KEY");
  return apiKey ? { kind: "resend", apiKey, from: env.RESEND_FROM } : { kind: "console" };
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

/**
 * The real web-push sender when all three VAPID values are present, otherwise
 * nothing — `createRuntime` then falls back to `ConsolePushSender`, which logs
 * and REPORTS SUCCESS. Production cannot reach the fallback: `env.ts` gates on
 * all three at boot.
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
 * The traffic-aware ETA when there is a key, the arithmetic one when there is
 * not. Selection is by presence, exactly like the payment provider above: a
 * fresh clone with no Google account estimates the way it always has.
 *
 * Never load-bearing either way — `GoogleRoutesEtaEstimator` falls back to
 * haversine on any failure — so this needs no boot gate and no "misconfigured"
 * state.
 */
function resolveEtaConfig(): EtaEstimatorConfig {
  const apiKey = optionalEnv("GOOGLE_MAPS_SERVER_KEY");
  return apiKey ? { kind: "google-routes", apiKey } : { kind: "haversine" };
}

/** `defaults` for `createRuntime`. Omitted keys keep the core default. */
function resolveDefaults(): { assignmentHorizonHours?: number } {
  const assignmentHorizonHours = resolveAssignmentHorizonHours();
  return assignmentHorizonHours === undefined ? {} : { assignmentHorizonHours };
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
    defaults: resolveDefaults(),
    ...resolvePushSender(),
    ...resolveOpsAlerter(),
    payments: resolvePaymentConfig(),
    extraction: resolveExtractionConfig(),
    notifications: resolveNotifierConfig(),
    eta: resolveEtaConfig(),
    // Core raises `booking/exception_raised` from the transition itself; this
    // is the adapter that puts it on the queue. Without it the emit is a noop
    // and no ops alert is sent.
    emitter: inngestEmitter,
  });
}

/**
 * Null when the database is not configured, so a page can render an empty
 * state instead of a 500. Every read path on a fresh clone hits this.
 */
export function tryGetCore(): CoreConfig | null {
  return tryCreateRuntime({
    databaseUrl: env.DATABASE_URL,
    defaults: resolveDefaults(),
    ...resolvePushSender(),
    ...resolveOpsAlerter(),
    payments: resolvePaymentConfig(),
    extraction: resolveExtractionConfig(),
    notifications: resolveNotifierConfig(),
    eta: resolveEtaConfig(),
    emitter: inngestEmitter,
  });
}
