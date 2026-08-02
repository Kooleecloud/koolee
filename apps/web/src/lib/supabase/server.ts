import "server-only";

import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

import { optionalEnv } from "@/env";

/**
 * Server-side Supabase client bound to the request's cookies. Used by server
 * actions and server components to read the customer's phone-OTP session.
 *
 * Returns null when Supabase is not configured (scaffold convention: the app
 * boots with zero credentials).
 */
export async function getSupabaseServerClient(): Promise<SupabaseClient | null> {
  const url = optionalEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = optionalEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  if (!url || !anonKey) return null;

  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Server Components cannot write cookies; the middleware owns
          // session refresh, so swallowing here is safe.
        }
      },
    },
  });
}
