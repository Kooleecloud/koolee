import { setAvatarRequestSchema } from "@koolee/api-contract";

import { apiRoute } from "@/api/route";
import { clearAvatar, setAvatar } from "@/api/handlers/account";

export const dynamic = "force-dynamic";

export const POST = apiRoute(
  { body: setAvatarRequestSchema, mutating: true, logPrefix: "[api/account/avatar]" },
  async (ctx, { body }) => ({ body: await setAvatar(ctx, body) }),
);

export const DELETE = apiRoute(
  { mutating: true, logPrefix: "[api/account/avatar]" },
  async (ctx) => ({ body: await clearAvatar(ctx) }),
);
