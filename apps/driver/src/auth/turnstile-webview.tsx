import * as React from "react";
import { View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

import { env } from "@/lib/env";

/**
 * Solves Turnstile on the agent origin and hands the token back.
 *
 * Only mounted when the build carries a site key (hosted projects with
 * CAPTCHA protection on). The page it loads lives in apps/agent at
 * `/turnstile`; the widget there can be minted because that hostname is on
 * the site key's allow-list, which a WebView with a file:// origin never is.
 */
export function TurnstileWebView({
  onToken,
}: {
  onToken: (token: string | null) => void;
}) {
  const onMessage = React.useCallback(
    (event: WebViewMessageEvent) => {
      try {
        const message = JSON.parse(event.nativeEvent.data) as {
          source?: string;
          type?: string;
          token?: string;
        };
        if (message.source !== "koolee-turnstile") return;
        if (message.type === "token" && message.token) onToken(message.token);
        else if (message.type === "not_configured") onToken(null);
        else onToken(null);
      } catch {
        onToken(null);
      }
    },
    [onToken],
  );

  if (!env.turnstileSiteKey) return null;

  return (
    <View className="h-20 overflow-hidden rounded-md">
      <WebView
        source={{ uri: `${env.apiUrl}/turnstile` }}
        onMessage={onMessage}
        javaScriptEnabled
        originWhitelist={["*"]}
        style={{ backgroundColor: "transparent" }}
      />
    </View>
  );
}
