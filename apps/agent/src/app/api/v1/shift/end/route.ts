import { apiRoute } from "@/api/route";
import { endDriverShift } from "@/api/handlers/shift";

export const dynamic = "force-dynamic";

export const POST = apiRoute(
  { mutating: true, logPrefix: "[api/shift/end]" },
  async (ctx) => ({
    body: await endDriverShift(ctx),
  }),
);
