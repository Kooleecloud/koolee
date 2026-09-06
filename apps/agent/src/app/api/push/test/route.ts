import { NextResponse } from "next/server";
import { listPushTargets, pushToTargets } from "@koolee/core";

import { getCore } from "@/lib/core";
import { requireAgentSession } from "@/lib/session";

/**
 * Sends a REAL push to the caller's own devices, through the whole pipeline.
 *
 * This ships enabled in production, and it should: it is the server half of
 * the "did you see it?" check, which is the only way to detect the failures
 * that are invisible to JavaScript (an OS per-app switch, Focus, an alert
 * style of "None"). Every layer can report success with the screen empty —
 * so the product asks a human, and this is what it asks them about.
 *
 * Not an abuse surface: it pushes ONLY to subscriptions belonging to the
 * session user, so the worst anyone can do with it is notify themselves.
 *
 * The response says `accepted`, never `delivered`. A 201 from a push service
 * means the message was taken, and there are no delivery receipts anywhere in
 * this technology.
 */

export const dynamic = "force-dynamic";

async function userIdOrNull(): Promise<string | null> {
  try {
    return (await requireAgentSession()).userId;
  } catch {
    return null;
  }
}

export async function POST(): Promise<NextResponse> {
  const userId = await userIdOrNull();
  if (!userId) return NextResponse.json({ error: "not_authorized" }, { status: 401 });

  const core = getCore();

  /*
   * REFUSE RATHER THAN PRETEND.
   *
   * With no VAPID keys the runtime falls back to `ConsolePushSender`, which
   * logs a line and returns `{ sent: 1, failed: 0 }` — indistinguishable from
   * a perfect send in the counts. This route reports to a HUMAN, who is about
   * to be asked whether they saw a notification, so it must not treat a log
   * line as a delivery. Counts cannot answer "was that real"; `delivers` can.
   */
  if (!core.pushSender.delivers) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  const targets = await listPushTargets(core.db, [userId]);
  if (targets.length === 0) {
    return NextResponse.json({ error: "no_subscription" }, { status: 409 });
  }

  const result = await pushToTargets(
    core,
    targets,
    {
      title: "Notifications are working",
      body: "This is the test we asked you about. Nothing to do.",
      // Unique per attempt: a stable tag would make a SECOND test silently
      // replace the first with no banner and no sound, which is exactly the
      // failure this whole flow exists to detect.
      tag: `push-test:${Date.now()}`,
      url: "/account",
    },
    { urgency: "high" },
  );

  return NextResponse.json({ accepted: result.sent > 0, ...result });
}
