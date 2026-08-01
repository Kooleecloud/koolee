import "server-only";

import { createRuntime, tryCreateRuntime, type CoreConfig } from "@koolee/core";

import { env } from "@/env";

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
    payments: { kind: "fake", currency: "usd" },
  });
}

/** Null when the database is not configured, so pages render an empty state. */
export function tryGetCore(): CoreConfig | null {
  return tryCreateRuntime({
    databaseUrl: env.DATABASE_URL,
    payments: { kind: "fake", currency: "usd" },
  });
}
