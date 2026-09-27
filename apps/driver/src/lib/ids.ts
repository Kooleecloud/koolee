/** A device-minted uuid: idempotency keys, storage object names. */
export function newId(): string {
  // react-native-get-random-values is imported by lib/supabase before any
  // caller here runs; crypto.randomUUID exists on Hermes with that polyfill.
  return crypto.randomUUID();
}
