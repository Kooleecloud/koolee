import * as React from "react";
import { ActivityIndicator, Pressable, type PressableProps, View } from "react-native";

import { Text } from "./text";

/** Same variants and sizes as packages/ui Button, rendered with RN primitives. */
export type ButtonVariant = "default" | "destructive" | "outline" | "secondary" | "ghost";
export type ButtonSize = "default" | "sm" | "lg";

const VARIANT: Record<ButtonVariant, { box: string; text: string; spinner: string }> = {
  default: { box: "bg-primary", text: "text-primary-foreground", spinner: "#ffffff" },
  destructive: {
    box: "bg-destructive",
    text: "text-destructive-foreground",
    spinner: "#ffffff",
  },
  outline: {
    box: "border border-input bg-background",
    text: "text-foreground",
    spinner: "#0b2545",
  },
  secondary: {
    box: "bg-secondary",
    text: "text-secondary-foreground",
    spinner: "#0b2545",
  },
  ghost: { box: "bg-transparent", text: "text-foreground", spinner: "#0b2545" },
};

const SIZE: Record<ButtonSize, { box: string; text: string }> = {
  default: { box: "h-11 px-4 rounded-md", text: "text-sm" },
  sm: { box: "h-9 px-3 rounded-md", text: "text-xs" },
  lg: { box: "h-12 px-6 rounded-md", text: "text-base" },
};

export interface ButtonProps extends Omit<PressableProps, "children"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  className?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}

export function Button({
  variant = "default",
  size = "default",
  loading = false,
  disabled,
  className,
  icon,
  children,
  ...rest
}: ButtonProps) {
  const v = VARIANT[variant];
  const s = SIZE[size];
  const isDisabled = Boolean(disabled) || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      className={`flex-row items-center justify-center gap-2 ${v.box} ${s.box} ${isDisabled ? "opacity-50" : "active:opacity-80"} ${className ?? ""}`}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator size="small" color={v.spinner} />
      ) : icon ? (
        <View>{icon}</View>
      ) : null}
      {typeof children === "string" ? (
        <Text weight="medium" className={`${v.text} ${s.text}`}>
          {children}
        </Text>
      ) : (
        children
      )}
    </Pressable>
  );
}
