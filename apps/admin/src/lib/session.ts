import "server-only";

import { cache } from "react";
import {
  getStaffIdentity,
  NotAuthorizedError,
  requireStaffRole,
  type AdminSession,
} from "@koolee/core";

import { tryGetCore } from "@/lib/core";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export interface AdminIdentity {
  session: AdminSession;
  /**
   * The operator's email. Always set for staff accounts (they are created by
   * email invite), but typed nullable because Supabase's `User` allows it.
   * The console chrome shows it so an operator can tell which account they
   * are acting as — every override is written under this user's id.
   */
  email: string | null;
  /** Display name from `public.users`, null until somebody sets one. */
  fullName: string | null;
  /** Key in the PRIVATE `avatars` bucket, or null. Signed where it renders. */
  avatarStoragePath: string | null;
}

/**
 * One identity load per request.
 *
 * `cache()` matters here rather than being a micro-optimisation: the root
 * layout needs the identity to render the chrome and every page needs it to
 * gate itself, so without deduping each navigation paid for two
 * `auth.getUser()` round-trips and two `staff_members` role lookups. The role
 * check is still per-request — which is what makes deactivation take effect
 * immediately — it just is not per-component.
 */
const loadAdminIdentity = cache(async (): Promise<AdminIdentity> => {
  const supabase = await getSupabaseServerClient();
  if (!supabase) throw new NotAuthorizedError("Supabase is not configured.");

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new NotAuthorizedError("Not signed in.");

  const core = tryGetCore();
  if (!core) throw new NotAuthorizedError("Database is not configured.");

  await requireStaffRole(core.db, user.id, ["admin"]);

  // Cheap on a request that already does two round-trips, and it is what lets
  // the chrome show a person instead of an email local-part.
  const identity = await getStaffIdentity(core.db, user.id).catch(() => null);

  return {
    session: { kind: "admin", role: "admin", userId: user.id },
    email: user.email ?? identity?.email ?? null,
    fullName: identity?.fullName ?? null,
    avatarStoragePath: identity?.avatarStoragePath ?? null,
  };
});

/** Session plus display identity, for the console chrome. Null when signed out. */
export async function getAdminIdentity(): Promise<AdminIdentity | null> {
  try {
    return await loadAdminIdentity();
  } catch {
    return null;
  }
}

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
  const identity = await getAdminIdentity();
  return identity?.session ?? null;
}

/** Throwing variant for server actions and route handlers. */
export async function requireAdminSession(): Promise<AdminSession> {
  const { session } = await loadAdminIdentity();
  return session;
}
