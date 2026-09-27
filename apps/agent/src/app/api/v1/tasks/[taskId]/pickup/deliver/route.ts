import { deliverRequestSchema } from "@koolee/api-contract";

import { apiRoute } from "@/api/route";
import { deliver } from "@/api/handlers/pickup";

export const dynamic = "force-dynamic";

export const POST = apiRoute(
  { body: deliverRequestSchema, mutating: true, logPrefix: "[api/pickup/deliver]" },
  async (ctx, { body, params }) => ({
    body: await deliver(ctx, params.taskId ?? "", body),
  }),
);
