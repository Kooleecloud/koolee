import "server-only";

import { getSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Thin request-scoped view of the Supabase auth user, shared by the funnel,
 * proxy-adjacent pages and server actions. `null` means no session (or
 * Supabase unconfigured).
 */
export interface AuthUser {
  id: string;
  /** E.164 (normalized — Supabase reports it without the "+"). */
  phone: string | null;
  email: string | null;
  isAnonymous: boolean;
}

export async function getAuthUser(): Promise<AuthUser | null> {
  const supabase = await getSupabaseServerClient();
  if (!supabase) return null;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  return {
    id: user.id,
    phone: user.phone
      ? user.phone.startsWith("+")
        ? user.phone
        : `+${user.phone}`
      : null,
    email: user.email ?? null,
    isAnonymous: user.is_anonymous === true,
  };
}

/** A signed-in, non-anonymous user — the only kind allowed past the pay gate. */
export async function getVerifiedAuthUser(): Promise<AuthUser | null> {
  const user = await getAuthUser();
  return user && !user.isAnonymous ? user : null;
}
