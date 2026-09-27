import * as React from "react";
import { Animated, Easing, View } from "react-native";

/**
 * The stage marker — one dot, four states, the visual language of every
 * progress trail in the product: navy for a stage already banked, seal
 * orange pulsing for the one happening now, hollow for what has not happened
 * yet, and hollow-with-a-strike for a stop that was cancelled (it stays ON
 * the track so "what happened to my bags?" is answerable from the screen).
 */
export type StageState = "complete" | "current" | "upcoming" | "cancelled";

export interface StageDotProps {
  state?: StageState;
  className?: string;
}

/**
 * Tailwind's `animate-ping` (scale 1 → 2, opacity 0.75 → 0, 1 s, cubic-bezier
 * (0, 0, 0.2, 1)) as an Animated loop on one driver value.
 */
function usePing(): Animated.Value {
  // A lazily-initialised state slot rather than a ref: the driver value is
  // read during render (as the style), which the refs lint forbids of a ref.
  const [t] = React.useState(() => new Animated.Value(0));
  React.useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(t, {
        toValue: 1,
        duration: 1000,
        easing: Easing.bezier(0, 0, 0.2, 1),
        useNativeDriver: true,
        // A loop never ends, and a timing that counts as an interaction
        // holds InteractionManager for as long as it runs — every
        // runAfterInteractions in the app would wait on a decorative dot.
        isInteraction: false,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [t]);
  return t;
}

function CurrentDot({ className }: { className?: string }) {
  const t = usePing();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className={`relative h-3 w-3 ${className ?? ""}`}
    >
      {/* Two elements because one cannot both pulse and stay legible: the
          ping animates, the core stays a solid, readable dot. The ping is
          drawn FIRST so the ring and the core sit over it, as on the web
          where the ring is a box-shadow of the core. */}
      <Animated.View
        className="absolute inset-0 rounded-full bg-tag"
        style={{
          opacity: t.interpolate({ inputRange: [0, 1], outputRange: [0.75, 0] }),
          transform: [
            { scale: t.interpolate({ inputRange: [0, 1], outputRange: [1, 2] }) },
          ],
        }}
      />
      {/* `ring-4 ring-tag-100` sits OUTSIDE the box on the web, so here it is
          an absolutely positioned halo one step larger than the dot — the
          dot itself stays 12px and lines up with its siblings. */}
      <View className="absolute -inset-1 rounded-full bg-tag-100" />
      <View className="h-3 w-3 rounded-full bg-tag" />
    </View>
  );
}

export function StageDot({ state = "complete", className }: StageDotProps) {
  if (state === "current") return <CurrentDot className={className} />;
  if (state === "cancelled") {
    return (
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        className={`relative h-3 w-3 ${className ?? ""}`}
      >
        <View className="h-3 w-3 rounded-full border-2 border-muted-foreground/50 bg-white" />
        {/* The strike is what separates "cancelled" from "not yet": a muted
            hollow dot on its own reads as upcoming at a glance. 16px wide,
            centred on the 12px dot. */}
        <View
          className="absolute h-px w-4 bg-muted-foreground/70"
          style={{ left: -2, top: 5.5, transform: [{ rotate: "45deg" }] }}
        />
      </View>
    );
  }
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className={`h-3 w-3 rounded-full ${state === "complete" ? "bg-navy-800" : "border-2 border-input bg-white"} ${className ?? ""}`}
    />
  );
}
