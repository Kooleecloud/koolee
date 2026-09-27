import * as Location from "expo-location";
import { Platform } from "react-native";

import { disarmGeofence, LOCATION_TASK, recordLocations } from "./task";

/**
 * Starting and stopping the 5-second track. Called from the Start-shift and
 * End-shift actions — a screen, never the background: Android 12+ refuses to
 * start a location foreground service from the background, and Android 14+
 * refuses to CREATE one there at all.
 */

export const POSITION_INTERVAL_MS = 5_000;

export type LocationPermissionState =
  | "granted"
  | "foreground_only"
  /** Never asked. The next request shows the system prompt. */
  | "undetermined"
  /** Asked and refused. Only Settings can change it now. */
  | "denied"
  | "unavailable";

/**
 * Two prompts, in order: foreground ("While Using"), then background
 * ("Always"). The second cannot be granted without the first, and on Android
 * 11+ it opens the system settings page rather than a dialog — the screen
 * that calls this explains why before it does.
 */
export async function requestLocationPermissions(): Promise<LocationPermissionState> {
  const services = await Location.hasServicesEnabledAsync().catch(() => true);
  if (!services) return "unavailable";

  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== "granted") return "denied";

  const bg = await Location.requestBackgroundPermissionsAsync();
  return bg.status === "granted" ? "granted" : "foreground_only";
}

export async function locationPermissionState(): Promise<LocationPermissionState> {
  const fg = await Location.getForegroundPermissionsAsync();
  if (fg.status === "undetermined") return "undetermined";
  if (fg.status !== "granted") return fg.canAskAgain ? "undetermined" : "denied";
  const bg = await Location.getBackgroundPermissionsAsync();
  if (bg.status === "granted") return "granted";
  return bg.canAskAgain ? "foreground_only" : "foreground_only";
}

/** Deep-links to this app's page in the system Settings. */
export async function openLocationSettings(): Promise<void> {
  const { Linking } = await import("react-native");
  await Linking.openSettings();
}

export async function isTracking(): Promise<boolean> {
  try {
    return await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
  } catch {
    return false;
  }
}

export async function startTracking(): Promise<void> {
  if (await isTracking()) return;
  await Location.startLocationUpdatesAsync(LOCATION_TASK, {
    accuracy: Location.Accuracy.High,
    timeInterval: POSITION_INTERVAL_MS, // Android
    distanceInterval: 0,
    deferredUpdatesInterval: POSITION_INTERVAL_MS, // iOS batches while backgrounded
    showsBackgroundLocationIndicator: true,
    pausesUpdatesAutomatically: false,
    activityType: Location.ActivityType.AutomotiveNavigation,
    foregroundService: {
      notificationTitle: "Koolee is sharing your location",
      notificationBody: "Customers and dispatch can see you while you are on shift.",
      notificationColor: "#0B2545",
      killServiceOnDestroy: false,
    },
  });
  // A first fix right away, so the pin appears the moment the shift starts
  // rather than after the first background batch.
  try {
    const current = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });
    await recordLocations([current]);
  } catch {
    // The task will deliver one shortly.
  }
}

export async function stopTracking(): Promise<void> {
  if (await isTracking()) await Location.stopLocationUpdatesAsync(LOCATION_TASK);
  await disarmGeofence();
}

/** Android only: whether the OS may throttle our background work. */
export async function batteryOptimisationEnabled(): Promise<boolean> {
  if (Platform.OS !== "android") return false;
  try {
    const Battery = await import("expo-battery");
    return await Battery.isBatteryOptimizationEnabledAsync();
  } catch {
    return false;
  }
}

/**
 * Opens the system page where the driver can exempt Koolee. The settings
 * PAGE, not the direct request dialog: Play policy reserves the latter for
 * app categories this one is not in.
 */
export async function openBatteryOptimisationSettings(): Promise<void> {
  if (Platform.OS !== "android") return;
  const IntentLauncher = await import("expo-intent-launcher");
  await IntentLauncher.startActivityAsync(
    IntentLauncher.ActivityAction.IGNORE_BATTERY_OPTIMIZATION_SETTINGS,
  );
}
