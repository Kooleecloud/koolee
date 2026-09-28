import * as React from "react";
import { View } from "react-native";

import { Text } from "./text";

export type FormMessageVariant = "error" | "success" | "info";

const VARIANT: Record<FormMessageVariant, { box: string; text: string }> = {
  error: { box: "border-destructive/40 bg-destructive/10", text: "text-destructive" },
  success: { box: "border-success/40 bg-success/10", text: "text-navy-800" },
  info: { box: "border-sky-300 bg-sky-50", text: "text-navy-800" },
};

export function FormMessage({
  variant = "error",
  children,
}: {
  variant?: FormMessageVariant;
  children: React.ReactNode;
}) {
  const v = VARIANT[variant];
  return (
    <View
      accessibilityRole={variant === "error" ? "alert" : "text"}
      className={`rounded-md border px-3 py-2 ${v.box}`}
    >
      <Text className={`text-sm ${v.text}`}>{children}</Text>
    </View>
  );
}
