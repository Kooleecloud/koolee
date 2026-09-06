"use client";

import { Turnstile } from "@marsidev/react-turnstile";

/**
 * Cloudflare Turnstile for the staff sign-in and password-reset forms.
 *
 * This exists because CAPTCHA protection is a SUPABASE PROJECT setting, not a
 * per-app one. Turning it on for the customer funnel turned it on for GoTrue's
 * `/token?grant_type=password` and `/recover` endpoints too — which is every
 * auth call this app makes — and those started failing with
 * "captcha protection: request disallowed (no captcha_token found)".
 *
 * The app never verifies anything: it mints a token in the browser and the
 * server action forwards it as `options.captchaToken`. Supabase calls
 * siteverify with the secret key that lives only in its dashboard, so no
 * Turnstile SECRET belongs in this app's env — only the site key.
 *
 * The site key must be the SAME one the web app uses for this environment.
 * The secret is a single per-Supabase-project value, so a different widget's
 * token would fail siteverify against it.
 *
 * `responseField` writes the token into a hidden input named `turnstileToken`,
 * which the server action reads off FormData. With no site key configured
 * (fresh clone, or a project with CAPTCHA off) this renders nothing and the
 * action treats the missing token as "not configured" rather than a failure.
 */
export function TurnstileField({ name = "turnstileToken" }: { name?: string }) {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  if (!siteKey) return null;

  return (
    <Turnstile
      siteKey={siteKey}
      options={{
        appearance: "interaction-only",
        refreshExpired: "auto",
        responseField: true,
        responseFieldName: name,
      }}
    />
  );
}
