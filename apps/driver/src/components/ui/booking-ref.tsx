import { View } from "react-native";

import { Text } from "./text";

/**
 * `KOO-XXXXX`, drawn as what it is: the number a driver reads out at a door.
 *
 * `bg-tag-400` with `text-navy-800` measures 5.43:1 (AA); `tag-500` fails at
 * 4.27:1, so the lighter orange is the accessible one — do not darken it.
 * Mono and not tightened: these characters get read aloud one at a time.
 *
 * The prop is `value`, not `ref` — `ref` is reserved on a React element.
 */
export function BookingRef({ value, testID }: { value: string; testID?: string }) {
  return (
    <View testID={testID} className="self-start rounded-md bg-tag-400 px-2.5 py-1">
      <Text face="mono" weight="semibold" className="text-sm text-navy-800">
        {value}
      </Text>
    </View>
  );
}
