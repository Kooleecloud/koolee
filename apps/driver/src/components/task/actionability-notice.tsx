import { View } from "react-native";
import { TriangleAlert } from "lucide-react-native";
import type { Actionability } from "@koolee/api-contract";

import { Text } from "@/components/ui";

/**
 * What the gates decided, at the top of the screen the driver is looking at.
 *
 * Two states, and the difference between them is the whole point: "running
 * late" sits above controls that STILL WORK, because a visit before the
 * airline's bag drop closes is a visit worth making. "Blocked" sits above
 * controls that will refuse, and says why — a driver who taps Arrive and gets
 * a server error learns nothing they can act on, and neither does the
 * customer standing in front of them.
 *
 * The sentences are the server's (`actionability.blockedReason` /
 * `lateNotice`); nothing here re-derives them.
 */
export function ActionabilityNotice({
  state,
  testID = "actionability-notice",
}: {
  state: Pick<Actionability, "blockedReason" | "lateNotice">;
  testID?: string;
}) {
  const blocked = state.blockedReason !== null;
  const message = state.blockedReason ?? state.lateNotice;
  if (!message) return null;

  return (
    <View
      accessibilityRole="alert"
      testID={testID}
      className={
        blocked
          ? "flex-row items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3"
          : "flex-row items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3"
      }
    >
      <View className="mt-0.5">
        <TriangleAlert size={16} color={blocked ? "#7f1d1d" : "#78350f"} />
      </View>
      <Text
        className={
          blocked ? "flex-1 text-sm text-red-900" : "flex-1 text-sm text-amber-900"
        }
      >
        {message}
      </Text>
    </View>
  );
}
