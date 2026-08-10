import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { optionalEnv } from "@/env";

/**
 * Service-role Supabase client — ONLY the admin app holds this key (the
 * agent app is deliberately least-privilege and has none). Used for exactly
 * one thing here: sending staff invites via `auth.admin.inviteUserByEmail`.
 *
 * Returns null when the service key is not configured (scaffold convention:
 * degrade, don't throw).
 */

let client: SupabaseClient | null | undefined;

export function getSupabaseAdminClient(): SupabaseClient | null {
  if (client !== undefined) return client;

  const url = optionalEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceKey = optionalEnv("SUPABASE_SERVICE_ROLE_KEY");
  client =
    url && serviceKey
      ? createClient(url, serviceKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        })
      : null;
  return client;
}
