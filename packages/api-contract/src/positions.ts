import { z } from "zod";

import { isoDateTime } from "./common";

/**
 * `POST /api/v1/positions` — the driver's position while on shift.
 *
 * Same contract as the web app's `/api/driver-position`, so the queue
 * disposition rules carry over: 4xx (including 409 not_on_shift) is dropped,
 * 5xx / network is kept and retried. `recordedAt` is the DEVICE fix time;
 * the server keeps the newest per driver and drops older fixes silently.
 */
export const positionFixSchema = z.object({
  lat: z.number().finite(),
  lng: z.number().finite(),
  recordedAt: isoDateTime.optional(),
});
export type PositionFix = z.infer<typeof positionFixSchema>;

export const POSITIONS_MAX_BATCH = 120;

export const positionsRequestSchema = z.union([
  positionFixSchema,
  z.object({ fixes: z.array(positionFixSchema).min(1).max(POSITIONS_MAX_BATCH) }),
]);
export type PositionsRequest = z.infer<typeof positionsRequestSchema>;

export const positionsResponseSchema = z.object({
  ok: z.literal(true),
  accepted: z.number().int(),
});
export type PositionsResponse = z.infer<typeof positionsResponseSchema>;
