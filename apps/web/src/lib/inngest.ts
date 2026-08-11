import "server-only";

import { cron } from "inngest";
import { captureDueBookings } from "@koolee/core";
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

/**
 * Capture the money once the bags are in our custody. Lives here for the same
 * reason the route does: apps/web is the app with Stripe credentials. The
 * agent app completes the visit and deliberately never touches payments, so
 * without this nothing would ever charge the customer.
 *
 * Every 5 minutes rather than on a transition, because nothing server-side
 * observes the agent's completion. Card authorizations are valid for days, so
 * a few minutes' lag costs nothing; the sweep is idempotent, so overlapping
 * runs are harmless. Also invokable by hand via /api/jobs/capture-due.
 */
const captureDueCron = inngest.createFunction(
  {
    id: "capture-due-bookings",
    name: "Capture authorizations for bags already in custody",
    triggers: [cron("*/5 * * * *")],
  },
  async ({ step, logger }) => {
    return step.run("capture-due", async () => {
      const result = await captureDueBookings(getCore());
      if (result.captured.length > 0 || result.failed.length > 0) {
        logger.info(
          `captured ${result.captured.length}, failed ${result.failed.length}`,
        );
      }
      return result;
    });
  },
);

export const functions = [
  ...createKooleeFunctions(inngest, () => getCore()),
  cleanupAnonymousUsersCron,
  captureDueCron,
];
