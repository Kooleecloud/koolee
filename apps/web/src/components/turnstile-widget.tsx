"use client";

import * as React from "react";

/**
 * Cloudflare Turnstile, invisible mode.
 *
 * Renders nothing visible with an invisible-mode site key; the token lands in
 * `onToken` and the server action verifies it against siteverify. When no site
 * key is configured the widget is skipped and `onToken(null)` fires once — the
 * server side then decides whether to enforce (it warns and passes open only
 * when its secret is also unconfigured).
 */

declare global {
  interface Window {
    turnstile?: {
      render: (
        el: HTMLElement,
        opts: {
          sitekey: string;
          callback: (token: string) => void;
          "error-callback"?: () => void;
          "expired-callback"?: () => void;
        },
      ) => string;
      reset: (id?: string) => void;
      remove: (id?: string) => void;
    };
    __koolee_turnstile_loading?: Promise<void>;
  }
}

const SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (!window.__koolee_turnstile_loading) {
    window.__koolee_turnstile_loading = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = SCRIPT_SRC;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Turnstile script failed to load"));
      document.head.appendChild(script);
    });
  }
  return window.__koolee_turnstile_loading;
}

export function TurnstileWidget({
  onToken,
}: {
  /** Called with a fresh token, or null when the widget is unavailable. */
  onToken: (token: string | null) => void;
}) {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const containerRef = React.useRef<HTMLDivElement>(null);
  const onTokenRef = React.useRef(onToken);

  React.useEffect(() => {
    onTokenRef.current = onToken;
  }, [onToken]);

  React.useEffect(() => {
    if (!siteKey) {
      onTokenRef.current(null);
      return;
    }

    let widgetId: string | undefined;
    let cancelled = false;

    void loadScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.turnstile) return;
        widgetId = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          callback: (token) => onTokenRef.current(token),
          "error-callback": () => onTokenRef.current(null),
          "expired-callback": () => {
            if (widgetId !== undefined) window.turnstile?.reset(widgetId);
          },
        });
      })
      .catch(() => onTokenRef.current(null));

    return () => {
      cancelled = true;
      if (widgetId !== undefined) window.turnstile?.remove(widgetId);
    };
  }, [siteKey]);

  if (!siteKey) return null;
  return <div ref={containerRef} aria-hidden="true" />;
}
