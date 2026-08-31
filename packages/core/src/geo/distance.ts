import { haversineKm, type Coordinates } from "./coordinates";

/**
 * The distance a price is computed from — ONE definition, for the funnel and
 * the public estimator both.
 *
 * Before this module there were two, and they disagreed. Four funnel call
 * sites passed the literal `20` km (each marked `TODO(maps)`), while the
 * marketing page priced JFK at 26 km, LGA at 13 and EWR at 19. At 45¢/km that
 * is up to $2.70 between the price a visitor is quoted on the pricing page and
 * the price the same trip costs inside the funnel — with the funnel quoting
 * LOWER for JFK, so the public number was the one that looked wrong.
 *
 * **This is geometry, never a network call, and that is deliberate.** The ETA
 * seam may ask a routing provider; the PRICE may not. A booking is priced at
 * the window picker, re-priced on the review page, and priced again inside
 * `createBooking` — three moments, minutes apart. If those numbers came from a
 * traffic-aware API they would differ, and a customer would watch the total
 * move between the page that quoted it and the charge. Determinism is worth
 * more here than accuracy to the kilometre, and the pricing engine's
 * `distanceMultiplier` is a blunt 45¢ instrument regardless.
 */

/**
 * Typical door-to-airport drive distance per airport, in km.
 *
 * The fallback when there is no coordinate to work from — a draft that has
 * only an airport (the marketing estimator, which cannot read the database at
 * all), or a ZIP with no centroid row. These are the values the public pricing
 * page has always used; they now live here so both sides read the same
 * numbers instead of one side reading a copy.
 */
export const TYPICAL_AIRPORT_DISTANCE_KM: Record<string, number> = {
  JFK: 26,
  LGA: 13,
  EWR: 19,
};

/** For an airport that is not in the table — a fourth airport, before anybody measures it. */
export const FALLBACK_DISTANCE_KM = 20;

/**
 * Great-circle → road, for PRICING. 1.2, and deliberately not the ETA
 * estimator's 1.5.
 *
 * The two factors answer different questions. `HaversineEtaEstimator`'s 1.5 is
 * part of a TIME model for a dense surface-street grid with water crossings,
 * and it is allowed to run pessimistic because over-stating a drive is the
 * safe direction for both of its consumers. A price is not allowed to run
 * pessimistic — it is money, and it has to agree with the number the public
 * pricing page shows.
 *
 * So this one is calibrated against the very distances that page publishes,
 * from a mid-service-area origin (Midtown, 10018):
 *
 * | Airport | great-circle | published typical | implied factor |
 * | ------- | -----------: | ----------------: | -------------: |
 * | JFK     |      21.8 km |             26 km |           1.19 |
 * | LGA     |      10.4 km |             13 km |           1.25 |
 * | EWR     |      17.3 km |             19 km |           1.10 |
 *
 * 1.2 reproduces all three within about a kilometre (Midtown → JFK lands on
 * 26.1 against the published 26), so a hand-typed Midtown ZIP now prices
 * within pennies of the public quote instead of $2.70 under it.
 * The airport runs are mostly parkway and turnpike, which is why the circuity
 * is lower than the ETA model's city-street figure — the same reason 18 km/h
 * over-states those runs.
 */
export const PRICING_ROAD_FACTOR = 1.2;

export type QuoteDistanceSource = "coordinates" | "typical" | "fallback";

export interface QuoteDistance {
  km: number;
  source: QuoteDistanceSource;
}

/**
 * Kilometres for `PriceInput.distanceKm`.
 *
 * With both ends known: great-circle × `PRICING_ROAD_FACTOR`. Rounded to one
 * decimal because `distanceCents = round(multiplier × km)` and nobody should
 * see a price move on the fourth decimal place of a centroid.
 *
 * With no pickup coordinate: the per-airport typical. Which is exactly what
 * the customer is being told — "Travel to JFK (typical)".
 */
export function quoteDistanceKm(input: {
  airportCode: string;
  pickup?: Coordinates | null;
  airport?: Coordinates | null;
}): QuoteDistance {
  if (input.pickup && input.airport) {
    const km = haversineKm(input.pickup, input.airport) * PRICING_ROAD_FACTOR;
    return { km: Math.round(km * 10) / 10, source: "coordinates" };
  }

  const typical = TYPICAL_AIRPORT_DISTANCE_KM[input.airportCode];
  return typical === undefined
    ? { km: FALLBACK_DISTANCE_KM, source: "fallback" }
    : { km: typical, source: "typical" };
}
