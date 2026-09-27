import { visitExceptionRequestSchema } from "@koolee/api-contract";

import { apiRoute } from "@/api/route";
import { reportVisitException } from "@/api/handlers/visit";

export const dynamic = "force-dynamic";

export const POST = apiRoute(
  {
    body: visitExceptionRequestSchema,
    mutating: true,
    logPrefix: "[api/visit/exception]",
  },
  async (ctx, { body, params }) => ({
    body: await reportVisitException(ctx, params.taskId ?? "", body),
  }),
);
