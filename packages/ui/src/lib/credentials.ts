/**
 * The credential rules, in one place, for every app that has a login form.
 *
 * They were not in one place. The staff invite lowercased the address it
 * invited (`staff/actions.ts`, `services/staff.ts`); sign-in and password
 * reset only trimmed it. So an admin inviting `Alice@Koolee.cloud` created
 * `alice@koolee.cloud`, and everything downstream that compares our `users`
 * row to what was typed had to hope GoTrue normalized identically. Length
 * rules had the same shape of problem: `minLength={8}` in the form and
 * `.min(8)` in the action, written twice, free to drift.
 *
 * Lives in `packages/ui/src/lib` behind the `@koolee/ui/lib/credentials`
 * subpath, NOT in `packages/core`, and not in the component barrel. The
 * length rule is read by a client component (the form's `minLength`) and by a
 * server action (the zod schema) — one of the two would have had to reach
 * across a package boundary it does not have, and pulling `@koolee/core` into
 * a client bundle drags `@koolee/db` and drizzle with it. Pure, dependency-
 * free, importable from either side; same reasoning as `lib/photo`.
 */

/**
 * Minimum password length. ONE constant: the form's `minLength` and the
 * server schema both read it, so the browser and the server can never
 * disagree about what is acceptable.
 *
 * Supabase's own project minimum is configured in the dashboard; this is the
 * floor the product enforces on top of it, and it must not be lower.
 */
export const PASSWORD_MIN_LENGTH = 8;

/** Upper bound. bcrypt truncates past 72 bytes; this is a sanity limit. */
export const PASSWORD_MAX_LENGTH = 128;

/** The hint under the field. */
export const PASSWORD_RULE_COPY = `At least ${PASSWORD_MIN_LENGTH} characters.`;

/** The error when a set-password submit fails the rule. Same number, one source. */
export const PASSWORD_TOO_SHORT_COPY = `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;

/**
 * The message a failed sign-in returns, whatever actually failed.
 *
 * ONE string for "no such account" and "wrong password", because any
 * difference between the two — different wording, a different status, a
 * measurably different response time — is an account-enumeration oracle. The
 * password-reset form has the same property by always reporting success.
 */
export const SIGN_IN_FAILED_COPY = "Email or password didn't match.";

/**
 * The message when the bot check, not the credentials, is what failed.
 *
 * Shared for the same reason the two above are: it was written out twice, in
 * both staff apps, and the two copies were free to drift.
 */
export const CAPTCHA_FAILED_COPY =
  "We couldn't confirm you're human. Refresh the page and try again.";

/**
 * Was this GoTrue error the CAPTCHA rather than the credentials?
 *
 * THIS EXISTS BECAUSE THE ANSWER WAS ONCE "who cares" (2026-08-30). A
 * deployed staff app reached GoTrue with no Turnstile token —
 * `NEXT_PUBLIC_TURNSTILE_SITE_KEY` was absent on the server, so the app's own
 * pre-flight guard was inert — and every attempt came back
 * `400 captcha protection: request disallowed (no captcha_token found)`.
 * The sign-in action reported "Email or password didn't match" over a
 * password that was provably correct, and the only way to find out was to
 * read the Supabase project's auth logs. Hours.
 *
 * NOT AN ENUMERATION RISK, which is the reason it is safe to distinguish at
 * all: a captcha rejection does not depend on whether the account exists, so
 * telling the truth about it leaks nothing. Everything that IS
 * account-dependent still collapses to `SIGN_IN_FAILED_COPY`.
 *
 * Matches on the message rather than a code because supabase-js surfaces
 * GoTrue's `error_code` inconsistently across versions, and the human-readable
 * string has carried the word "captcha" throughout.
 */
export function isCaptchaError(message: string | null | undefined): boolean {
  return typeof message === "string" && /captcha/i.test(message);
}

/**
 * Trim, lowercase, collapse internal whitespace away.
 *
 * The local part of an address is case-SENSITIVE per RFC 5321, and in
 * practice no mail provider anyone uses treats it that way — while treating
 * `Alice@…` and `alice@…` as two accounts is a real support incident. Every
 * address we store or compare goes through here.
 */
export function normalizeEmail(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().toLowerCase() : "";
}
