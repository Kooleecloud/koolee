import { serve } from "inngest/next";

import { functions, inngest } from "@/lib/inngest";
import { optionalEnv } from "@/env";

/**
 * Inngest endpoint. All three Koolee functions are served from apps/web.
 *
 * Local development:
 *   pnpm dev            # in one terminal
 *   pnpm dev:inngest    # in another — the dev server discovers this route
 *
 * The signing key is only needed against Inngest Cloud; the local dev server
 * runs without one, which keeps the zero-credentials boot requirement intact.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const signingKey = optionalEnv("INNGEST_SIGNING_KEY");

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions,
  ...(signingKey ? { signingKey } : {}),
});
