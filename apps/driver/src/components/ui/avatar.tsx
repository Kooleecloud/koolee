import * as React from "react";
import { Image, View } from "react-native";
import { User } from "lucide-react-native";

import { emulatorHost } from "@/lib/env";

import { avatarLabelFor, initialsFor, tintFor } from "./avatar-fallback";
import { Text } from "./text";

/**
 * A person, at any size — packages/ui Avatar with RN primitives.
 *
 * MOST PEOPLE HAVE NO PHOTO, so the fallback is the design: initials on a
 * tint hashed from the name, the same hash as the web so a driver is the same
 * colour here as in the admin console.
 *
 * `src` is always a SHORT-LIVED SIGNED URL (the `avatars` bucket is private),
 * so a failed load falls back to the initials rather than a broken image.
 */
export type AvatarSize = "xs" | "sm" | "md" | "lg" | "xl";

const SIZE: Record<AvatarSize, { box: string; text: string; icon: number }> = {
  xs: { box: "h-6 w-6", text: "text-[10px]", icon: 12 },
  sm: { box: "h-8 w-8", text: "text-xs", icon: 16 },
  md: { box: "h-10 w-10", text: "text-sm", icon: 20 },
  lg: { box: "h-14 w-14", text: "text-base", icon: 28 },
  xl: { box: "h-24 w-24", text: "text-2xl", icon: 48 },
};

// lucide takes a hex, not a class: the web's `currentColor` inherits the tint's
// text colour, so the icon has to be told the same one by hand.
const ICON_COLOR: Record<string, string> = {
  "text-navy-800": "#0b2545",
  "text-sky-800": "#114f65",
  "text-tag-800": "#8c2e10",
};

export interface AvatarProps {
  /** Drives the initials and the tint. */
  name?: string | null;
  /** Short-lived signed URL, or null when this person has no photo. */
  src?: string | null;
  /**
   * Screen-reader label. Defaults to the name; pass `""` when the name is
   * already written next to the avatar, so it is not announced twice.
   */
  alt?: string;
  size?: AvatarSize;
  className?: string;
  testID?: string;
}

export function Avatar({ name, src, alt, size = "md", className, testID }: AvatarProps) {
  // Which URL failed, not a boolean: a signed URL expires and the next render
  // hands us a fresh one, which has to get its own attempt.
  const [failedSrc, setFailedSrc] = React.useState<string | null>(null);
  const failed = Boolean(src) && failedSrc === src;
  const showImage = Boolean(src) && !failed;

  const s = SIZE[size];
  const initials = initialsFor(name);
  const tint = tintFor(name ?? "");
  const label = avatarLabelFor(name, alt);
  // An empty label means "decorative": the name is written beside it, so the
  // whole avatar leaves the accessibility tree (the web's `alt=""`).
  const decorative = label === "";

  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={label}
      accessibilityElementsHidden={decorative}
      importantForAccessibility={decorative ? "no-hide-descendants" : "auto"}
      testID={testID}
      className={`items-center justify-center overflow-hidden rounded-full border border-black/5 ${s.box} ${showImage ? "bg-muted" : tint.box} ${className ?? ""}`}
    >
      {showImage && src ? (
        <Image
          source={{ uri: emulatorHost(src) }}
          resizeMode="cover"
          className="h-full w-full"
          onError={() => setFailedSrc(src)}
        />
      ) : initials ? (
        <Text weight="medium" className={`${s.text} ${tint.text}`}>
          {initials}
        </Text>
      ) : (
        <View className="opacity-60">
          <User size={s.icon} color={ICON_COLOR[tint.text] ?? "#0b2545"} />
        </View>
      )}
    </View>
  );
}
