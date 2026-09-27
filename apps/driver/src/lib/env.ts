import { Platform } from "react-native";

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

export function isConfigured(): boolean {
  return env.supabaseUrl.length > 0 && env.supabaseAnonKey.length > 0;
}

function trimSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

/**
 * Development only. The Android emulator's own loopback is the emulator, not
 * the Mac; `10.0.2.2` is its alias for the host. `adb reverse` can map the
 * ports instead, but every adb reconnect silently drops those mappings and
 * the app then fails with "connection refused" that looks like a wrong
 * password. Rewriting here is the version that cannot be forgotten. A
 * release build never carries a localhost URL, so this is a no-op there.
 *
 * Exported for the signed Storage URLs the API hands back: the server signs
 * them against ITS Supabase URL, which locally is `127.0.0.1`, so on the
 * emulator every photo silently fell back to initials.
 */
export function emulatorHost(url: string): string {
  if (!__DEV__ || Platform.OS !== "android") return url;
  return url.replace(/\/\/(localhost|127\.0\.0\.1)(?=[:/]|$)/, "//10.0.2.2");
}
