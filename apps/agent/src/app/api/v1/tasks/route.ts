import { apiRoute } from "@/api/route";
import { readTasks } from "@/api/handlers/tasks";

export const dynamic = "force-dynamic";

export const GET = apiRoute({ logPrefix: "[api/tasks]" }, async (ctx) => ({
  body: await readTasks(ctx),
}));
