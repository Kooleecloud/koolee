import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentSession, CoreConfig } from "@koolee/core";

import { tryGetCore } from "@/lib/core";
import { getAgentIdentity, type AgentIdentity } from "@/lib/session";
import { getSupabaseBearerClient, readBearerToken } from "@/lib/supabase/bearer";
import { getSupabaseServerClient } from "@/lib/supabase/server";

import { ApiHttpError } from "./errors";

/**
 * Everything a `/api/v1` handler needs, resolved once per request.
 *
 * `supabase` is bound to the CALLER — bearer token or cookie — and is used
 * for exactly one thing: proving an uploaded object exists under the path
 * the app claims, and minting short-lived signed URLs. Table reads and
 * writes never touch it; they go through `core` on the pooled connection,
 * as everywhere else in this app.
 */
export interface ApiContext {
  core: CoreConfig;
  session: AgentSession;
  identity: AgentIdentity;
  supabase: SupabaseClient;
  now: Date;
}

export async function resolveApiContext(request: Request): Promise<ApiContext> {
  const identity = await getAgentIdentity(request);
  if (!identity) throw new ApiHttpError("not_authorized", "Please sign in again.");

  const core = tryGetCore();
  if (!core)
    throw new ApiHttpError("unavailable", "The server isn't ready. Try again shortly.");

  const token = readBearerToken(request);
  const supabase = token
    ? getSupabaseBearerClient(token)
    : await getSupabaseServerClient();
  if (!supabase) {
    throw new ApiHttpError("unavailable", "The server isn't ready. Try again shortly.");
  }

  return { core, session: identity.session, identity, supabase, now: core.clock.now() };
}
