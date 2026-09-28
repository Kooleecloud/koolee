/**
 * A device-minted uuid (RFC 4122 v4): idempotency keys, storage object names.
 *
 * NOT `crypto.randomUUID()`. Hermes has no Web Crypto, and the polyfill the
 * app loads first (`react-native-get-random-values`, imported by
 * `lib/supabase` before anything else runs) supplies `getRandomValues` and
 * nothing more. `randomUUID` was simply undefined on device, so every write
 * step failed before it sent a byte and the driver was told to check their
 * connection. Found on the simulator in phase 4; the unit test pins the
 * format and the version/variant bits.
 */
export function newId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  // Version 4 in the high nibble of byte 6, variant 10xx in byte 8.
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
