"use client";

import * as React from "react";
import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";

/**
 * Cloudflare Turnstile, invisible/managed mode.
 *
 * The app never verifies tokens: Supabase Auth calls siteverify itself with
 * the secret key that lives only in the Supabase dashboard. Our job is to
 * mint a token in the browser and forward it as `options.captchaToken`.
 *
 * Tokens are single-use and short-lived, so `getToken()` runs reset + execute
 * and resolves with a FRESH token per request — never cache one. On error or
 * timeout it resolves to null; the caller surfaces the captcha-failed copy.
 * With no site key configured the gate renders nothing and resolves null,
 * which the server actions treat as "not configured" (scaffold convention).
 */

export interface TurnstileGateHandle {
  /** Fresh single-use token, or null on error/timeout/unconfigured. */
  getToken(): Promise<string | null>;
}

const TOKEN_TIMEOUT_MS = 15_000;

export const TurnstileGate = React.forwardRef<TurnstileGateHandle>(
  function TurnstileGate(_props, ref) {
    const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    const instanceRef = React.useRef<TurnstileInstance | null>(null);
    const resolverRef = React.useRef<((token: string | null) => void) | null>(null);
    const requestIdRef = React.useRef(0);

    const settle = React.useCallback((token: string | null) => {
      const resolve = resolverRef.current;
      resolverRef.current = null;
      resolve?.(token);
    }, []);

    React.useImperativeHandle(
      ref,
      () => ({
        getToken() {
          const instance = instanceRef.current;
          if (!siteKey || !instance) return Promise.resolve(null);

          const requestId = ++requestIdRef.current;
          return new Promise<string | null>((resolve) => {
            // A stale in-flight request loses to the new one.
            settle(null);
            resolverRef.current = resolve;

            try {
              instance.reset();
              instance.execute();
            } catch {
              settle(null);
              return;
            }

            setTimeout(() => {
              if (requestIdRef.current === requestId) settle(null);
            }, TOKEN_TIMEOUT_MS);
          });
        },
      }),
      [siteKey, settle],
    );

    if (!siteKey) return null;

    return (
      <Turnstile
        ref={instanceRef}
        siteKey={siteKey}
        options={{
          // Challenge runs only when getToken() calls execute(); the widget
          // surfaces UI only if Cloudflare demands interaction.
          execution: "execute",
          appearance: "interaction-only",
          responseField: false,
        }}
        onSuccess={settle}
        onError={() => settle(null)}
      />
    );
  },
);

/**
 * Form-embedded variant for plain server-action forms (the funnel's first
 * mutation, where `signInAnonymously` needs a token). Runs the challenge on
 * mount — invisibly, never blocking paint — keeps the token refreshed, and
 * writes it to a hidden input the action reads from FormData.
 */
export function TurnstileFormField({ name = "turnstileToken" }: { name?: string }) {
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
