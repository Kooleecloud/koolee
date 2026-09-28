import { emulatorHost } from "./emulator-host";

/**
 * Build-time configuration. `EXPO_PUBLIC_*` values are inlined into the
 * bundle by Metro and must be referenced as `process.env.EXPO_PUBLIC_X`
 * literally — never through a computed key. They are visible in the shipped
 * app by design, so only public values live here: the anon key, URLs, the
 * Turnstile site key. Secrets never reach the phone.
 *
 * Which environment a build talks to is decided by the EAS build profile
 * (`eas.json` → `environment`), not by anything in the app — there is no
 * in-app switch (decision 13).
 */
export const env = {
  /** Origin of the agent app that serves `/api/v1` (no trailing slash). */
  apiUrl: trimSlash(
    emulatorHost(process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3001"),
  ),
  supabaseUrl: emulatorHost(process.env.EXPO_PUBLIC_SUPABASE_URL ?? ""),
  supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "",
  sentryDsn: process.env.EXPO_PUBLIC_SENTRY_DSN ?? "",
  /**
   * Present only on a hosted project with CAPTCHA protection on. Locally the
   * project has captcha off and this stays empty, so sign-in skips the widget.
   */
  turnstileSiteKey: process.env.EXPO_PUBLIC_TURNSTILE_SITE_KEY ?? "",
  /** "development" | "preview" | "production", from the EAS profile. */
  channel: process.env.EXPO_PUBLIC_CHANNEL ?? "development",
} as const;

/**
 * Which backend this build talks to, for people who are not supposed to have
 * to ask — "preview · dev.agent.koolee.cloud". Null in production,
 * where drivers have no use for it. Shown under the sign-in form and at the
 * foot of Account, so a tester's screenshot says which build it came from.
 */
export function backendLabel(): string | null {
  if (env.channel === "production") return null;
  return `${env.channel} · ${env.apiUrl.replace(/^https?:\/\//, "")}`;
}

export function isConfigured(): boolean {
  return env.supabaseUrl.length > 0 && env.supabaseAnonKey.length > 0;
}

function trimSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}
