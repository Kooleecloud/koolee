/**
 * Phone number formatting. PURE, and deliberately not in a `"use client"`
 * module.
 *
 * WHY IT LIVES HERE. These four functions used to sit in `phone-input.tsx`,
 * which is a client component — so importing `formatE164ForDisplay` into a
 * SERVER component threw at render time:
 *
 *   Attempted to call formatE164ForDisplay() from the server but
 *   formatE164ForDisplay is on the client.
 *
 * Nothing caught it for a long time, because the one server-side call site
 * (the agent app's job card) only reached the function when a booking had a
 * `contact_phone` — which is set only for email-only customers, so in practice
 * never. The moment `doorContact` started resolving a number for nearly every
 * booking, every job card in the app began throwing. `tsc` cannot see the
 * client/server boundary, and `next build` did not either: these pages are
 * `force-dynamic`, so they are rendered on request, not at build time. It took
 * running the app.
 *
 * A string formatter has no reason to be client-only. `PhoneInput` imports
 * these; the package barrel exports them FROM HERE, so the boundary cannot be
 * re-crossed by accident.
 */

/** Strips formatting; tolerates a leading US country code. Max 10 digits. */
export function normalizeUsPhone(raw: string): string {
  let digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  return digits.slice(0, 10);
}

export function formatUsPhone(digits: string): string {
  if (digits.length === 0) return "";
  if (digits.length <= 3) return `(${digits}`;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

/**
 * A stored E.164 number, rendered the way a person reads it aloud.
 *
 * The inverse of `toE164`, and the counterpart to `formatUsPhone` for values
 * that come back OUT of the database rather than in from a field.
 *
 * Anything that is not an unambiguous US number is returned untouched. That
 * matters more than it looks: without the `+` guard, a truncated
 * "+1212555010" formats as "(121) 255-5010", a plausible number that is not
 * the customer's — on screens whose whole purpose is that somebody dials it.
 */
export function formatE164ForDisplay(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (value.startsWith("+1") && digits.length === 11) return formatUsPhone(digits.slice(1));
  if (!value.startsWith("+") && digits.length === 10) return formatUsPhone(digits);
  return value;
}

/** E.164 for a complete US number, else null. */
export function toE164(digits: string): string | null {
  return digits.length === 10 ? `+1${digits}` : null;
}
