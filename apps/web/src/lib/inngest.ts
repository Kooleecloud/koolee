import "server-only";

import { cron } from "inngest";
import {
  cleanupAnonymousUsers,
  createInngestClient,
  createKooleeFunctions,
} from "@koolee/core/jobs";

import { env, optionalEnv } from "@/env";
import { getCore } from "@/lib/core";
import { deleteAuthUser } from "@/lib/supabase/admin";

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

/**
 * Abandoned-draft + anonymous-user GC. Lives here rather than in core because
 * deleting the Supabase auth user needs the service-role client, and core
 * reads no environment. Also invokable by hand via /api/jobs/cleanup-anon.
 */
const cleanupAnonymousUsersCron = inngest.createFunction(
  {
    id: "cleanup-anonymous-users",
    name: "Delete stale anonymous users and their drafts",
    triggers: [cron("TZ=America/New_York 0 4 * * *")],
  },
  async ({ step, logger }) => {
    return step.run("cleanup", async () => {
      const config = getCore();
      const result = await cleanupAnonymousUsers(config.db, {
        deleteAuthUser,
        log: (message) => logger.info(message),
      });
      return result;
    });
  },
);

export const functions = [
  ...createKooleeFunctions(inngest, () => getCore()),
  cleanupAnonymousUsersCron,
];
