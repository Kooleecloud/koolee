import { Tabs } from "expo-router";
import { CalendarDays, CircleUser, Navigation } from "lucide-react-native";

/** The three tabs, and three is the ceiling — same as the web agent app. */
export default function TabsLayout() {
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
