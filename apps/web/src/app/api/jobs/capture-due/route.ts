import { NextResponse } from "next/server";
import { captureDueBookings } from "@koolee/core";

import { optionalEnv } from "@/env";
import { tryGetCore } from "@/lib/core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Captures authorizations whose bags are already in Koolee's custody — the
 * same function the Inngest cron runs every 5 minutes.
 *
 *   curl -X POST -H "x-cron-secret: $CRON_SECRET" /api/jobs/capture-due
 *
 * This lives in apps/web because this is the app that holds Stripe
 * credentials. The agent app deliberately holds none, so it cannot (and must
 * not) take the money at the moment it completes a visit — see
 * `completeVerificationVisit` and `captureDueBookings`.
 *
 * Protected by CRON_SECRET; refuses to run without one so it can never be
 * triggered anonymously in production.
 */
export async function POST(request: Request) {
  const secret = optionalEnv("CRON_SECRET");
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

  const core = tryGetCore();
  if (!core) {
    return NextResponse.json({ error: "Database not configured." }, { status: 503 });
  }

  const result = await captureDueBookings(core);
  return NextResponse.json({
    captured: result.captured.length,
    failed: result.failed.length,
    bookingIds: result,
  });
}
