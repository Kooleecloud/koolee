import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentSession, CoreConfig } from "@koolee/core";

import { tryGetCore } from "@/lib/core";
import {
  resolveAgentIdentity,
  type AgentIdentity,
  type IdentityResult,
} from "@/lib/session";
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
  const identity = identityOrThrow(await resolveAgentIdentity(request));

  const core = tryGetCore();
  if (!core) throw new ApiHttpError("unavailable", UNAVAILABLE_COPY);

  const token = readBearerToken(request);
  const supabase = token
    ? getSupabaseBearerClient(token)
    : await getSupabaseServerClient();
  if (!supabase) throw new ApiHttpError("unavailable", UNAVAILABLE_COPY);

  return { core, session: identity.session, identity, supabase, now: core.clock.now() };
}

const UNAVAILABLE_COPY = "The server isn't ready. Try again shortly.";

/**
 * The identity answer as HTTP. Only a real "no" becomes 401/403 — the native
 * app signs the driver out on those — while a check that could not run is a
 * 503 the app retries through, still signed in. See `IdentityResult`.
 */
function identityOrThrow(result: IdentityResult): AgentIdentity {
  switch (result.status) {
    case "ok":
      return result.identity;
    case "signed_out":
      throw new ApiHttpError("not_authorized", "Please sign in again.");
    case "forbidden":
      throw new ApiHttpError(
        "forbidden",
        "That account doesn't have agent access. Ask an admin to invite you.",
      );
    default:
      console.error("[api] identity check failed", result.cause);
      throw new ApiHttpError(
        "unavailable",
        "Koolee can't check your sign-in right now. Try again in a moment.",
      );
  }
}

/**
 * The cookie twin of `resolveApiContext`, for the web app's server actions.
 *
 * A server action has no `Request` to read a bearer token from — the browser
 * session lives in the `sb-koolee-agent-auth` cookie — so the identity comes
 * from the cookie path of `getAgentIdentity` and `supabase` is the
 * cookie-bound client. Everything downstream is identical: the same
 * `ApiContext`, the same handlers, the same `ApiHttpError` refusals when the
 * session is gone or the server is not configured. This is what lets a driver
 * step have ONE implementation whichever client took it (phase 8).
 */
export async function resolveActionContext(): Promise<ApiContext> {
  const identity = identityOrThrow(await resolveAgentIdentity());

  const core = tryGetCore();
  if (!core) throw new ApiHttpError("unavailable", UNAVAILABLE_COPY);

  const supabase = await getSupabaseServerClient();
  if (!supabase) throw new ApiHttpError("unavailable", UNAVAILABLE_COPY);

  return { core, session: identity.session, identity, supabase, now: core.clock.now() };
}
