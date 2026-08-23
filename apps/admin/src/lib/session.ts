import "server-only";

import {
  NotAuthorizedError,
  requireStaffRole,
  type AdminSession,
} from "@koolee/core";

import { tryGetCore } from "@/lib/core";
import { getSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Admin session: a Supabase email/password session PLUS an active
 * `staff_members` row with role `admin`.
 *
 * The role lookup runs on every request through `requireStaffRole` — the
 * `assertRole` seam in @koolee/core. That per-request check is the security
 * boundary (NOT signup availability: anonymous sign-ins must stay enabled
 * for the customer funnel, so anyone can hold *an* account — an account
 * without the role gets nothing here). It is also what makes deactivation
 * immediate: a deactivated admin's live session fails the next request.
 * Admins can force state transitions and issue refunds; every such write
 * carries this session's real user id as the custody-event actor.
 */
export async function getAdminSession(): Promise<AdminSession | null> {
  try {
    return await requireAdminSession();
  } catch {
    return null;
  }
}

/** Throwing variant for server actions and route handlers. */
export async function requireAdminSession(): Promise<AdminSession> {
  const supabase = await getSupabaseServerClient();
  if (!supabase) throw new NotAuthorizedError("Supabase is not configured.");

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new NotAuthorizedError("Not signed in.");

  const core = tryGetCore();
  if (!core) throw new NotAuthorizedError("Database is not configured.");

  await requireStaffRole(core.db, user.id, ["admin"]);
  return { kind: "admin", role: "admin", userId: user.id };
}
