"use client";

import * as React from "react";
import { Turnstile } from "@marsidev/react-turnstile";

/** The message shape the driver app's WebView listens for. */
export type TurnstileBridgeMessage =
  | { source: "koolee-turnstile"; type: "token"; token: string }
  | { source: "koolee-turnstile"; type: "not_configured" }
  | { source: "koolee-turnstile"; type: "error" };

declare global {
  interface Window {
    ReactNativeWebView?: { postMessage(message: string): void };
  }
}

function post(message: TurnstileBridgeMessage): void {
  window.ReactNativeWebView?.postMessage(JSON.stringify(message));
}

export function TurnstileBridge({ siteKey }: { siteKey: string | null }) {
  React.useEffect(() => {
    if (!siteKey) post({ source: "koolee-turnstile", type: "not_configured" });
  }, [siteKey]);

  if (!siteKey) {
    return <p className="text-sm text-muted-foreground">No verification needed here.</p>;
  }

  return (
    <Turnstile
      siteKey={siteKey}
      options={{ appearance: "always", refreshExpired: "auto", theme: "light" }}
      onSuccess={(token) => post({ source: "koolee-turnstile", type: "token", token })}
      onError={() => post({ source: "koolee-turnstile", type: "error" })}
      onExpire={() => post({ source: "koolee-turnstile", type: "error" })}
    />
  );
}
