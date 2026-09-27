import * as React from "react";
import * as Location from "expo-location";

/**
 * One position fix for the step being taken, the web flow's `useGps()`:
 * one read on mount, low accuracy, five seconds, null on anything else.
 *
 * The fix is EVIDENCE, not navigation — it stamps the custody event with
 * where the phone was when the driver tapped — so a cell-tower answer is
 * good enough and waiting on GPS lock in a lobby is not. It never prompts:
 * the shift flow already asked for location, and a system dialog popping up
 * under a driver's thumb as they go to tap "I'm on the way" is how the wrong
 * button gets pressed. Not granted means no fix, and the step still goes.
 */
export interface Gps {
  lat: number;
  lng: number;
}

const FIX_TIMEOUT_MS = 5_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export async function currentGps(): Promise<Gps | null> {
  try {
    const permission = await Location.getForegroundPermissionsAsync();
    if (permission.status !== "granted") return null;
    const fix = await withTimeout(
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low }),
      FIX_TIMEOUT_MS,
    );
    if (!fix) return null;
    const { latitude: lat, longitude: lng } = fix.coords;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  } catch {
    return null;
  }
}

export function useGps(): Gps | null {
  const [coords, setCoords] = React.useState<Gps | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    void currentGps().then((fix) => {
      if (!cancelled) setCoords(fix);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return coords;
}

/** The `gpsSchema` half of a step body. Null is "no fix", which the server accepts. */
export function gpsBody(coords: Gps | null): { lat: number | null; lng: number | null } {
  return { lat: coords?.lat ?? null, lng: coords?.lng ?? null };
}
