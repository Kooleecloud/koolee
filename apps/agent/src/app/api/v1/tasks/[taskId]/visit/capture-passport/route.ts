import { capturePassportRequestSchema } from "@koolee/api-contract";

import { apiRoute } from "@/api/route";
import { capturePassport } from "@/api/handlers/visit";

export const dynamic = "force-dynamic";

export const POST = apiRoute(
  {
    body: capturePassportRequestSchema,
    mutating: true,
    logPrefix: "[api/visit/capture-passport]",
  },
  async (ctx, { body, params }) => ({
    body: await capturePassport(ctx, params.taskId ?? "", body),
  }),
);
