import "../../global.css";

import * as React from "react";
import { View } from "react-native";
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
} from "@expo-google-fonts/inter";
import { Sora_400Regular, Sora_600SemiBold, Sora_700Bold } from "@expo-google-fonts/sora";
import { useFonts } from "expo-font";
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { SessionProvider, useSession } from "@/auth/session";
import { ToastProvider } from "@/components/ui";
import { Sentry } from "@/lib/sentry";

void SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 10_000, retry: 1 } },
});

function RootLayout() {
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Sora_400Regular,
    Sora_600SemiBold,
    Sora_700Bold,
  });

  React.useEffect(() => {
    if (fontsLoaded) void SplashScreen.hideAsync();
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

  return (
    <SafeAreaProvider>
      <ToastProvider>
        <QueryClientProvider client={queryClient}>
          <SessionProvider>
            <StatusBar style="dark" />
            <AuthGate />
          </SessionProvider>
        </QueryClientProvider>
      </ToastProvider>
    </SafeAreaProvider>
  );
}

/**
 * The route guard. Signed out → /login; signed in → the tabs. Runs as an
 * effect on the session state so the redirect happens once per change rather
 * than on every render, and never before the router is mounted.
 */
function AuthGate() {
  const { state } = useSession();
  const segments = useSegments();
  const router = useRouter();
  const inLogin = segments[0] === "login";

  React.useEffect(() => {
    if (state.status === "loading") return;
    if (state.status === "signed_out" && !inLogin) router.replace("/login");
    if (state.status === "signed_in" && inLogin) router.replace("/(tabs)");
  }, [state.status, inLogin, router]);

  if (state.status === "loading") return <View className="flex-1 bg-background" />;

  return (
    <Stack
      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "#f8f9fb" } }}
    >
      <Stack.Screen name="login" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="task/[taskId]" />
    </Stack>
  );
}

export default Sentry.wrap(RootLayout);
