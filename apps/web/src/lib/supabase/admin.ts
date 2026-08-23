import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { optionalEnv } from "@/env";

/**
 * Service-role Supabase client. BYPASSES RLS and can delete auth users.
 *
 * Server-only module, imported by exactly two paths:
 *  - the anonymous-user cleanup job (`/api/jobs/cleanup-anon` + the Inngest
 *    cron), and
 *  - the phone-conflict re-parenting flow in `actions/auth.ts`.
 *
 * Anything else should use the anon-key server client. Returns null when the
 * service key is not configured (scaffold convention: degrade, don't throw).
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

/** Deletes a Supabase auth user. No-op (logged) when unconfigured. */
export async function deleteAuthUser(userId: string): Promise<void> {
  const admin = getSupabaseAdminClient();
  if (!admin) {
    console.warn(
      `[supabase-admin] SUPABASE_SERVICE_ROLE_KEY not configured — auth user ${userId} not deleted.`,
    );
    return;
  }
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) throw new Error(`auth.admin.deleteUser(${userId}): ${error.message}`);
}
