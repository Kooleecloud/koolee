import { apiRoute } from "@/api/route";
import { readTrucks } from "@/api/handlers/shift";

export const dynamic = "force-dynamic";

export const GET = apiRoute({ logPrefix: "[api/trucks]" }, async (ctx) => ({
  body: await readTrucks(ctx),
}));
