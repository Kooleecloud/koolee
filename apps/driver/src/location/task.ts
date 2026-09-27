import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";

import "@/lib/supabase";

import { enqueuePositions, flushPositions } from "./queue";

/**
 * The background location task. Defined at module scope (imported from the
 * entry file) because the OS delivers batches to a headless JS context where
 * no screen has ever rendered — a `defineTask` inside a component would never
 * be registered when it matters.
 *
 * Each batch is written to the SQLite queue FIRST and only then sent. If the
 * send fails (tunnel, server down) nothing is lost; the next batch, or the
 * next foreground flush, carries it. Fix time is the device's `timestamp`,
 * which is what the server orders on.
 */
export const LOCATION_TASK = "koolee-driver-location";

/**
 * A single geofence around the last known position, re-armed on every batch.
 *
 * WHY. If a driver force-quits the app, continuous updates stop on both
 * platforms and there is no significant-change API in expo-location to bring
 * the app back. A geofence is the one thing iOS WILL relaunch a terminated
 * app for: leaving a 250 m circle around the last fix wakes us, we send one
 * position and arm a new circle. It degrades a dead app into a coarse track
 * rather than silence. Android does not relaunch a terminated app for a
 * geofence; there the foreground service is the mechanism, and force-stop
 * is final.
 */
export const GEOFENCE_TASK = "koolee-driver-geofence";
export const GEOFENCE_RADIUS_M = 250;

interface LocationTaskData {
  locations: Location.LocationObject[];
}

TaskManager.defineTask(LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    console.warn("[location] task error", error.message);
    return;
  }
  const locations = (data as LocationTaskData | undefined)?.locations ?? [];
  if (locations.length === 0) return;
  await recordLocations(locations);
});

TaskManager.defineTask(GEOFENCE_TASK, async ({ data, error }) => {
  if (error) return;
  const event = data as { eventType: Location.GeofencingEventType } | undefined;
  if (event?.eventType !== Location.GeofencingEventType.Exit) return;
  try {
    const current = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    await recordLocations([current]);
  } catch (err) {
    console.warn("[location] geofence wake could not read a position", err);
  }
});

export async function recordLocations(
  locations: readonly Location.LocationObject[],
): Promise<void> {
  await enqueuePositions(
    locations.map((l) => ({
      lat: l.coords.latitude,
      lng: l.coords.longitude,
      recordedAt: new Date(l.timestamp).toISOString(),
    })),
  );
  const newest = locations[locations.length - 1];
  if (newest) await armGeofence(newest.coords.latitude, newest.coords.longitude);
  await flushPositions();
}

export async function armGeofence(latitude: number, longitude: number): Promise<void> {
  try {
    await Location.startGeofencingAsync(GEOFENCE_TASK, [
      {
        identifier: "last-fix",
        latitude,
        longitude,
        radius: GEOFENCE_RADIUS_M,
        notifyOnEnter: false,
        notifyOnExit: true,
      },
    ]);
  } catch (err) {
    // Geofencing needs background permission; without it the continuous
    // updates are all we have, and that is still the common case on Android.
    console.warn("[location] geofence not armed", err);
  }
}

export async function disarmGeofence(): Promise<void> {
  try {
    if (await Location.hasStartedGeofencingAsync(GEOFENCE_TASK)) {
      await Location.stopGeofencingAsync(GEOFENCE_TASK);
    }
  } catch {
    // nothing to stop
  }
}
