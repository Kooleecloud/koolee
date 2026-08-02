import { parsePhoneNumberFromString } from "libphonenumber-js";

/**
 * Phone validation for auth flows. US/CA only in v1 — both live under +1, so
 * the UI shows a fixed +1 prefix and this module enforces the country on the
 * server before any OTP is sent.
 */

const ALLOWED_COUNTRIES = new Set(["US", "CA"]);

/** Validates and formats to E.164, or null when not a valid US/CA number. */
export function toE164UsCa(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const parsed = parsePhoneNumberFromString(trimmed, "US");
  if (!parsed || !parsed.isValid()) return null;
  if (!parsed.country || !ALLOWED_COUNTRIES.has(parsed.country)) return null;
  return parsed.number;
}

/** "+13322602829" → "•••-••2829" for the price-screen footer. */
export function maskPhone(e164: string): string {
  const last4 = e164.replace(/\D/g, "").slice(-4);
  return `•••-••${last4}`;
}

/** Supabase reports phone without the leading "+"; normalize to E.164. */
export function normalizeSupabasePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  return phone.startsWith("+") ? phone : `+${phone}`;
}
