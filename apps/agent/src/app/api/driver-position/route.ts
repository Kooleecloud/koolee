import { NextResponse } from "next/server";
import { z } from "zod";
import {
  InvalidInputError,
  NotAuthorizedError,
  recordDriverPosition,
} from "@koolee/core";

import { getCore } from "@/lib/core";
import { requireAgentSession } from "@/lib/session";

/**
 * The driver's latest position.
 *
 * A route handler rather than a server action because the caller is a plain
 * `fetch` from a `watchPosition` subscription, not a form — and because a
 * server action would revalidate the page on every ping, re-rendering a
 * driver's screen forty times an hour for a value that screen does not show.
 *
 * THREE CALLERS, and they are why the body accepts two shapes: the live
 * pinger (one fix), the offline queue draining a backlog (many), and
 * `sendBeacon` on pagehide (one again, because a beacon body is size-capped).
 * `public/sw.js` is a fourth in effect — it drains the same queue on a
 * Background Sync event after the tab is gone.
 *
 * The session is resolved per request, exactly like every other agent
 * endpoint, and `recordDriverPosition` refuses a driver who is not on shift —
 * so a tab left open after clock-off stops writing.
 *
 * Nothing written here is evidence. See `schema/ops.ts`: one mutable row per
 * driver, explicitly not part of the chain of custody.
 */

export const dynamic = "force-dynamic";

const fixSchema = z.object({
  lat: z.number().finite(),
  lng: z.number().finite(),
  recordedAt: z.iso.datetime().optional(),
});

/**
 * One fix, or a batch of them.
 *
 * TWO SHAPES, ONE ROUTE. The live pinger sends a single fix; the offline queue
 * drains a backlog in one request after a tunnel, and `sendBeacon` on pagehide
 * sends a single fix again because a beacon body is size-capped. A second
 * endpoint for the batch would have meant a second session check, a second
 * error vocabulary and a second thing to keep in step with `sw.js`.
 *
 * The batch is capped at the queue's own ceiling (`MAX_QUEUED`, 120) so a
 * malformed or hostile body cannot ask this handler to do unbounded work.
 */
const bodySchema = z.union([
  fixSchema,
  z.object({ fixes: z.array(fixSchema).min(1).max(120) }),
]);

export async function POST(request: Request): Promise<NextResponse> {
  let session;
  try {
    session = await requireAgentSession();
  } catch {
    return NextResponse.json({ error: "not_authorized" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  /*
   * OLDEST FIRST, and applied one at a time rather than reduced to the newest
   * here. Only the newest can win the position row — `recordDriverPosition`
   * enforces that with a condition on the upsert — but each fix is still a
   * real observation, and the ping log that phase 4 adds is what turns a
   * backlog into an answer to "how long were we blind".
   *
   * Sequential, not `Promise.all`: they contend on one row per driver, and
   * firing a backlog at it concurrently trades a tidy loop for lock waits.
   */
  const fixes = "fixes" in parsed.data ? parsed.data.fixes : [parsed.data];

  try {
    for (const fix of fixes) {
      await recordDriverPosition(getCore(), {
        staffUserId: session.userId,
        lat: fix.lat,
        lng: fix.lng,
        ...(fix.recordedAt ? { recordedAt: new Date(fix.recordedAt) } : {}),
      });
    }
  } catch (error) {
    // Off shift is the expected failure — a tab left open after clock-off.
    // 409, not 500: nothing is broken, the ping is simply no longer wanted.
    if (error instanceof NotAuthorizedError) {
      return NextResponse.json({ error: "not_on_shift" }, { status: 409 });
    }
    if (error instanceof InvalidInputError) {
      return NextResponse.json({ error: "invalid_position" }, { status: 400 });
    }
    console.error("[driver-position] write failed", error);
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }

  return NextResponse.json({ ok: true, accepted: fixes.length });
}
