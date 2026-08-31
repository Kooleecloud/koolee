import "server-only";

import * as Sentry from "@sentry/nextjs";
import { cron, eventType } from "inngest";
import { captureDueBookings } from "@koolee/core";
import { cleanupAnonymousUsers, createKooleeFunctions } from "@koolee/core/jobs";

import { optionalEnv } from "@/env";
import { SITE } from "@/lib/site";
import { getCore } from "@/lib/core";
import { inngest } from "@/lib/inngest-client";
import { deleteAuthUser } from "@/lib/supabase/admin";

/**
 * Inngest wiring for apps/web — the FUNCTION registry.
 *
 * The client itself lives in `lib/inngest-client.ts` so that `lib/core.ts`
 * can build an emitter from it without importing this module (which imports
 * `getCore` right back). Functions receive a `getConfig` thunk, so the
 * database connection is only opened when a run actually executes. Importing
 * this module with no credentials must not throw — the `/api/inngest` route
 * is registered on every boot.
 */

export { inngest };

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

/**
 * Terminal failures — the ones nobody was recording.
 *
 * Inngest retries a failing step and then gives up. Until this function
 * existed, "gives up" meant a red run in Inngest's own dashboard and nothing
 * else: no email, no ops alert, no Sentry event. The Tier 5 pre-flight put it
 * plainly (§2.3) — `grep onFailure|inngest/function.failed|retries:` across
 * the repo returned zero matches.
 *
 * ONE handler rather than an `onFailure` on each of the fifteen functions.
 * Inngest emits `inngest/function.failed` for every exhausted function in the
 * app, so a function added next year is covered without anybody remembering
 * to opt it in — which is the same reasoning that put the
 * `booking/exception_raised` emit inside `applyTransition` rather than at its
 * call sites.
 *
 * It reports and stops there. A retry-exhausted job is not something this
 * process can fix, and a handler that tried would be a second thing to fail.
 */
const terminalFailureCapture = inngest.createFunction(
  {
    id: "capture-terminal-failures",
    name: "Record a retry-exhausted function in Sentry",
    triggers: [eventType("inngest/function.failed")],
  },
  async ({ event, logger }) => {
    const data = (event.data ?? {}) as {
      function_id?: string;
      run_id?: string;
      error?: { name?: string; message?: string; stack?: string };
      event?: { data?: Record<string, unknown> };
    };
    const functionId = data.function_id ?? "unknown";
    const bookingId = data.event?.data?.["bookingId"];

    logger.error(`[inngest] ${functionId} exhausted its retries`, data.error ?? {});

    const error = new Error(
      `Inngest function ${functionId} failed: ${data.error?.message ?? "unknown error"}`,
    );
    error.name = "InngestTerminalFailure";
    if (data.error?.stack) error.stack = data.error.stack;

    Sentry.captureException(error, {
      level: "fatal",
      tags: {
        inngest_function: functionId,
        ...(typeof bookingId === "string" ? { booking_id: bookingId } : {}),
      },
      extra: { runId: data.run_id, originalEvent: data.event?.data },
    });

    return { captured: functionId };
  },
);

export const functions = [
  ...createKooleeFunctions(inngest, () => getCore(), {
    opsAlertEmail: optionalEnv("OPS_ALERT_EMAIL"),
    appOrigin: optionalEnv("NEXT_PUBLIC_APP_URL"),
    // Push deep links into the staff apps. Absent → the notification still
    // goes, without a link (see KooleeFunctionOptions).
    agentAppOrigin: optionalEnv("NEXT_PUBLIC_AGENT_APP_URL"),
    adminAppOrigin: optionalEnv("NEXT_PUBLIC_ADMIN_APP_URL"),
    // Public site copy, not per-environment config, so it comes from SITE
    // rather than an env var — and core still reads no environment. This is
    // the address the customer-facing exception email tells people to write
    // to; without it that email is skipped rather than sent with a
    // placeholder nobody monitors.
    supportEmail: SITE.contactEmail,
  }),
  cleanupAnonymousUsersCron,
  captureDueCron,
  terminalFailureCapture,
];
