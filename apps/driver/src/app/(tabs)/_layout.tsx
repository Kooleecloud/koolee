import { Tabs } from "expo-router";
import { CalendarDays, CircleUser, Navigation } from "lucide-react-native";

import { useToast } from "@/components/ui";
import { useReplay } from "@/offline/use-replay";

/** The three tabs, and three is the ceiling — same as the web agent app. */
export default function TabsLayout() {
  const toast = useToast();
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
        tabBarStyle: {
          backgroundColor: "#ffffff",
          borderTopColor: "#dfe5ee",
          height: 64,
          paddingTop: 6,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Today",
          tabBarIcon: ({ color, focused }) => (
            <Navigation size={24} color={color} strokeWidth={focused ? 2.4 : 2} />
          ),
        }}
      />
      <Tabs.Screen
        name="schedule"
        options={{
          title: "Schedule",
          tabBarIcon: ({ color, focused }) => (
            <CalendarDays size={24} color={color} strokeWidth={focused ? 2.4 : 2} />
          ),
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: "Account",
          tabBarIcon: ({ color, focused }) => (
            <CircleUser size={24} color={color} strokeWidth={focused ? 2.4 : 2} />
          ),
        }}
      />
    </Tabs>
  );
}
