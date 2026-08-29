/**
 * A point on the earth. WGS-84 decimal degrees, the same convention every
 * coordinate in the database uses (`addresses.lat/lng`, `airports.lat/lng`,
 * `zip_centroids`, `driver_positions`).
 */
export interface Coordinates {
  lat: number;
  lng: number;
}

/**
 * Narrows a possibly-absent pair into a `Coordinates`, or null.
 *
 * Every coordinate Koolee holds outside `airports` is nullable — an address
 * whose ZIP has no centroid, a driver who has not pinged yet — so the "do we
 * have a point at all" question is asked at almost every call site. Having
 * one helper for it keeps the answer from being spelled four different ways.
 */
export function toCoordinates(
  lat: number | null | undefined,
  lng: number | null | undefined,
): Coordinates | null {
  if (lat === null || lat === undefined || lng === null || lng === undefined) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

const EARTH_RADIUS_KM = 6371.0088;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/**
 * Great-circle distance in kilometres.
 *
 * Straight-line, so it is always an under-estimate of a drive — the road
 * factor in `HaversineEtaEstimator` is what turns it into something a driver
 * would recognise. Accurate to roughly 0.5% over NYC-metro distances, which
 * is far tighter than the ZIP-centroid inputs deserve.
 */
export function haversineKm(from: Coordinates, to: Coordinates): number {
  const dLat = toRadians(to.lat - from.lat);
  const dLng = toRadians(to.lng - from.lng);
  const lat1 = toRadians(from.lat);
  const lat2 = toRadians(to.lat);

  const a =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}
