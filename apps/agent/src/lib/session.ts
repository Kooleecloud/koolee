import "server-only";

import { cache } from "react";
import { NotAuthorizedError, requireStaffRole, type AgentSession } from "@koolee/core";

import { tryGetCore } from "@/lib/core";
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
  if (!user) throw new NotAuthorizedError("Not signed in.");

  const core = tryGetCore();
  if (!core) throw new NotAuthorizedError("Database is not configured.");

  await requireStaffRole(core.db, user.id, ["agent"]);
  return {
    session: { kind: "agent", role: "agent", userId: user.id },
    email: user.email ?? null,
  };
});

/** Session plus display identity, for the Account tab. Null when signed out. */
export async function getAgentIdentity(): Promise<AgentIdentity | null> {
  try {
    return await loadAgentIdentity();
  } catch {
    return null;
  }
}

export async function getAgentSession(): Promise<AgentSession | null> {
  const identity = await getAgentIdentity();
  return identity?.session ?? null;
}

/** Throwing variant for server actions and route handlers. */
export async function requireAgentSession(): Promise<AgentSession> {
  const { session } = await loadAgentIdentity();
  return session;
}
