import { apiRoute } from "@/api/route";
import { readShift } from "@/api/handlers/shift";

export const dynamic = "force-dynamic";

export const GET = apiRoute({ logPrefix: "[api/shift]" }, async (ctx) => ({
  body: await readShift(ctx),
}));
