import "server-only";

import { cache } from "react";
import {
  getStaffIdentity,
  NotAuthorizedError,
  requireStaffRole,
  type AgentSession,
} from "@koolee/core";

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
const loadAgentIdentity = cache(async (): Promise<AgentIdentity> => {
  const supabase = await getSupabaseServerClient();
  if (!supabase) throw new NotAuthorizedError("Supabase is not configured.");

  const {
    data: { user },
  } = await supabase.auth.getUser();
  return identityForUser(user);
});

/**
 * The bearer-token path: the native driver app sends its Supabase access
 * token in `Authorization: Bearer` and holds no cookie. Validated against
 * GoTrue on every call (a revoked token fails here, not at expiry), then the
 * same per-request role check as the cookie path. Not wrapped in `cache()`:
 * a route resolves its session exactly once.
 */
async function loadAgentIdentityFromToken(token: string): Promise<AgentIdentity> {
  const supabase = getSupabaseBearerClient(token);
  if (!supabase) throw new NotAuthorizedError("Supabase is not configured.");

  const {
    data: { user },
  } = await supabase.auth.getUser(token);
  return identityForUser(user);
}

/**
 * ONE role check for both transports. Whatever produced the Supabase user —
 * cookie or bearer — the security boundary is the `staff_members` read here,
 * which is what makes deactivation immediate on the native app too.
 */
async function identityForUser(
  user: { id: string; email?: string | undefined } | null,
): Promise<AgentIdentity> {
  if (!user) throw new NotAuthorizedError("Not signed in.");

  const core = tryGetCore();
  if (!core) throw new NotAuthorizedError("Database is not configured.");

  await requireStaffRole(core.db, user.id, ["agent"]);

  // One more read on a request that already does two, and it is the read that
  // lets every agent surface show a name and a face instead of an email.
  const identity = await getStaffIdentity(core.db, user.id).catch(() => null);

  return {
    session: { kind: "agent", role: "agent", userId: user.id },
    email: user.email ?? identity?.email ?? null,
    fullName: identity?.fullName ?? null,
    avatarStoragePath: identity?.avatarStoragePath ?? null,
    canDrive: identity?.canDrive ?? false,
  };
}

/**
 * Picks the transport. A request with a bearer header is the native app and
 * is answered from the token alone — its cookies (there are none) are never
 * consulted, so a stale browser session on the same host cannot leak in.
 */
async function loadIdentity(request?: Request): Promise<AgentIdentity> {
  const token = request ? readBearerToken(request) : null;
  return token ? loadAgentIdentityFromToken(token) : loadAgentIdentity();
}

/** Session plus display identity, for the Account tab. Null when signed out. */
export async function getAgentIdentity(request?: Request): Promise<AgentIdentity | null> {
  try {
    return await loadIdentity(request);
  } catch {
    return null;
  }
}

export async function getAgentSession(request?: Request): Promise<AgentSession | null> {
  const identity = await getAgentIdentity(request);
  return identity?.session ?? null;
}

/**
 * Throwing variant for server actions and route handlers. Route handlers pass
 * the request so a bearer token is honoured; server actions have no request
 * and always read the cookie.
 */
export async function requireAgentSession(request?: Request): Promise<AgentSession> {
  const { session } = await loadIdentity(request);
  return session;
}
