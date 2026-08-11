import { NextResponse } from "next/server";
import { expireBookingDrafts } from "@koolee/core";
import { cleanupAnonymousUsers } from "@koolee/core/jobs";

import { optionalEnv } from "@/env";
import { tryGetCore } from "@/lib/core";
import { deleteAuthUser } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Manually-invokable trigger for the abandoned-draft + anonymous-user GC —
 * the same function the Inngest cron runs daily at 04:00 America/New_York.
 *
 *   curl -X POST -H "x-cron-secret: $CRON_SECRET" /api/jobs/cleanup-anon
 *
 * Protected by CRON_SECRET; the route refuses to run without one so it can
 * never be triggered anonymously in production.
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

  const result = await cleanupAnonymousUsers(core.db, { deleteAuthUser });

  // Drafts past their inactivity expiry: soft-delete + unwind any draft
  // booking still holding a slot seat or a confirmable payment intent.
  // Needs the full core config (payment provider), unlike the user GC.
  const drafts = await expireBookingDrafts(core);

  return NextResponse.json({ ...result, ...drafts });
}
