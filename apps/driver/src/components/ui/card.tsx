import { View, type ViewProps } from "react-native";

import { Text, type BrandTextProps } from "./text";

/** packages/ui Card: "border bg-card text-card-foreground rounded-xl shadow-lift". */
export function Card({ className, ...rest }: ViewProps & { className?: string }) {
  return (
    <View
      className={`rounded-xl border border-border bg-card ${className ?? ""}`}
      style={{
        shadowColor: "#0b2545",
        shadowOpacity: 0.08,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 8 },
        elevation: 2,
      }}
      {...rest}
    />
  );
}

export function CardHeader({ className, ...rest }: ViewProps & { className?: string }) {
  return <View className={`gap-1.5 p-4 ${className ?? ""}`} {...rest} />;
}

export function CardTitle({ className, ...rest }: BrandTextProps) {
  return (
    <Text
      weight="semibold"
      className={`text-base text-navy-800 ${className ?? ""}`}
      {...rest}
    />
  );
}

export function CardDescription({ className, ...rest }: BrandTextProps) {
  return (
    <Text className={`text-sm text-muted-foreground ${className ?? ""}`} {...rest} />
  );
}

export function CardContent({ className, ...rest }: ViewProps & { className?: string }) {
  return <View className={`px-4 pb-4 ${className ?? ""}`} {...rest} />;
}
