import { apiRoute } from "@/api/route";
import { readMe } from "@/api/handlers/me";

export const dynamic = "force-dynamic";

export const GET = apiRoute({ logPrefix: "[api/me]" }, async (ctx) => ({
  body: await readMe(ctx),
}));
