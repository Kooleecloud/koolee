import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

import { AUTH_COOKIE_NAME } from "@/lib/supabase/cookie-name";

/**
 * Session refresh + auth gate.
 *
 * Protected (verified accounts only — an anonymous funnel session does not
 * count): /trips/* and /dashboard/*. The review & pay page (/book/pay) is
 * deliberately NOT bounced here: anonymous visitors must see the review and
 * price before the flow asks them to verify. The payment itself stays hard-
 * gated in the server actions (`confirmBooking`, `preparePayment`) and the
 * page renders a verify CTA instead of the payment UI for anonymous sessions.
 *
 * When Supabase is not configured the gate is open (scaffold convention: the
 * app must be fully navigable with zero credentials).
 */

const VERIFIED_ONLY = [/^\/trips(\/|$)/, /^\/dashboard(\/|$)/];

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return response;

  const supabase = createServerClient(url, anonKey, {
    cookieOptions: { name: AUTH_COOKIE_NAME },
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  // Also refreshes an expired session cookie — the reason /login and /book/*
  // are in the matcher even though they are not gated.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname, search } = request.nextUrl;
  const verified = Boolean(user) && user?.is_anonymous !== true;

  if (!verified && VERIFIED_ONLY.some((pattern) => pattern.test(pathname))) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    loginUrl.searchParams.set("returnTo", `${pathname}${search}`);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: ["/trips/:path*", "/dashboard/:path*", "/book/:path*", "/login"],
};
