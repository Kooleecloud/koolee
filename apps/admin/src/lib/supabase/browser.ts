"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

import { optionalEnv } from "@/env";

/**
 * Browser Supabase client for the ops console.
 *
 * Added for ONE reason: Realtime. Every other client-side need in this app is
 * a server action, and admin sign-in is server-side. This exists so the live
 * driver map on `/shifts` can subscribe to `driver_positions` and
 * `driver_shifts` (0039) and move a pin the moment a phone reports, instead of
 * waiting for the next poll.
 *
 * ANON KEY ONLY, as the signed-in admin. The console does hold a service-role
 * key (`lib/supabase/admin.ts`), and it must never reach this file: what a
 * browser may watch is decided by 0039's `is_active_admin` policy, evaluated
 * against the operator's own session — which is what stops a driver's browser
 * from watching every other driver.
 *
 * The cookie name must match the server client's (`sb-koolee-admin-auth`) or
 * this client would read a session the app never wrote.
 */

let client: SupabaseClient | null | undefined;

export function getSupabaseBrowserClient(): SupabaseClient | null {
  if (client !== undefined) return client;

  const url = optionalEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = optionalEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  client =
    url && anonKey
      ? createBrowserClient(url, anonKey, {
          cookieOptions: { name: "sb-koolee-admin-auth" },
        })
      : null;
  return client;
}
