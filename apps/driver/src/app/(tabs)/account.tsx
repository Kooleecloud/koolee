import * as React from "react";
import { View } from "react-native";
import Constants from "expo-constants";
import { LogOut } from "lucide-react-native";

import { useMe, useSession } from "@/auth/session";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Screen,
  Text,
} from "@/components/ui";
import { env } from "@/lib/env";
import { queuedPositionCount } from "@/location/queue";
import {
  locationPermissionState,
  type LocationPermissionState,
} from "@/location/tracking";

export default function AccountScreen() {
  const me = useMe();
  const { signOut } = useSession();
  const [permission, setPermission] = React.useState<LocationPermissionState | null>(
    null,
  );
  const [queued, setQueued] = React.useState<number | null>(null);

  React.useEffect(() => {
    void locationPermissionState().then(setPermission);
    void queuedPositionCount().then(setQueued);
  }, []);

  return (
    <Screen>
      <Text face="display" weight="semibold" className="text-3xl text-navy-800">
        Account
      </Text>
      <Card>
        <CardHeader>
          <View className="flex-row items-center gap-3">
            <View className="h-10 w-10 items-center justify-center rounded-full bg-navy-100">
              <Text weight="semibold" className="text-sm text-navy-800">
                {initials(me.fullName ?? me.email ?? "")}
              </Text>
            </View>
            <View className="flex-1">
              <CardTitle numberOfLines={1}>
                {me.fullName ?? me.email ?? "Signed in"}
              </CardTitle>
              {me.fullName && me.email ? (
                <CardDescription numberOfLines={1}>{me.email}</CardDescription>
              ) : null}
            </View>
            <Badge variant="secondary">agent</Badge>
          </View>
          <CardDescription>
            Every seal, photo and hand-off you record is filed under this account.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="outline"
            size="lg"
            icon={<LogOut size={16} color="#0b2545" />}
            onPress={() => void signOut()}
          >
            Sign out
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Location</CardTitle>
          <CardDescription>
            {permission === "granted"
              ? "Always allowed — customers can see you even when the phone is locked."
              : permission === "foreground_only"
                ? 'Allowed only while the app is open. Choose "Always" in Settings to keep sharing from a locked phone.'
                : permission === "denied"
                  ? "Off. Turn it on in Settings so customers can see you coming."
                  : "Checking…"}
          </CardDescription>
          {queued !== null && queued > 0 ? (
            <CardDescription>
              {queued} position{queued === 1 ? "" : "s"} waiting for a signal.
            </CardDescription>
          ) : null}
        </CardHeader>
      </Card>
      <Text className="text-center text-xs text-muted-foreground">
        Koolee Driver {Constants.expoConfig?.version ?? ""} · {env.channel}
      </Text>
    </Screen>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase() || "?";
}
