/**
 * Copies of the credential copy in packages/ui/src/lib/credentials.ts. The
 * driver app cannot depend on @koolee/ui (it pulls Next and the DOM), so the
 * four strings a sign-in screen needs live here too.
 */
export const PASSWORD_MIN_LENGTH = 8;
export const SIGN_IN_FAILED_COPY = "Email or password didn't match.";
export const CAPTCHA_FAILED_COPY = "We couldn't confirm you're human. Try again.";
export const NO_ACCESS_COPY =
  "That account doesn't have agent access. Ask an admin to invite you.";

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function isCaptchaError(message: string | undefined | null): boolean {
  return /captcha/i.test(message ?? "");
}
