import "server-only";

import { verifySupabaseCustomerSession, type CustomerSession } from "@koolee/core";

import { optionalEnv } from "@/env";
import type { AuthUser } from "@/lib/auth";
import { getSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Resolves the signed-in customer for the current request, going through the
 * core auth seam (`verifySupabaseCustomerSession`) so session semantics live
 * in one place.
 *
 * Returns null when signed out or when Supabase is not configured. An auth
 * service outage also resolves to null here — page-level UX degrades to
 * signed-out rather than a 500; mutation paths re-verify on their own.
 */
export async function getCustomerSession(): Promise<CustomerSession | null> {
  const supabase = await getSupabaseServerClient();
  if (!supabase) return null;

  const url = optionalEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = optionalEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  if (!url || !anonKey) return null;

  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;
  if (!accessToken) return null;

  try {
    return await verifySupabaseCustomerSession(accessToken, { url, anonKey });
  } catch {
    return null;
  }
}

/**
 * Builds the core `CustomerSession` from an already-verified `AuthUser`
 * (`getAuthUser` validates the token server-side). For pages that gate on
 * `getAuthUser` anyway, this avoids a second auth round trip before calling
 * a session-scoped core service such as `listBookingsForSession`.
 */
export function customerSessionFromAuthUser(user: AuthUser): CustomerSession {
  return {
    kind: "customer",
    role: "customer",
    userId: user.id,
    phone: user.phone ?? "",
    email: user.email,
  };
}
