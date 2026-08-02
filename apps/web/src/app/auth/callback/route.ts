import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { ensureCustomerFromAuth, markEmailVerified } from "@koolee/core";

import { sanitizeReturnTo } from "@/lib/return-to";
import { tryGetCore } from "@/lib/core";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Completes email-based auth round-trips:
 *  - `?code=` — magic-link sign-in (PKCE `exchangeCodeForSession`);
 *  - `?token_hash=&type=` — email-change / email-OTP confirmation links.
 *
 * Either way the session cookie is set here, the customer row is touched, and
 * the user lands on `next`.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const next = sanitizeReturnTo(url.searchParams.get("next")) ?? "/trips";

  const redirectTo = (path: string) => NextResponse.redirect(new URL(path, url.origin));

  const supabase = await getSupabaseServerClient();
  if (!supabase) return redirectTo("/login");

  let emailJustVerified = false;

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      console.error("[auth/callback] code exchange failed", error.message);
      return redirectTo("/login?error=link");
    }
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (error) {
      console.error("[auth/callback] token verification failed", error.message);
      return redirectTo("/login?error=link");
    }
    emailJustVerified = type === "email_change" || type === "email" || type === "magiclink";
  } else {
    return redirectTo("/login");
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const core = tryGetCore();
  if (core && user) {
    try {
      await ensureCustomerFromAuth(core.db, {
        authUserId: user.id,
        isAnonymous: user.is_anonymous === true,
        phone: user.phone ? `+${user.phone.replace(/^\+/, "")}` : null,
        email: user.email ?? null,
      });
      if (emailJustVerified && user.email) {
        await markEmailVerified(core.db, { authUserId: user.id, email: user.email });
      }
    } catch (error) {
      console.error("[auth/callback] customer write failed", error);
    }
  }

  return redirectTo(next);
}
