import { handoverRequestSchema } from "@koolee/api-contract";

import { apiRoute } from "@/api/route";
import { handover } from "@/api/handlers/pickup";

export const dynamic = "force-dynamic";

export const POST = apiRoute(
  { body: handoverRequestSchema, mutating: true, logPrefix: "[api/pickup/handover]" },
  async (ctx, { body, params }) => ({
    body: await handover(ctx, params.taskId ?? "", body),
  }),
);
