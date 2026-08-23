import "server-only";

import {
  NotAuthorizedError,
  requireStaffRole,
  type AgentSession,
} from "@koolee/core";

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
export async function getAgentSession(): Promise<AgentSession | null> {
  try {
    return await requireAgentSession();
  } catch {
    return null;
  }
}

/** Throwing variant for server actions and route handlers. */
export async function requireAgentSession(): Promise<AgentSession> {
  const supabase = await getSupabaseServerClient();
  if (!supabase) throw new NotAuthorizedError("Supabase is not configured.");

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new NotAuthorizedError("Not signed in.");

  const core = tryGetCore();
  if (!core) throw new NotAuthorizedError("Database is not configured.");

  await requireStaffRole(core.db, user.id, ["agent"]);
  return { kind: "agent", role: "agent", userId: user.id };
}
