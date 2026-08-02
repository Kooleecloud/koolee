/**
 * Only allow same-origin path redirects after sign-in. Anything absolute,
 * protocol-relative, or otherwise odd is dropped (open-redirect guard).
 */
export function sanitizeReturnTo(value: string | undefined | null): string | null {
  if (!value) return null;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) {
    return null;
  }
  return value;
}
