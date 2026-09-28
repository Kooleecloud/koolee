import { apiRoute } from "@/api/route";
import { sendTestPush } from "@/api/handlers/push";

export const dynamic = "force-dynamic";

export const POST = apiRoute({ logPrefix: "[api/push/test]" }, async (ctx) => ({
  body: await sendTestPush(ctx),
}));
