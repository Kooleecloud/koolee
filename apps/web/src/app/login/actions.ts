"use server";

import { redirect } from "next/navigation";
import { upsertCustomerFromAuth } from "@koolee/core";

import { tryGetCore } from "@/lib/core";
import { sanitizeReturnTo } from "@/lib/return-to";
import { getSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Called client-side right after `verifyOtp` succeeds. Reads the fresh
 * session server-side, upserts the customer row keyed by the auth user id
 * (the core auth seam), and sends the customer on their way.
 */
export async function completeSignIn(returnTo?: string): Promise<void> {
  const supabase = await getSupabaseServerClient();
  if (supabase) {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      // Supabase reports phone without the leading "+"; users.phone is E.164.
      const phone = user.phone
        ? user.phone.startsWith("+")
          ? user.phone
          : `+${user.phone}`
        : null;

      const core = tryGetCore();
      if (core && phone) {
        try {
          await upsertCustomerFromAuth(core.db, { authUserId: user.id, phone });
        } catch (error) {
          // Sign-in must not fail on a profile-write hiccup — the booking
          // flow upserts again via ensureCustomerWithAddress.
          console.error("[login] customer upsert failed", error);
        }
      }
    }
  }

  redirect(sanitizeReturnTo(returnTo) ?? "/book/flight");
}
