"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

import { optionalEnv } from "@/env";

/**
 * Browser Supabase client for the agent app.
 *
 * Added for ONE reason: Realtime. Every other client-side need in this app is
 * served by a server action, and staff sign-in is server-side. This exists so
 * the task list and the task detail can subscribe to `booking_signals` (0030)
 * and refresh at the door without the driver pulling to reload.
 *
 * ANON KEY ONLY, as the signed-in agent. This app holds no service-role key by
 * design — a shared, frequently-lost device — and a realtime subscription is
 * exactly the wrong place to make an exception: what an agent may watch is
 * decided by 0030's RLS policy, evaluated against their own session.
 *
 * The cookie name must match the server client's (`sb-koolee-agent-auth`) or
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
          cookieOptions: { name: "sb-koolee-agent-auth" },
        })
      : null;
  return client;
}
