import * as React from "react";
import { View } from "react-native";

import { Text } from "./text";

export type BadgeVariant =
  "default" | "secondary" | "destructive" | "success" | "warning" | "outline";

const VARIANT: Record<BadgeVariant, { box: string; text: string }> = {
  default: { box: "bg-primary border-transparent", text: "text-primary-foreground" },
  secondary: {
    box: "bg-secondary border-transparent",
    text: "text-secondary-foreground",
  },
  destructive: {
    box: "bg-destructive border-transparent",
    text: "text-destructive-foreground",
  },
  success: { box: "bg-success border-transparent", text: "text-success-foreground" },
  warning: { box: "bg-warning border-transparent", text: "text-warning-foreground" },
  outline: { box: "bg-transparent border-border", text: "text-foreground" },
};

export function Badge({
  variant = "default",
  className,
  children,
}: {
  variant?: BadgeVariant;
  className?: string;
  children: React.ReactNode;
}) {
  const v = VARIANT[variant];
  return (
    <View
      className={`self-start rounded-md border px-2 py-0.5 ${v.box} ${className ?? ""}`}
    >
      <Text weight="medium" className={`text-xs ${v.text}`}>
        {children}
      </Text>
    </View>
  );
}
