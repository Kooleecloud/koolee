import { confirmPassportRequestSchema } from "@koolee/api-contract";

import { apiRoute } from "@/api/route";
import { confirmPassport } from "@/api/handlers/visit";

export const dynamic = "force-dynamic";

export const POST = apiRoute(
  {
    body: confirmPassportRequestSchema,
    mutating: true,
    logPrefix: "[api/visit/confirm-passport]",
  },
  async (ctx, { body, params }) => ({
    body: await confirmPassport(ctx, params.taskId ?? "", body),
  }),
);
