import * as React from "react";
import { Animated, Easing, View } from "react-native";

/**
 * Tailwind's `animate-pulse` is a keyframe the native styler cannot run, so
 * the pulse is an Animated loop with the same curve: opacity 1 → 0.5 → 1
 * over 2 s, ease-in-out. Native driver, since opacity never touches layout.
 */
function usePulse(): Animated.Value {
  // `isInteraction: false` on both legs: a loop never ends, and a timing that
  // counts as an interaction holds InteractionManager for as long as it runs.
  // A lazily-initialised state slot rather than a ref: the driver value is
  // read during render (as the style), which the refs lint forbids of a ref.
  const [opacity] = React.useState(() => new Animated.Value(1));
  React.useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.5,
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
          isInteraction: false,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
          isInteraction: false,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return opacity;
}

/** Pulsing placeholder block. Size it with width/height utilities. */
export function Skeleton({ className }: { className?: string }) {
  const opacity = usePulse();
  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className={`rounded-md bg-muted ${className ?? ""}`}
      style={{ opacity }}
    />
  );
}

export interface PageSkeletonProps {
  /** Number of content-card placeholders below the title block. */
  cards?: number;
  className?: string;
}

/** packages/ui PageSkeleton: a page-title block plus N card placeholders. */
export function PageSkeleton({ cards = 2, className }: PageSkeletonProps) {
  return (
    <View
      // `accessible`, or VoiceOver never lands on it and the label goes
      // unread — the live region below is Android-only.
      accessible
      accessibilityLiveRegion="polite"
      accessibilityLabel="Loading…"
      testID="page-skeleton"
      className={`gap-6 ${className ?? ""}`}
    >
      <View className="gap-2">
        <Skeleton className="h-8 w-48 max-w-full" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </View>
      {Array.from({ length: cards }, (_, i) => (
        <Skeleton key={i} className="h-40 w-full rounded-xl" />
      ))}
    </View>
  );
}
