import { completeVisitRequestSchema } from "@koolee/api-contract";

import { apiRoute } from "@/api/route";
import { completeVisit } from "@/api/handlers/visit";

export const dynamic = "force-dynamic";

export const POST = apiRoute(
  { body: completeVisitRequestSchema, mutating: true, logPrefix: "[api/visit/complete]" },
  async (ctx, { body, params }) => ({
    body: await completeVisit(ctx, params.taskId ?? "", body),
  }),
);
