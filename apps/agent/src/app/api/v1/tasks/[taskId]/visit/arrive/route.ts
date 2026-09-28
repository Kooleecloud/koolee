import { arriveRequestSchema } from "@koolee/api-contract";

import { apiRoute } from "@/api/route";
import { arrive } from "@/api/handlers/visit";

export const dynamic = "force-dynamic";

export const POST = apiRoute(
  { body: arriveRequestSchema, mutating: true, logPrefix: "[api/visit/arrive]" },
  async (ctx, { body, params }) => ({
    body: await arrive(ctx, params.taskId ?? "", body),
  }),
);
