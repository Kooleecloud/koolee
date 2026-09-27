import * as React from "react";
import { Modal, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Check, ChevronDown } from "lucide-react-native";

import { Text } from "./text";

export interface SelectItem<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
}

export interface SelectProps<T extends string> {
  value: T | null;
  onValueChange: (next: T) => void;
  items: readonly SelectItem<T>[];
  placeholder?: string;
  /** Names the choice in the sheet header and for a screen reader. */
  label?: string;
  disabled?: boolean;
  className?: string;
  /** The trigger; rows get `${testID}-option-${value}`. */
  testID: string;
}

/**
 * packages/ui Select is a styled native `<select>`; the phone's equivalent
 * is a bottom sheet. The trigger keeps Input's metrics so it sits in a form
 * beside one without a seam, and the sheet is a plain Modal — no picker
 * library, so it looks the same on both platforms and every row has a
 * testID the simulator flows can tap.
 */
export function Select<T extends string>({
  value,
  onValueChange,
  items,
  placeholder = "Select…",
  label,
  disabled = false,
  className,
  testID,
}: SelectProps<T>) {
  const [open, setOpen] = React.useState(false);
  const insets = useSafeAreaInsets();
  const selected = items.find((item) => item.value === value) ?? null;

  return (
    <>
      <Pressable
        accessibilityRole="combobox"
        accessibilityLabel={label}
        accessibilityValue={selected ? { text: selected.label } : undefined}
        accessibilityState={{ disabled, expanded: open }}
        disabled={disabled}
        testID={testID}
        onPress={() => setOpen(true)}
        className={`h-11 w-full flex-row items-center justify-between rounded-md border border-input bg-background px-3 ${disabled ? "opacity-50" : "active:bg-muted/40"} ${className ?? ""}`}
      >
        <Text
          numberOfLines={1}
          className={`flex-1 text-base ${selected ? "text-foreground" : "text-muted-foreground"}`}
        >
          {selected ? selected.label : placeholder}
        </Text>
        <ChevronDown size={16} color="#58687e" />
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="slide"
        onRequestClose={() => setOpen(false)}
      >
        <View className="flex-1 justify-end">
          {/* The scrim is the dismiss target, same as tapping outside a
              native picker. */}
          <Pressable
            accessibilityLabel="Close"
            testID={`${testID}-scrim`}
            onPress={() => setOpen(false)}
            className="absolute inset-0 bg-black/50"
          />
          <View
            className="max-h-[70%] rounded-t-2xl border-t border-border bg-card"
            style={{ paddingBottom: Math.max(insets.bottom, 12) }}
          >
            <View className="items-center pb-2 pt-3">
              <View className="h-1 w-10 rounded-full bg-border" />
            </View>
            {label ? (
              <View className="px-4 pb-2">
                <Text weight="semibold" className="text-sm text-muted-foreground">
                  {label}
                </Text>
              </View>
            ) : null}
            <ScrollView bounces={false}>
              {items.map((item) => {
                const isSelected = item.value === value;
                return (
                  <Pressable
                    key={item.value}
                    accessibilityRole="menuitem"
                    accessibilityState={{ selected: isSelected, disabled: item.disabled }}
                    disabled={item.disabled}
                    testID={`${testID}-option-${item.value}`}
                    onPress={() => {
                      setOpen(false);
                      onValueChange(item.value);
                    }}
                    className={`flex-row items-center justify-between px-4 py-3.5 ${item.disabled ? "opacity-50" : "active:bg-muted/40"}`}
                  >
                    <Text
                      weight={isSelected ? "medium" : "regular"}
                      className="flex-1 text-base text-foreground"
                    >
                      {item.label}
                    </Text>
                    {isSelected ? <Check size={18} color="#0b2545" /> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}
