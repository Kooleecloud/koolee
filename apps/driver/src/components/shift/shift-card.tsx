import * as React from "react";
import { Platform, Pressable, View } from "react-native";
import { useKeepAwake } from "expo-keep-awake";
import { useNetworkState } from "expo-network";
import { Check, Truck } from "lucide-react-native";

import { useSession } from "@/auth/session";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  FormMessage,
  Text,
} from "@/components/ui";
import { ApiRequestError } from "@/lib/api";
import { useEndShift, useShift, useStartShift, useTrucks } from "@/lib/queries";
import { FALLBACK_TZ, formatTime, iso } from "@/lib/time";
import {
  batteryOptimisationEnabled,
  isTracking,
  locationPermissionState,
  openBatteryOptimisationSettings,
  openLocationSettings,
  requestLocationPermissions,
  startTracking,
  stopTracking,
  type LocationPermissionState,
} from "@/location/tracking";

/**
 * The shift pill's native twin — but a card, because on a phone it is the
 * top of the Today screen rather than a popover in a header.
 *
 * STARTING A SHIFT IS WHERE LOCATION STARTS. The two are one action for the
 * driver ("clock on") and have to be: Android will not let a location
 * foreground service start from the background, and iOS asks for "Always"
 * only once — the moment of clocking on is the one time the driver is looking
 * at the screen with a reason to say yes.
 */
export function ShiftCard() {
  const { state, refresh } = useSession();
  const shift = useShift();
  const active = shift.data?.shift ?? null;
  const trucks = useTrucks(
    active === null && state.status === "signed_in" && state.me.canDrive,
  );
  const start = useStartShift();
  const end = useEndShift();
  const network = useNetworkState();
  const online = network.isConnected !== false;

  const [truckId, setTruckId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [permission, setPermission] = React.useState<LocationPermissionState | null>(
    null,
  );
  const [tracking, setTracking] = React.useState<boolean | null>(null);
  const [batteryNag, setBatteryNag] = React.useState(false);

  // Keep the screen on while clocked on and connected (decision 14).
  useKeepAwake(active && online ? "koolee-shift" : undefined);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [p, t, b] = await Promise.all([
        locationPermissionState(),
        isTracking(),
        batteryOptimisationEnabled(),
      ]);
      if (cancelled) return;
      setPermission(p);
      setTracking(t);
      setBatteryNag(b);
    })();
    return () => {
      cancelled = true;
    };
  }, [active?.id]);

  // A shift that is open on the server but not tracking on this phone (app
  // reinstalled, phone restarted) resumes tracking as soon as the card mounts.
  React.useEffect(() => {
    if (!active || tracking !== false || permission !== "granted") return;
    void startTracking()
      .then(() => setTracking(true))
      .catch(() => undefined);
  }, [active, tracking, permission]);

  const me = state.status === "signed_in" ? state.me : null;
  if (!me) return null;

  if (!me.canDrive && !active) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Not cleared to drive</CardTitle>
          <CardDescription>
            You can verify and seal at the door. Driving is a permission an admin grants
            on the Staff page.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  async function onStart() {
    setError(null);
    if (!truckId) {
      setError("Pick a truck first.");
      return;
    }
    // Ask before the shift opens: a shift with no location is a shift the
    // customer cannot see, and the prompt needs the screen the driver is on.
    const granted = await requestLocationPermissions();
    setPermission(granted);
    try {
      await start.mutateAsync(truckId);
      await refresh();
      if (granted === "granted" || granted === "foreground_only") {
        await startTracking();
        setTracking(true);
      }
      setBatteryNag(await batteryOptimisationEnabled());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't start your shift.");
    }
  }

  async function onEnd() {
    setError(null);
    try {
      await end.mutateAsync();
      await stopTracking();
      setTracking(false);
      await refresh();
    } catch (err) {
      if (err instanceof ApiRequestError) setError(err.message);
      else setError("Couldn't end your shift. Check your connection and try again.");
    }
  }

  if (active) {
    const remaining = Math.max(
      0,
      active.truck.bagCapacity - active.truck.reservedSpaces - active.bagsOnBoard,
    );
    return (
      <Card>
        <CardHeader className="flex-row items-start justify-between">
          <View className="flex-1 gap-1">
            <View className="flex-row items-center gap-2">
              <Truck size={16} color="#0b2545" />
              <CardTitle>{active.truck.name}</CardTitle>
            </View>
            <CardDescription>
              {active.bagsOnBoard} of {active.truck.bagCapacity} spaces used · room for{" "}
              {remaining} more bag{remaining === 1 ? "" : "s"}
            </CardDescription>
            <CardDescription>
              Started {formatTime(iso(active.startedAt), FALLBACK_TZ)}
            </CardDescription>
          </View>
          <Badge variant="success">On shift</Badge>
        </CardHeader>
        <CardContent className="gap-3">
          <LocationLine
            permission={permission}
            tracking={tracking}
            online={online}
            onTurnOn={async () => {
              const granted = await requestLocationPermissions();
              setPermission(granted);
              if (granted === "granted" || granted === "foreground_only") {
                await startTracking();
                setTracking(true);
              }
            }}
          />
          {batteryNag && Platform.OS === "android" ? (
            <View className="gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2">
              <Text className="text-sm text-navy-700">
                Android may pause Koolee in the background. Allow it to run unrestricted
                so customers keep seeing you move.
              </Text>
              <Button
                variant="secondary"
                size="sm"
                onPress={() => void openBatteryOptimisationSettings()}
              >
                Open battery settings
              </Button>
            </View>
          ) : null}
          {error ? <FormMessage>{error}</FormMessage> : null}
          <Button
            variant="outline"
            size="lg"
            loading={end.isPending}
            onPress={() => void onEnd()}
          >
            End shift
          </Button>
        </CardContent>
      </Card>
    );
  }

  const options = trucks.data?.trucks ?? [];
  const free = options.filter(
    (t) => t.heldByUserId === null || t.heldByUserId === me.userId,
  );
  const selected = truckId ?? free[0]?.id ?? null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Not on shift</CardTitle>
        <CardDescription>
          Pick your truck to clock on. Customers can only be offered a driver who is out.
        </CardDescription>
      </CardHeader>
      <CardContent className="gap-3">
        {trucks.isLoading ? (
          <Text className="text-sm text-muted-foreground">Loading trucks…</Text>
        ) : options.length === 0 ? (
          <Text className="text-sm text-muted-foreground">
            No trucks are set up yet. Ops adds them in the console.
          </Text>
        ) : free.length === 0 ? (
          <Text className="text-sm text-muted-foreground">
            Every truck is out right now. Check with ops before starting.
          </Text>
        ) : (
          <View className="gap-2">
            {options.map((truck) => {
              const held =
                truck.heldByUserId !== null && truck.heldByUserId !== me.userId;
              const isSelected = truck.id === selected;
              return (
                <Pressable
                  key={truck.id}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: isSelected, disabled: held }}
                  disabled={held}
                  testID={`truck-${truck.name.replace(/\s+/g, "-").toLowerCase()}`}
                  onPress={() => setTruckId(truck.id)}
                  className={`flex-row items-center justify-between rounded-md border px-3 py-3 ${isSelected ? "border-navy-800 bg-navy-50" : "border-border bg-background"} ${held ? "opacity-50" : ""}`}
                >
                  <View>
                    <Text weight="medium" className="text-sm text-navy-800">
                      {truck.name}
                    </Text>
                    <Text className="text-xs text-muted-foreground">
                      {held
                        ? "out with another driver"
                        : `${truck.bagCapacity} bag spaces`}
                    </Text>
                  </View>
                  {isSelected ? <Check size={18} color="#0b2545" /> : null}
                </Pressable>
              );
            })}
          </View>
        )}
        <PermissionNotice permission={permission} />
        {error ? <FormMessage>{error}</FormMessage> : null}
        <Button
          size="lg"
          loading={start.isPending}
          disabled={free.length === 0}
          onPress={() => void onStart()}
        >
          Start shift
        </Button>
      </CardContent>
    </Card>
  );
}

