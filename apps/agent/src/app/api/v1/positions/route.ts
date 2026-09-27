import { positionsRequestSchema } from "@koolee/api-contract";

import { apiRoute } from "@/api/route";
import { recordPositions } from "@/api/handlers/positions";

export const dynamic = "force-dynamic";

/**
 * Not `mutating` on purpose: a position is naturally idempotent (newest wins
 * in the database), and a 5-second cadence must not write an idempotency
 * row per ping. `notOnShift` turns core's refusal into 409 `not_on_shift`,
 * which the app's queue drops instead of retrying.
 */
export const POST = apiRoute(
  { body: positionsRequestSchema, notOnShift: true, logPrefix: "[api/positions]" },
  async (ctx, { body }) => ({ body: await recordPositions(ctx, body) }),
);
