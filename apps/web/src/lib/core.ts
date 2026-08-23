import "server-only";

import {
  createRuntime,
  tryCreateRuntime,
  type CoreConfig,
  type NotifierConfig,
  type PaymentProviderConfig,
  type TicketExtractorConfig,
} from "@koolee/core";

import { env, optionalEnv } from "@/env";

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
 * Real email iff `RESEND_API_KEY` is set, otherwise the console notifier —
 * dev is unchanged by the Resend integration. Production REQUIRES the key
 * (fail-closed boot gate in env.ts).
 */
export function resolveNotifierConfig(): NotifierConfig {
  const apiKey = optionalEnv("RESEND_API_KEY");
  return apiKey ? { kind: "resend", apiKey, from: env.RESEND_FROM } : { kind: "console" };
}

/** Throws when the database is not configured. Use in mutation paths. */
export function getCore(): CoreConfig {
  return createRuntime({
    databaseUrl: env.DATABASE_URL,
    payments: resolvePaymentConfig(),
    extraction: resolveExtractionConfig(),
    notifications: resolveNotifierConfig(),
  });
}

/**
 * Null when the database is not configured, so a page can render an empty
 * state instead of a 500. Every read path on a fresh clone hits this.
 */
export function tryGetCore(): CoreConfig | null {
  return tryCreateRuntime({
    databaseUrl: env.DATABASE_URL,
    payments: resolvePaymentConfig(),
    extraction: resolveExtractionConfig(),
    notifications: resolveNotifierConfig(),
  });
}
