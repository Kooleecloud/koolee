import { recordDriverPosition } from "@koolee/core";
import type { PositionsRequest, PositionsResponse } from "@koolee/api-contract";

import type { ApiContext } from "../context";

/**
 * `POST /api/v1/positions` — the app's port of `app/api/driver-position`.
 *
 * OLDEST FIRST, one at a time. Only the newest fix can win the position row
 * (`recordDriverPosition` conditions the upsert on `recorded_at`), but each
 * fix is still a real observation, and a backlog drained after a tunnel is
 * what answers "how long were we blind". Sequential rather than
 * `Promise.all` because every fix contends on the same one row per driver;
 * firing a batch at it concurrently trades a tidy loop for lock waits.
 *
 * Off shift, core throws `NotAuthorizedError`; the route declares
 * `notOnShift` so that reaches the app as 409 `not_on_shift` and the queue
 * drops the ping rather than retrying it forever.
 */
export async function recordPositions(
  ctx: ApiContext,
  body: PositionsRequest,
): Promise<PositionsResponse> {
  const fixes = "fixes" in body ? body.fixes : [body];

  for (const fix of fixes) {
    await recordDriverPosition(ctx.core, {
      staffUserId: ctx.session.userId,
      lat: fix.lat,
      lng: fix.lng,
      ...(fix.recordedAt ? { recordedAt: new Date(fix.recordedAt) } : {}),
    });
  }

  return { ok: true, accepted: fixes.length };
}
