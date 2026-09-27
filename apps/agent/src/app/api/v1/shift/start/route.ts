import { startShiftRequestSchema } from "@koolee/api-contract";

import { apiRoute } from "@/api/route";
import { startDriverShift } from "@/api/handlers/shift";

export const dynamic = "force-dynamic";

export const POST = apiRoute(
  { body: startShiftRequestSchema, mutating: true, logPrefix: "[api/shift/start]" },
  async (ctx, { body }) => ({
    status: 201,
    body: await startDriverShift(ctx, body.truckId),
  }),
);
