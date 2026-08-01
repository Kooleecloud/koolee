import "server-only";

import {
  createRuntime,
  tryCreateRuntime,
  type CoreConfig,
  type PaymentProviderConfig,
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

/** Throws when the database is not configured. Use in mutation paths. */
export function getCore(): CoreConfig {
  return createRuntime({
    databaseUrl: env.DATABASE_URL,
    payments: resolvePaymentConfig(),
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
  });
}
