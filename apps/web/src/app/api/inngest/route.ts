import { serve } from "inngest/next";

import { functions, inngest } from "@/lib/inngest";

/**
 * Inngest endpoint. All three Koolee functions are served from apps/web.
 *
 * Local development:
 *   pnpm dev            # in one terminal
 *   pnpm dev:inngest    # in another — the dev server discovers this route
 *
 * The signing key (only needed against Inngest Cloud) is configured on the
 * client in `@/lib/inngest` — in v4 it is no longer a `serve()` option. The
 * local dev server runs without one, which keeps the zero-credentials boot
 * requirement intact.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions,
});
