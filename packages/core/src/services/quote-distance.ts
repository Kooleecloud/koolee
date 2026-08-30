import { eq } from "drizzle-orm";
import { airports, zipCentroids, type AirportCode } from "@koolee/db";

import type { CoreConfig } from "../config";
import { toCoordinates, type Coordinates } from "../geo/coordinates";
import { quoteDistanceKm, type QuoteDistance } from "../geo/distance";

/**
 * The door-to-airport distance a price is computed from, resolved against the
 * database.
 *
 * ONE call site's worth of reads (an airport row, a ZIP centroid) wrapped so
 * the funnel's four pricing moments cannot drift apart. Before this, all four
 * passed the literal `20` with a `TODO(maps)` beside it while the public
 * pricing page used real per-airport distances — a $2.70 disagreement on a JFK
 * trip, with the funnel quoting lower.
 *
 * Ordering, most specific first:
 *
 *  1. `pickup` — precise coordinates from Places autocomplete, when the
 *     address step captured them;
 *  2. the ZIP centroid — which every covered ZIP has (837 rows, and a guard
 *     test asserts coverage ⊂ centroids), so this is the ordinary path for a
 *     hand-typed address;
 *  3. the per-airport typical, from `TYPICAL_AIRPORT_DISTANCE_KM`.
 *
 * NEVER a network call — see the note in `geo/distance.ts`. A price is quoted
 * at the window picker, again on the review page and again inside
 * `createBooking`; a traffic-aware number would move between them.
 *
 * Degrades rather than throws: any failure gives the typical distance, which
 * is what the site quoted publicly for months. A database hiccup must not
 * refuse to price a booking.
 */
export async function resolveQuoteDistanceKm(
  config: CoreConfig,
  input: {
    airportCode: AirportCode;
    /** Five digits. ZIP+4 is sliced, the same way the rest of the funnel does. */
    zip?: string | null | undefined;
    /** Precise coordinates when the address has them. */
    pickup?: Coordinates | null | undefined;
  },
): Promise<QuoteDistance> {
  try {
    const [airportRow] = await config.db
      .select({ lat: airports.lat, lng: airports.lng })
      .from(airports)
      .where(eq(airports.code, input.airportCode))
      .limit(1);

    const airport = toCoordinates(airportRow?.lat, airportRow?.lng);

    let pickup = input.pickup ?? null;
    if (pickup === null && input.zip) {
      const [centroid] = await config.db
        .select({ lat: zipCentroids.lat, lng: zipCentroids.lng })
        .from(zipCentroids)
        .where(eq(zipCentroids.zip, input.zip.slice(0, 5)))
        .limit(1);
      pickup = toCoordinates(centroid?.lat, centroid?.lng);
    }

    return quoteDistanceKm({ airportCode: input.airportCode, pickup, airport });
  } catch (error) {
    console.error("[quote-distance] falling back to the typical distance", error);
    return quoteDistanceKm({ airportCode: input.airportCode });
  }
}
