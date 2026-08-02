"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

import { optionalEnv } from "@/env";

let client: SupabaseClient | null | undefined;

/**
 * Browser Supabase client for customer auth (phone OTP). Session is stored in
 * cookies by @supabase/ssr so server components and middleware can read it.
 *
 * Returns null when Supabase is not configured — callers render a friendly
 * "not configured" state instead of crashing (scaffold convention).
 */
export function getSupabaseBrowserClient(): SupabaseClient | null {
  if (client !== undefined) return client;

  const url = optionalEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = optionalEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  client = url && anonKey ? createBrowserClient(url, anonKey) : null;
  return client;
}
