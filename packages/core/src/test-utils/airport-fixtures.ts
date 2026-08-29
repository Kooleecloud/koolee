import type { NewAirport } from "@koolee/db";

/**
 * Airport rows for integration fixtures, in one place.
 *
 * Thirteen suites were each spelling `{ code, name, tz }` inline, so adding
 * `lat`/`lng` to `airports` (migration 0028, NOT NULL — three airports that
 * do not move should not push a null check into every ETA call site) broke
 * all thirteen at once. The next column will not.
 *
 * Coordinates match the seed and migration 0028: the passenger terminal
 * complex, not the airfield reference point.
 */
export const TEST_AIRPORTS = {
  JFK: {
    code: "JFK",
    name: "John F. Kennedy International",
    tz: "America/New_York",
    lat: 40.6446,
    lng: -73.7797,
  },
  LGA: {
    code: "LGA",
    name: "LaGuardia",
    tz: "America/New_York",
    lat: 40.7743,
    lng: -73.8722,
  },
  EWR: {
    code: "EWR",
    name: "Newark Liberty International",
    tz: "America/New_York",
    lat: 40.6895,
    lng: -74.1787,
  },
} as const satisfies Record<string, NewAirport>;
