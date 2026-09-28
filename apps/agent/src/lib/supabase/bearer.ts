import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { optionalEnv } from "@/env";

/**
 * Supabase for a request that carries `Authorization: Bearer <access token>`
 * — the native driver app, which has no cookies.
 *
 * ANON KEY, THE CALLER'S OWN JWT. This app deliberately holds no service-role
 * key (a shared, frequently-lost device class). Validating the token means
 * asking GoTrue `GET /auth/v1/user` with the anon `apikey` and the caller's
 * JWT — `auth.getUser(token)` — which also catches a revoked or expired
 * token, unlike a local JWKS check. Storage calls on this client run under
 * RLS as the caller, exactly as the cookie client's do, so the bucket
 * policies (`is_active_staff`) stay the gate for photo verification.
 *
 * NEVER `getSupabaseServerClient()` here: that one is bound to `next/headers`
 * cookies and `@supabase/ssr` forces cookie persistence on it.
 */

const BEARER = /^Bearer\s+(.+)$/i;

export function readBearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = BEARER.exec(header.trim());
  const token = match?.[1]?.trim();
  return token && token.length > 0 ? token : null;
}

export function getSupabaseBearerClient(token: string): SupabaseClient | null {
  const url = optionalEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = optionalEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  if (!url || !anonKey) return null;

  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}
