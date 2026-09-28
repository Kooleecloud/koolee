import { Platform } from "react-native";

/**
 * Development only: `localhost` / `127.0.0.1` → `10.0.2.2` on the Android
 * emulator, whose own loopback is the emulator rather than the Mac.
 *
 * `env.ts` passes the API and Supabase URLs through it, and the screens pass
 * the URLs that arrive at runtime: the signed Storage URLs the API hands back
 * are signed against the SERVER's Supabase URL, which locally is `127.0.0.1`,
 * so on the emulator every avatar and photo silently fell back to initials.
 * `adb reverse` could map the ports instead, but every adb reconnect silently
 * drops those mappings and the app then fails with a "connection refused"
 * that reads like a wrong password; a rewrite cannot be forgotten.
 *
 * A release build never sees a localhost URL (`app.config.ts` refuses to
 * build one), so this is a no-op there, and on iOS the simulator shares the
 * Mac's loopback.
 */
export function emulatorHost(url: string): string {
  if (!__DEV__ || Platform.OS !== "android") return url;
  return url.replace(/\/\/(localhost|127\.0\.0\.1)(?=[:/]|$)/, "//10.0.2.2");
}
