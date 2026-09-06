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

/** Statute miles per kilometre. */
const MILES_PER_KM = 0.621371;

/**
 * Distance as a customer in New York reads it.
 *
 * KILOMETRES ARE AN INTERNAL UNIT HERE. Every distance in the system is stored
 * and priced in km — the pricing rule is cents per km, the ZIP centroids and
 * the haversine are metric, and none of that changes. But the customer-facing
 * "3.2 km away" line on the trip page was the only place in a US product that
 * quoted a metric distance to somebody standing in Manhattan waiting for a van.
 *
 * One decimal under ten miles, whole miles above: "0.8 miles" is a useful
 * number and "12.4 miles" is false precision on an estimate whose input is a
 * ZIP centroid.
 */
export function formatMiles(km: number): string {
  const miles = km * MILES_PER_KM;
  if (miles < 0.1) return "less than 0.1 miles";
  // A trailing ".0" is noise on a number this coarse — "1.0 mile" reads as a
  // measurement, and this is an estimate.
  const value =
    miles < 10 ? miles.toFixed(1).replace(/\.0$/, "") : String(Math.round(miles));
  return `${value} ${value === "1" ? "mile" : "miles"}`;
}
