import { sealBagRequestSchema } from "@koolee/api-contract";

import { apiRoute } from "@/api/route";
import { sealBag } from "@/api/handlers/visit";

export const dynamic = "force-dynamic";

export const POST = apiRoute(
  { body: sealBagRequestSchema, mutating: true, logPrefix: "[api/visit/seal-bag]" },
  async (ctx, { body, params }) => ({
    body: await sealBag(ctx, params.taskId ?? "", body),
  }),
);
