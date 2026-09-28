import "server-only";

import { cache } from "react";
import {
  getStaffIdentity,
  NotAuthorizedError,
  requireStaffRole,
  type AgentSession,
} from "@koolee/core";

import {
  isAuthRetryableFetchError,
  type AuthError,
  type User,
} from "@supabase/supabase-js";

import { tryGetCore } from "@/lib/core";
import { getSupabaseBearerClient, readBearerToken } from "@/lib/supabase/bearer";
import { getSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Agent session: a Supabase email/password session PLUS an active
 * `staff_members` row with role `agent`.
 *
 * The role lookup runs on every request through `requireStaffRole` — the
 * `assertRole` seam in @koolee/core. That per-request check is the security
 * boundary (NOT signup availability: anonymous sign-ins must stay enabled
 * for the customer funnel, so anyone can hold *an* account — an account
 * without the role gets nothing here). It is also what makes deactivation
 * immediate: a deactivated agent's live session fails the next request.
 */

export interface AgentIdentity {
  session: AgentSession;
  /**
   * The agent's email — shown on the Account tab so a driver can tell which
   * account their custody events are being filed under. Typed nullable only
   * because Supabase's `User` allows it; staff accounts are created by
   * email invite.
   */
  email: string | null;
  /** Display name from `public.users`, null until an admin sets one. */
  fullName: string | null;
  /** Key in the PRIVATE `avatars` bucket, or null. Signed where it renders. */
  avatarStoragePath: string | null;
  /**
   * Cleared to drive — the shift bar and the pickup flow mount on this.
   *
   * A capability, not a role: the same person verifies at the door and drives
   * the van (see `staff_members`). Re-read per request with the role, so a
   * revoked grant takes effect on the next navigation.
   */
  canDrive: boolean;
}

/**
 * One identity load per request.
 *
 * The layout needs it to decide whether to mount the tab bar, and every page
 * needs it to gate itself — so without `cache()` each navigation paid for two
 * `auth.getUser()` round-trips and two role lookups. The role check is still
 * per-request, which is what makes deactivation immediate; it just is not
 * per-component.
 */
const loadCookieIdentity = cache(async (): Promise<IdentityResult> => {
  const supabase = await getSupabaseServerClient();
  if (!supabase) return unavailable(new Error("Supabase is not configured."));

  const { data, error } = await supabase.auth.getUser();
  return identityForUser(data.user, error);
});

/**
 * The bearer-token path: the native driver app sends its Supabase access
 * token in `Authorization: Bearer` and holds no cookie. Validated against
 * GoTrue on every call (a revoked token fails here, not at expiry), then the
 * same per-request role check as the cookie path. Not wrapped in `cache()`:
 * a route resolves its session exactly once.
 */
async function loadTokenIdentity(token: string): Promise<IdentityResult> {
  const supabase = getSupabaseBearerClient(token);
  if (!supabase) return unavailable(new Error("Supabase is not configured."));

  const { data, error } = await supabase.auth.getUser(token);
  return identityForUser(data.user, error);
}

/**
 * What asking "who is this?" produced.
 *
 * FOUR ANSWERS, NOT TWO, and the difference is the whole point. The native app
 * signs a driver OUT on a 401 or 403 — correctly, for a revoked token or a
 * deactivated account — so those answers must only ever mean what they say.
 * A GoTrue blip or a database timeout is neither: it is `unavailable`, the
 * routes answer 503, and the app keeps the driver signed in and retries. The
 * version of this that returned `null` for every failure signed drivers out
 * mid-shift whenever the auth server hiccuped, and with them went the pin
 * every customer was watching.
 */
export type IdentityResult =
  | { status: "ok"; identity: AgentIdentity }
  /** No session, or one GoTrue rejects (expired, revoked, user deleted). */
  | { status: "signed_out" }
  /** A real session, but not an active agent — deactivated, a customer, an admin. */
  | { status: "forbidden"; message: string }
  /** The check itself could not run. Says nothing about the person. */
  | { status: "unavailable"; cause: unknown };

function unavailable(cause: unknown): IdentityResult {
  return { status: "unavailable", cause };
}

/**
 * A GoTrue error that says "could not ask" rather than "asked, and no". The
 * retryable fetch error covers a dead network and the 502/503/504 family;
 * any other 5xx or a rate limit is an outage too. Everything else — 400 for a
 * missing session, 401/403 for a bad or revoked token — is a real answer.
 */
function isAuthOutage(error: AuthError): boolean {
  if (isAuthRetryableFetchError(error)) return true;
  const status = error.status ?? 0;
  return status === 0 || status === 429 || status >= 500;
}

/**
 * ONE role check for both transports. Whatever produced the Supabase user —
 * cookie or bearer — the security boundary is the `staff_members` read here,
 * which is what makes deactivation immediate on the native app too.
 */
async function identityForUser(
  user: User | null,
  error: AuthError | null,
): Promise<IdentityResult> {
  if (error && isAuthOutage(error)) return unavailable(error);
  if (!user) return { status: "signed_out" };

  const core = tryGetCore();
  if (!core) return unavailable(new Error("Database is not configured."));

  try {
    await requireStaffRole(core.db, user.id, ["agent"]);
  } catch (roleError) {
    // `requireStaffRole` refuses with NotAuthorizedError; anything else it
    // throws is the database failing to answer.
    if (roleError instanceof NotAuthorizedError) {
      return { status: "forbidden", message: roleError.message };
    }
    return unavailable(roleError);
  }

  // One more read on a request that already does two, and it is the read that
  // lets every agent surface show a name and a face instead of an email.
  const identity = await getStaffIdentity(core.db, user.id).catch(() => null);

  return {
    status: "ok",
    identity: {
      session: { kind: "agent", role: "agent", userId: user.id },
      email: user.email ?? identity?.email ?? null,
      fullName: identity?.fullName ?? null,
      avatarStoragePath: identity?.avatarStoragePath ?? null,
      canDrive: identity?.canDrive ?? false,
    },
  };
}

/**
 * Picks the transport and never throws. A request with a bearer header is the
 * native app and is answered from the token alone — its cookies (there are
 * none) are never consulted, so a stale browser session on the same host
 * cannot leak in.
 */
export async function resolveAgentIdentity(request?: Request): Promise<IdentityResult> {
  const token = request ? readBearerToken(request) : null;
  try {
    return token ? await loadTokenIdentity(token) : await loadCookieIdentity();
  } catch (error) {
    return unavailable(error);
  }
}

/** Session plus display identity, for the Account tab. Null unless signed in as an agent. */
export async function getAgentIdentity(request?: Request): Promise<AgentIdentity | null> {
  const result = await resolveAgentIdentity(request);
  return result.status === "ok" ? result.identity : null;
}

export async function getAgentSession(request?: Request): Promise<AgentSession | null> {
  const identity = await getAgentIdentity(request);
  return identity?.session ?? null;
}

/**
 * Throwing variant for server actions and route handlers. Route handlers pass
 * the request so a bearer token is honoured; server actions have no request
 * and always read the cookie.
 *
 * Signed out and not-an-agent throw `NotAuthorizedError` (a refusal with a
 * sentence); an outage rethrows its cause, so callers that map errors show
 * "check your connection" rather than telling a driver they are signed out.
 */
export async function requireAgentSession(request?: Request): Promise<AgentSession> {
  const result = await resolveAgentIdentity(request);
  switch (result.status) {
    case "ok":
      return result.identity.session;
    case "signed_out":
      throw new NotAuthorizedError("Not signed in.");
    case "forbidden":
      throw new NotAuthorizedError(result.message);
    default:
      throw result.cause instanceof Error
        ? result.cause
        : new Error("Could not check the agent session.");
  }
}
