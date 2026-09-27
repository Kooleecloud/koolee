import * as React from "react";
import { TextInput, type TextInputProps } from "react-native";

import { Text, type BrandTextProps } from "./text";

/** packages/ui Input metrics: h-9 rounded-md border border-input px-3 text-base. */
export const Input = React.forwardRef<TextInput, TextInputProps & { className?: string }>(
  function Input({ className, ...rest }, ref) {
    return (
      <TextInput
        ref={ref}
        placeholderTextColor="#6b7a90"
        className={`h-11 w-full rounded-md border border-input bg-background px-3 text-base text-foreground ${className ?? ""}`}
        style={{ fontFamily: "Inter_400Regular" }}
        {...rest}
      />
    );
  },
);

export function Label({ className, ...rest }: BrandTextProps) {
  return (
    <Text
      weight="medium"
      className={`text-sm text-foreground ${className ?? ""}`}
      {...rest}
    />
  );
}
