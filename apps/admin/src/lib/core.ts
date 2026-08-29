import "server-only";

import {
  createRuntime,
  tryCreateRuntime,
  type CoreConfig,
  type PaymentProviderConfig,
} from "@koolee/core";

import { env, optionalEnv } from "@/env";
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

/** Throws when the database is not configured. Use in mutation paths. */
export function getCore(): CoreConfig {
  return createRuntime({
    databaseUrl: env.DATABASE_URL,
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
    payments: resolvePaymentConfig(),
    emitter: inngestEmitter,
  });
}
