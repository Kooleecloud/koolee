import "server-only";

import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

import { optionalEnv } from "@/env";

/**
 * Server-side Supabase client bound to the request's cookies — the agent
 * app's staff email/password session lives here. Same shape as apps/web.
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
    // Per-app cookie name: all three apps share one Supabase project, and
    // browsers scope cookies by hostname only — with the default
    // sb-<ref>-auth-token name, the localhost dev servers overwrite each
    // other's sessions. See apps/web/src/lib/supabase/cookie-name.ts.
    cookieOptions: { name: "sb-koolee-agent-auth" },
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
          // Server Components cannot write cookies; auth mutations happen in
          // server actions and the callback route, which can.
        }
      },
    },
  });
}
