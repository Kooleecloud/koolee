import { NextResponse } from "next/server";
import { z } from "zod";
import { InvalidInputError, NotAuthorizedError, recordDriverPosition } from "@koolee/core";

import { getCore } from "@/lib/core";
import { requireAgentSession } from "@/lib/session";

/**
 * The driver's latest position.
 *
 * A route handler rather than a server action because the caller is a plain
 * `fetch` on a 45-second interval, not a form — and because a server action
 * would revalidate the page on every ping, re-rendering a driver's screen
 * forty times an hour for a value that screen does not show.
 *
 * The session is resolved per request, exactly like every other agent
 * endpoint, and `recordDriverPosition` refuses a driver who is not on shift —
 * so a tab left open after clock-off stops writing.
 *
 * Nothing written here is evidence. See `schema/ops.ts`: one mutable row per
 * driver, explicitly not part of the chain of custody.
 */

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  lat: z.number().finite(),
  lng: z.number().finite(),
  recordedAt: z.iso.datetime().optional(),
});

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

  try {
    await recordDriverPosition(getCore(), {
      staffUserId: session.userId,
      lat: parsed.data.lat,
      lng: parsed.data.lng,
      ...(parsed.data.recordedAt
        ? { recordedAt: new Date(parsed.data.recordedAt) }
        : {}),
    });
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

  return NextResponse.json({ ok: true });
}
