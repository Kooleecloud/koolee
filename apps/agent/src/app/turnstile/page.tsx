import type { Metadata } from "next";

import { optionalEnv } from "@/env";

import { TurnstileBridge } from "./turnstile-bridge";

export const metadata: Metadata = { title: "Verification", robots: { index: false } };

/**
 * A page for the NATIVE DRIVER APP, not for people.
 *
 * Turnstile is a project-level Supabase setting: when CAPTCHA protection is on
 * (the hosted projects), `signInWithPassword` refuses without a token, and a
 * token can only be minted by the widget on a hostname the site key allows.
 * The app cannot render the widget itself, so it opens this page in a WebView
 * on the agent origin, the widget solves, and the token is posted back to the
 * app through `window.ReactNativeWebView.postMessage`. The app then forwards
 * it to GoTrue exactly as the web sign-in form does; nothing is verified here.
 *
 * With no site key configured (local, captcha off) the page reports that
 * immediately so the app skips the step.
 */
export default function TurnstilePage() {
  const siteKey = optionalEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY") ?? null;
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background p-4">
      <TurnstileBridge siteKey={siteKey} />
    </main>
  );
}
