import { Tabs } from "expo-router";
import { CalendarDays, CircleUser, Navigation } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useToast } from "@/components/ui";
import { useReplay } from "@/offline/use-replay";

/** The three tabs, and three is the ceiling — same as the web agent app. */
export default function TabsLayout() {
  const toast = useToast();
  const insets = useSafeAreaInsets();
  // THE ONE MOUNT of the offline replay. The tabs stay mounted under every
  // task screen, so this is where the queue gets sent when a signal returns;
  // Today and the step screens only READ the queue's count. A queued step
  // the server refused is said here, in the driver's own words for it.
  useReplay({
    onActionFailed: (failure) => toast.error(`${failure.label} — ${failure.message}`),
  });

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: "#0b2545",
        tabBarInactiveTintColor: "#6b7a90",
        tabBarLabelStyle: { fontFamily: "Inter_500Medium", fontSize: 11 },
        // The web bar's metrics: a 56px row of targets, then the home
        // indicator's inset below it. A fixed height alone would not do — the
        // bar pads itself by the inset, so the inset has to be ADDED here or
        // the labels sink under the home indicator (iOS) and the gesture
        // handle (Android, edge-to-edge).
        tabBarStyle: {
          backgroundColor: "#ffffff",
          borderTopColor: "#dfe5ee",
          height: 56 + insets.bottom,
          paddingTop: 4,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Today",
          tabBarButtonTestID: "tab-today",
          tabBarIcon: ({ color, focused }) => (
            <Navigation size={24} color={color} strokeWidth={focused ? 2.4 : 2} />
          ),
        }}
      />
      <Tabs.Screen
        name="schedule"
        options={{
          title: "Schedule",
          tabBarButtonTestID: "tab-schedule",
          tabBarIcon: ({ color, focused }) => (
            <CalendarDays size={24} color={color} strokeWidth={focused ? 2.4 : 2} />
          ),
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: "Account",
          tabBarButtonTestID: "tab-account",
          tabBarIcon: ({ color, focused }) => (
            <CircleUser size={24} color={color} strokeWidth={focused ? 2.4 : 2} />
          ),
        }}
      />
    </Tabs>
  );
}
