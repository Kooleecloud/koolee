import { pickupExceptionRequestSchema } from "@koolee/api-contract";

import { apiRoute } from "@/api/route";
import { reportPickupException } from "@/api/handlers/pickup";

export const dynamic = "force-dynamic";

export const POST = apiRoute(
  {
    body: pickupExceptionRequestSchema,
    mutating: true,
    logPrefix: "[api/pickup/exception]",
  },
  async (ctx, { body, params }) => ({
    body: await reportPickupException(ctx, params.taskId ?? "", body),
  }),
);
