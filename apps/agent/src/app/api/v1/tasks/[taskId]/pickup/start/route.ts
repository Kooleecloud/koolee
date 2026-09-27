import { startPickupRequestSchema } from "@koolee/api-contract";

import { apiRoute } from "@/api/route";
import { startPickup } from "@/api/handlers/pickup";

export const dynamic = "force-dynamic";

export const POST = apiRoute(
  { body: startPickupRequestSchema, mutating: true, logPrefix: "[api/pickup/start]" },
  async (ctx, { body, params }) => ({
    body: await startPickup(ctx, params.taskId ?? "", body),
  }),
);
