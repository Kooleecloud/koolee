/**
 * The pure half of `Avatar`, split out so vitest can cover it without
 * importing react-native (see vitest.config.ts).
 *
 * Same TINTS and the same hash as packages/ui — the point of the tint is that
 * one person is one colour on every screen, and the driver app shares its
 * people with the admin console and the customer's trip page.
 */

/** Brand scales only — an avatar grid should not invent colours. */
export const TINTS = [
  { box: "bg-navy-100", text: "text-navy-800" },
  { box: "bg-sky-100", text: "text-sky-800" },
  { box: "bg-tag-100", text: "text-tag-800" },
] as const;

export type AvatarTint = (typeof TINTS)[number];

/** Stable tint index for a name: Σ hash*31 + charCode, |0, abs % 3. */
export function tintIndexFor(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % TINTS.length;
}

export function tintFor(seed: string): AvatarTint {
  return TINTS[tintIndexFor(seed)] ?? TINTS[0];
}

/**
 * What a screen reader says for the avatar. `alt` wins when given — pass `""`
 * when the name is already written next to the avatar, so it is not announced
 * twice (the web's rule; both agent screens that show a name beside the
 * avatar rely on it).
 */
export function avatarLabelFor(
  name: string | null | undefined,
  alt: string | undefined,
): string {
  return alt ?? name ?? "";
}

/** First letter of the first and last words — "Ana Maria Ruiz" → "AR". */
export function initialsFor(name: string | null | undefined): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  const first = words[0]?.[0] ?? "";
  if (first === "") return "";
  const last = words.length > 1 ? (words[words.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}
