import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";

import { optionalEnv } from "@/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Proves this app's Sentry wiring reaches this app's Sentry project.
 *
 *   curl -X POST -H "x-cron-secret: $CRON_SECRET" <origin>/api/observability/test-error
 *
 * WHY A ROUTE AND NOT A PAGE. Sentry's own wizard scaffolds an unguarded page
 * that throws on click. A deployed 500-generator anybody can hit is a nuisance
 * at best and an alert-noise generator at worst, so this is a POST behind
 * `CRON_SECRET` — the same guard `/api/jobs/*` already uses, for the same
 * reason: it must never be triggerable anonymously in production.
 *
 * WHAT IT PROVES. The event carries the app tag, the environment and the
 * release, so the reply below is what a person compares against what shows up
 * in Sentry: right project, right environment, right commit. It captures a
 * message (not an exception) and returns 200 — a route that threw would be
 * indistinguishable from a route that is broken, and would also be captured a
 * second time by `onRequestError`.
 *
 * See docs/runbooks/prod-bringup.md for the post-deploy step this belongs to.
 */
export async function POST(request: Request) {
  /*
   * ON A LAPTOP THIS NEEDS NO SECRET, and that is the point of the branch.
   *
   * "Is Sentry actually receiving anything, or do I only find out once it is
   * deployed?" is a fair question, and the honest answer is that the wiring
   * works locally — `sentryOptions` sets `enabled: Boolean(dsn)`, so a DSN in
   * `.env.local` sends real events tagged `environment: "development"`. But
   * the only way to PROVE it was this route, and this route refused to run
   * without a CRON_SECRET nobody sets on a laptop. So the proof was available
   * only in production, which is exactly backwards.
   *
   * The guard exists so a deployed 500-generator is not anonymously
   * triggerable. `NODE_ENV` is set by the runtime and cannot be spoofed by a
   * request, so gating on it keeps that property intact: in a built,
   * deployed app the secret is still required, exactly as before.
   */
  const development = process.env.NODE_ENV !== "production";
  const secret = optionalEnv("CRON_SECRET");

  if (!development) {
    if (!secret) {
      return NextResponse.json(
        { error: "CRON_SECRET is not configured; refusing to run." },
        { status: 503 },
      );
    }

    const presented =
      request.headers.get("x-cron-secret") ??
      request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (presented !== secret) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const dsn = optionalEnv("NEXT_PUBLIC_SENTRY_DSN");
  const stamp = new Date().toISOString();
  const eventId = Sentry.captureMessage(`Koolee observability test — ${stamp}`, "error");
  // Serverless: the process can be frozen the moment the response is written,
  // with the event still in the transport queue.
  await Sentry.flush(2000);

  return NextResponse.json({
    sent: Boolean(dsn),
    // The sentence somebody running this locally actually needs.
    note: dsn
      ? "Sent. Look for this stamp in Sentry under environment=development."
      : "NOT sent: NEXT_PUBLIC_SENTRY_DSN is unset, so the SDK is disabled. Set it in .env.local and restart the dev server.",
    eventId: eventId ?? null,
    stamp,
    // What to expect beside the event in Sentry. `sent: false` with an
    // eventId is the DSN-less case: the SDK still mints an id and drops the
    // event, which is exactly how a local run should behave.
    expect: {
      environment:
        process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.VERCEL_ENV ?? "development",
      release:
        process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ??
        process.env.VERCEL_GIT_COMMIT_SHA ??
        null,
    },
  });
}
