import "server-only";

import { createInngestClient } from "@koolee/core/jobs";

import { env, optionalEnv } from "@/env";

/**
 * The Inngest client, alone in its own module.
 *
 * Split out of `lib/inngest.ts` because that module imports `getCore`, and
 * `lib/core.ts` now needs the client to build the event emitter it injects
 * into the runtime. Importing the whole function registry from `core.ts`
 * would be a cycle; importing the client is not.
 *
 * Cheap and I/O-free, so module scope is fine.
 */
export const inngest = createInngestClient({
  eventKey: optionalEnv("INNGEST_EVENT_KEY"),
  // v4: the signing key lives on the client, not the serve() handler.
  signingKey: optionalEnv("INNGEST_SIGNING_KEY"),
  isDev: env.NODE_ENV !== "production",
});
