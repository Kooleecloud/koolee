import { Text as RNText, type TextProps } from "react-native";

/**
 * Text with the brand faces. Tailwind's `font-medium`/`font-semibold` do not
 * switch a font FAMILY on native, so weight is a prop here and maps to the
 * matching Inter/Sora face loaded in the root layout.
 */
export type TextWeight = "regular" | "medium" | "semibold" | "bold";
export type TextFace = "sans" | "display" | "mono";

const FACES: Record<TextFace, Record<TextWeight, string>> = {
  sans: {
    regular: "Inter_400Regular",
    medium: "Inter_500Medium",
    semibold: "Inter_600SemiBold",
    bold: "Inter_600SemiBold",
  },
  display: {
    regular: "Sora_400Regular",
    medium: "Sora_600SemiBold",
    semibold: "Sora_600SemiBold",
    bold: "Sora_700Bold",
  },
  mono: { regular: "Menlo", medium: "Menlo", semibold: "Menlo", bold: "Menlo" },
};

export interface BrandTextProps extends TextProps {
  face?: TextFace;
  weight?: TextWeight;
  className?: string;
}

export function Text({
  face = "sans",
  weight = "regular",
  style,
  className,
  ...rest
}: BrandTextProps) {
  return (
    <RNText
      className={className ?? "text-base text-foreground"}
      style={[{ fontFamily: FACES[face][weight] }, style]}
      {...rest}
    />
  );
}
