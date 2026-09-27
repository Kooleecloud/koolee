import { Platform } from "react-native";

/**
 * Development only: `localhost` / `127.0.0.1` → `10.0.2.2` on the Android
 * emulator, whose own loopback is the emulator rather than the Mac. The same
 * rewrite `env.ts` applies to the API and Supabase URLs, for the URLs that
 * arrive at runtime instead — the signed Storage URLs the API hands back are
 * signed against the SERVER's Supabase URL, which locally is `127.0.0.1`, so
 * on the emulator every avatar and photo silently fell back to initials. A
 * release build never sees a localhost URL, so this is a no-op there, and on
 * iOS the simulator shares the Mac's loopback.
 */
export function emulatorHost(url: string): string {
  if (!__DEV__ || Platform.OS !== "android") return url;
  return url.replace(/\/\/(localhost|127\.0\.0\.1)(?=[:/]|$)/, "//10.0.2.2");
}
