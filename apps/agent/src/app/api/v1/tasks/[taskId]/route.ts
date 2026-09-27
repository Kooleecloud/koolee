import type { TaskKind } from "@koolee/api-contract";

import { ApiHttpError } from "@/api/errors";
import { apiRoute } from "@/api/route";
import { readTaskDetail } from "@/api/handlers/tasks";

export const dynamic = "force-dynamic";

export const GET = apiRoute(
  { logPrefix: "[api/tasks/detail]" },
  async (ctx, { params, url }) => {
    const taskId = params.taskId;
    if (!taskId) throw new ApiHttpError("not_found", "That task doesn't exist.");
    // Same rule as the page: anything that is not "pickup" is a verification.
    const kind: TaskKind =
      url.searchParams.get("kind") === "pickup" ? "pickup" : "verification";
    return { body: await readTaskDetail(ctx, taskId, kind) };
  },
);