function PermissionNotice({
  permission,
}: {
  permission: LocationPermissionState | null;
}) {
  if (permission === "denied") {
    return (
      <View className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2">
        <Text className="text-sm text-navy-700">
          Location is off for Koolee. Start your shift and your customers won't see you
          coming — turn it on in Settings.
        </Text>
      </View>
    );
  }
  if (permission === "foreground_only") {
    return (
      <View className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2">
        <Text className="text-sm text-navy-700">
          Koolee can only see you while the app is open. Choose "Always" in Settings so a
          locked phone keeps sharing.
        </Text>
      </View>
    );
  }
  return (
    <View className="rounded-md border border-border bg-muted/40 px-3 py-2">
      <Text className="text-sm text-navy-700">
        Koolee shares your location with dispatch and your customers for the whole shift,
        even when the app is closed or the phone is locked, so they can watch you arrive.
        You'll be asked when you clock on.
      </Text>
    </View>
  );
}

function LocationLine({
  permission,
  tracking,
  online,
  onTurnOn,
}: {
  permission: LocationPermissionState | null;
  tracking: boolean | null;
  online: boolean;
  onTurnOn: () => Promise<void>;
}) {
  const [busy, setBusy] = React.useState(false);
  let tone = "bg-warning";
  let label = "Finding";
  let note =
    "Looking for your position. This usually takes a few seconds after you clock on.";
  let action: { label: string; run: () => Promise<void> } | null = null;
  if (permission === "denied") {
    tone = "bg-destructive";
    label = "Off";
    note =
      "Location is blocked for Koolee, so no customer can see you coming. Turn it on in Settings.";
    action = { label: "Open Settings", run: openLocationSettings };
  } else if (
    permission === "undetermined" ||
    (permission === "foreground_only" && !tracking)
  ) {
    tone = "bg-warning";
    label = "Not sharing";
    note =
      "Koolee needs your location for the whole shift so customers can watch you arrive.";
    action = { label: "Turn on location", run: onTurnOn };
  } else if (tracking) {
    tone = online ? "bg-success" : "bg-warning";
    label = online ? "Live" : "Queued";
    note = online
      ? permission === "foreground_only"
        ? 'Sharing while the app is open. Choose "Always" in Settings to keep sharing from a locked phone.'
        : "Your location is going through, even with the phone locked."
      : "No signal — positions are saved on the phone and sent when it comes back.";
    if (permission === "foreground_only")
      action = { label: "Open Settings", run: openLocationSettings };
  }
  return (
    <View className="gap-2">
      <View className="flex-row items-center gap-2">
        <View className={`h-2 w-2 rounded-full ${tone}`} />
        <Text weight="medium" className="text-sm text-navy-800">
          Location: {label}
        </Text>
      </View>
      <Text className="text-xs text-muted-foreground">{note}</Text>
      {action ? (
        <Button
          variant="secondary"
          size="sm"
          loading={busy}
          testID="location-action"
          onPress={() => {
            setBusy(true);
            void action.run().finally(() => setBusy(false));
          }}
        >
          {action.label}
        </Button>
      ) : null}
    </View>
  );
}
