import {
  pushRegisterRequestSchema,
  pushUnregisterRequestSchema,
} from "@koolee/api-contract";

import { apiRoute } from "@/api/route";
import { registerPushToken, unregisterPushToken } from "@/api/handlers/push";

export const dynamic = "force-dynamic";

export const POST = apiRoute(
  { body: pushRegisterRequestSchema, mutating: true, logPrefix: "[api/push/register]" },
  async (ctx, { body }) => ({
    status: 201,
    body: await registerPushToken(ctx, body),
  }),
);

export const DELETE = apiRoute(
  {
    body: pushUnregisterRequestSchema,
    mutating: true,
    logPrefix: "[api/push/register]",
  },
  async (ctx, { body }) => ({ body: await unregisterPushToken(ctx, body) }),
);
