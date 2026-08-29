import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { User } from "lucide-react";

import { cn } from "../lib/utils";

/**
 * A person, at any size.
 *
 * MOST PEOPLE HAVE NO PHOTO, so the fallback is the design, not an
 * afterthought: initials on a tint derived from the name, which stays stable
 * across every screen that renders the same person. A grey placeholder head
 * for everybody makes a staff table unreadable at a glance; two letters in a
 * consistent colour is the thing you actually navigate by.
 *
 * `src` is always a SHORT-LIVED SIGNED URL — the `avatars` bucket is private,
 * so a URL that worked an hour ago is expected to 403 now. A failed load falls
 * back to the initials rather than showing a broken image.
 *
 * Plain `<img>`, not `next/image`: this package holds no Next dependency (see
 * package.json — `next` is an optional peer nothing imports), and a signed URL
 * on a rotating host is exactly the case Next's optimizer cannot cache anyway.
 */

const avatarVariants = cva(
  "relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full ring-1 ring-inset ring-black/5",
  {
    variants: {
      size: {
        xs: "size-6 text-[0.625rem]",
        sm: "size-8 text-xs",
        md: "size-10 text-sm",
        lg: "size-14 text-base",
        xl: "size-24 text-2xl",
      },
    },
    defaultVariants: { size: "md" },
  },
);

/** Brand scales only — an avatar grid should not invent colours. */
const TINTS = [
  "bg-navy-100 text-navy-800",
  "bg-sky-100 text-sky-800",
  "bg-tag-100 text-tag-800",
] as const;

/**
 * Stable tint for a name. Any hash would do; what matters is that it depends
 * on nothing but the name, so the same person is the same colour in the admin
 * table and on the trip page.
 */
function tintFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return TINTS[Math.abs(hash) % TINTS.length]!;
}

/** First letter of the first and last words — "Ana Maria Ruiz" → "AR". */
export function initialsFor(name: string | null | undefined): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  const first = words[0]![0]!;
  const last = words.length > 1 ? words[words.length - 1]![0]! : "";
  return (first + last).toUpperCase();
}

export interface AvatarProps
  extends
    Omit<React.HTMLAttributes<HTMLSpanElement>, "children">,
    VariantProps<typeof avatarVariants> {
  /** Drives the initials and the tint. */
  name?: string | null;
  /** Short-lived signed URL, or null when this person has no photo. */
  src?: string | null;
  /**
   * Screen-reader label. Defaults to the name; pass `""` when the name is
   * already written next to the avatar, so it is not announced twice.
   */
  alt?: string;
}

function Avatar({ className, size, name, src, alt, ...props }: AvatarProps) {
  // Which URL failed, not a boolean: a signed URL expires and the next render
  // hands us a fresh one, which has to get its own attempt. Storing the failed
  // src derives that during render, with no effect to reset.
  const [failedSrc, setFailedSrc] = React.useState<string | null>(null);
  const failed = Boolean(src) && failedSrc === src;

  const initials = initialsFor(name);
  const label = alt ?? name ?? "";

  return (
    <span
      className={cn(
        avatarVariants({ size }),
        !src || failed ? tintFor(name ?? "") : "bg-muted",
        className,
      )}
      {...props}
    >
      {src && !failed ? (
        <img
          src={src}
          alt={label}
          className="size-full object-cover"
          onError={() => setFailedSrc(src ?? null)}
        />
      ) : initials ? (
        // ALWAYS decorative. "AR" read aloud is noise next to the name in the
        // sr-only span below, and reading both gives "A R Ana Maria Ruiz".
        <span aria-hidden="true" className="font-medium leading-none">
          {initials}
        </span>
      ) : (
        <User aria-hidden="true" className="size-1/2 opacity-60" />
      )}
      {/* Carries the whole announcement for the fallback, since the letters
          above are hidden. Empty `alt` means the name is already written next
          to this avatar, so nothing is announced twice. */}
      {label && (!src || failed) ? <span className="sr-only">{label}</span> : null}
    </span>
  );
}

export { Avatar, avatarVariants };
