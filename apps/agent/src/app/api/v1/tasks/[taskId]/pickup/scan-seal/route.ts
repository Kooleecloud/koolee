import { scanSealRequestSchema } from "@koolee/api-contract";

import { apiRoute } from "@/api/route";
import { scanSeal } from "@/api/handlers/pickup";

export const dynamic = "force-dynamic";

export const POST = apiRoute(
  { body: scanSealRequestSchema, mutating: true, logPrefix: "[api/pickup/scan-seal]" },
  async (ctx, { body, params }) => ({
    body: await scanSeal(ctx, params.taskId ?? "", body),
  }),
);
