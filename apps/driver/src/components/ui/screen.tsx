import * as React from "react";
import { RefreshControl, ScrollView, type ScrollViewProps } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

/**
 * The content column: `mx-auto max-w-lg px-4 pt-5 gap-4` on the web, here a
 * safe-area scroll view with the same gutter. Pull-to-refresh is the
 * phone's `router.refresh()`.
 */
export function Screen({
  children,
  refreshing = false,
  onRefresh,
  contentClassName,
  ...rest
}: ScrollViewProps & {
  children: React.ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  contentClassName?: string;
}) {
  return (
    <SafeAreaView edges={["top", "left", "right"]} className="flex-1 bg-background">
      <ScrollView
        className="flex-1"
        contentContainerClassName={`gap-4 px-4 pb-10 pt-5 ${contentClassName ?? ""}`}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          onRefresh ? (
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          ) : undefined
        }
        {...rest}
      >
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}
