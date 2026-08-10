import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";

import { getSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Completes staff email round-trips — the invite-acceptance and
 * password-recovery links land here:
 *  - `?code=` — PKCE `exchangeCodeForSession`;
 *  - `?token_hash=&type=` — invite / recovery verification links.
 *
 * Either way the session cookie is set and the user lands on `next`
 * (default: /set-password, since both flows end with choosing a password).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const next = sanitizeNext(url.searchParams.get("next")) ?? "/set-password";

  const redirectTo = (path: string) => NextResponse.redirect(new URL(path, url.origin));

  const supabase = await getSupabaseServerClient();
  if (!supabase) return redirectTo("/login");

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
  } else {
    return redirectTo("/login");
  }

  return redirectTo(next);
}

/** Same-origin relative paths only — never an absolute URL from a query. */
function sanitizeNext(value: string | null): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return null;
  return value;
}
