import { sql } from "drizzle-orm";
import { check, doublePrecision, pgTable, varchar } from "drizzle-orm/pg-core";

/**
 * ZIP → centroid, as static reference data.
 *
 * The cheapest geo primitive that unblocks a distance estimate: Koolee has no
 * geocoder, so a pickup address resolves to the middle of its ZIP and an ETA
 * is computed from there. Deliberately coarse — a ZIP centroid answers
 * "roughly how far away is this driver", never "which door".
 *
 * Keyed by the ZIP itself rather than a surrogate uuid, for the same reason
 * `airports` is keyed by IATA code: the ZIP is already a stable natural key
 * and it makes every join readable in raw SQL.
 *
 * Loaded from `@koolee/db/zip-centroids` (US Census ZCTA gazetteer) by the
 * seed, and by migration 0028 so the address backfill in that migration has
 * something to join against. Re-seeding reconciles the table to the file.
 *
 * NOT a service-area definition. `coverage-zips.ts` decides where Koolee
 * sells; this table only says where a ZIP is, and holds a wider NY/NJ metro
 * area than coverage does on purpose.
 */
export const zipCentroids = pgTable(
  "zip_centroids",
  {
    zip: varchar("zip", { length: 5 }).primaryKey(),
    lat: doublePrecision("lat").notNull(),
    lng: doublePrecision("lng").notNull(),
  },
  (t) => [
    // A transposed lat/lng is the classic import bug and it is silent: the
    // haversine still returns a number, just one pointing at Antarctica.
    check("zip_centroids_lat_range_check", sql`${t.lat} between -90 and 90`),
    check("zip_centroids_lng_range_check", sql`${t.lng} between -180 and 180`),
  ],
);

export type ZipCentroidRow = typeof zipCentroids.$inferSelect;
export type NewZipCentroidRow = typeof zipCentroids.$inferInsert;
