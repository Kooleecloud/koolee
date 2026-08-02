import "server-only";

import { createInngestClient, createKooleeFunctions } from "@koolee/core/jobs";

import { env, optionalEnv } from "@/env";
import { getCore } from "@/lib/core";

/**
 * Inngest wiring for apps/web.
 *
 * The client is created at module scope (cheap, no I/O) but the functions
 * receive a `getConfig` thunk, so the database connection is only opened when a
 * run actually executes. Importing this module with no credentials must not
 * throw — the `/api/inngest` route is registered on every boot.
 */

export const inngest = createInngestClient({
  eventKey: optionalEnv("INNGEST_EVENT_KEY"),
  // v4: the signing key lives on the client, not the serve() handler.
  signingKey: optionalEnv("INNGEST_SIGNING_KEY"),
  isDev: env.NODE_ENV !== "production",
});

export const functions = createKooleeFunctions(inngest, () => getCore());
