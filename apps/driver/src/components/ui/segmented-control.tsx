import { Pressable, View } from "react-native";

import { Text } from "./text";

export interface SegmentedControlItem<T extends string> {
  value: T;
  /** What the tab says. A count belongs here — "List · 4". */
  label: string;
}

export interface SegmentedControlProps<T extends string> {
  items: readonly SegmentedControlItem<T>[];
  value: T;
  onChange: (next: T) => void;
  /** Names the choice for a screen reader: "Schedule or history". */
  label: string;
  className?: string;
  /** Prefix for each tab's testID: `${testID}-${value}`. Default "segment". */
  testID?: string;
}

/**
 * Two or three mutually exclusive views of the same thing — packages/ui
 * SegmentedControl. Buttons only: on the phone the schedule/history switch
 * is screen state, not a URL.
 *
 * The active tab is RAISED rather than tinted: a colour change alone
 * disappears at a glance in bright sun; the card background plus the lift
 * shadow reads as "this one is on top" without relying on hue.
 */
export function SegmentedControl<T extends string>({
  items,
  value,
  onChange,
  label,
  className,
  testID = "segment",
}: SegmentedControlProps<T>) {
  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={label}
      className={`flex-row gap-1 rounded-lg border border-border bg-muted/40 p-1 ${className ?? ""}`}
    >
      {items.map((item) => {
        const selected = item.value === value;
        return (
          <Pressable
            key={item.value}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            testID={`${testID}-${item.value}`}
            onPress={() => onChange(item.value)}
            className={`flex-1 items-center rounded-md px-3 py-1.5 ${selected ? "bg-card" : "bg-transparent"}`}
            style={
              selected
                ? {
                    shadowColor: "#0b2545",
                    shadowOpacity: 0.08,
                    shadowRadius: 12,
                    shadowOffset: { width: 0, height: 8 },
                    elevation: 2,
                  }
                : undefined
            }
          >
            <Text
              weight="medium"
              numberOfLines={1}
              className={`text-sm ${selected ? "text-navy-800" : "text-muted-foreground"}`}
            >
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
