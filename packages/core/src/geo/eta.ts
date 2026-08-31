import { haversineKm, type Coordinates } from "./coordinates";

/**
 * Drive-time estimation, as a seam.
 *
 * Two implementations: the arithmetic one below, which needs no credentials
 * and is what a fresh clone runs, and `GoogleRoutesEtaEstimator` (routes.ts),
 * which asks a traffic-aware routing API. Nothing in core reads the
 * environment, so the choice is injected through `createRuntime` like the
 * notifier and the payment provider.
 *
 * The result is a RANGE, never a single number, and that is the important
 * part of the contract. An estimate built from ZIP centroids and an average
 * speed is not accurate to the minute and must not be rendered as though it
 * were — "20–30 min" is honest about its own resolution in a way "24 min" is
 * not. A routing provider narrows the range; it does not remove it, because
 * traffic between now and arrival is not a number anybody has.
 *
 * **`estimate` IS ASYNC, and the haversine implementation is synchronous
 * underneath.** The interface is async because a routing provider is a
 * network call; the arithmetic one resolves immediately. That asymmetry is
 * the point of a seam.
 *
 * **ETA IS NEVER LOAD-BEARING.** No booking, price, gate or transition
 * depends on one. Every implementation must therefore degrade rather than
 * throw: `GoogleRoutesEtaEstimator` falls back to haversine on any failure,
 * and the two consumers that render one already handle `null`.
 */
export interface EtaRange {
  minMinutes: number;
  maxMinutes: number;
}

export interface EtaQuery {
  from: Coordinates;
  to: Coordinates;
}

/**
 * Many origins, ONE destination — the driver-shortlist shape, and the shape a
 * route-matrix API is built for.
 *
 * It exists so the shortlist is one call rather than four. `toCandidate` used
 * to sit inside an `Array.map`; with a network provider behind the seam that
 * would have been four serial round-trips on a page render, which is how an
 * estimate that is explicitly not load-bearing becomes the slowest thing on
 * the page.
 */
export interface EtaBatchQuery {
  from: readonly Coordinates[];
  to: Coordinates;
}

export type EtaEstimatorKind = "haversine" | "google-routes";

export interface EtaEstimator {
  /**
   * Which implementation this is — for logs and ops alert detail, never for
   * branching. A per-call fallback inside `GoogleRoutesEtaEstimator` does not
   * change it, so read it as "what was configured", not "what answered".
   */
  readonly kind: EtaEstimatorKind;
  estimate(query: EtaQuery): Promise<EtaRange>;
  /** Aligned to `query.from`, index for index. Empty in, empty out. */
  estimateMany(query: EtaBatchQuery): Promise<EtaRange[]>;
}

/**
 * How a centre estimate becomes a range.
 *
 * Split out because both implementations need identical rounding semantics —
 * whole 5-minute steps at both ends, a floor, and `max > min` always — while
 * disagreeing about how wide the band should be. Six assertions in
 * `eta.test.ts` and both render paths depend on those semantics; only the
 * spreads are an implementation's business.
 *
 * The two spreads are separate because uncertainty in a drive time is NOT
 * symmetric. A route can always take longer than predicted — an incident, a
 * bridge, a double-parked truck — and essentially never takes dramatically
 * less. The haversine model happens to use the same number for both; the
 * routing provider does not.
 */
export interface EtaRangeShape {
  lowSpread: number;
  highSpread: number;
  floorMinutes: number;
  stepMinutes: number;
}

export function toEtaRange(centreMinutes: number, shape: EtaRangeShape): EtaRange {
  const { lowSpread, highSpread, floorMinutes, stepMinutes: step } = shape;
  const centre = Math.max(centreMinutes, floorMinutes);

  const minMinutes = Math.max(
    floorMinutes,
    Math.floor((centre * (1 - lowSpread)) / step) * step,
  );
  const maxMinutes = Math.max(
    minMinutes + step,
    Math.ceil((centre * (1 + highSpread)) / step) * step,
  );

  return { minMinutes, maxMinutes };
}

/**
 * Straight-line distance, inflated to a road distance, divided by an average
 * city speed.
 *
 * Every constant is a judgement, so each says what it is:
 *
 *  - `ROAD_FACTOR = 1.5` — the classic circuity factor for a dense grid with
 *    water crossings. Manhattan-to-JFK straight-line is ~19 km and the drive
 *    is ~28 km, which is where 1.5 comes from.
 *  - `AVERAGE_SPEED_KMH = 18` — NYC-metro surface-street average including
 *    lights, tunnels and the last block. It has no notion of a highway, so it
 *    is realistic over a few kilometres and PESSIMISTIC over a long airport
 *    run: Midtown → JFK reads 75–145 min against a real ~50. That bias is
 *    left in on purpose, because it points the safe way for both consumers —
 *    the customer card only ever shows a driver already in zone (short hop,
 *    realistic), and `cutoffRiskMonitor` uses the pickup → airport leg, where
 *    over-stating the drive makes the alert fire EARLY. `eta.test.ts` pins
 *    both halves so the trade-off cannot drift silently. A routing provider
 *    behind this seam is what fixes the middle ground.
 *  - `FLOOR_MINUTES = 5` — nobody is anywhere in under five minutes, and a
 *    driver two blocks away should not read as "0 min".
 *  - `SPREAD = 0.3` — ±30%, then widened out to whole 5-minute steps (down
 *    for the low end, up for the high end) so rounding never makes the range
 *    look tighter than the estimate deserves.
 */
export class HaversineEtaEstimator implements EtaEstimator {
  readonly kind = "haversine" as const;

  static readonly ROAD_FACTOR = 1.5;
  static readonly AVERAGE_SPEED_KMH = 18;
  static readonly FLOOR_MINUTES = 5;
  static readonly SPREAD = 0.3;
  static readonly STEP_MINUTES = 5;

  static readonly SHAPE: EtaRangeShape = {
    lowSpread: HaversineEtaEstimator.SPREAD,
    highSpread: HaversineEtaEstimator.SPREAD,
    floorMinutes: HaversineEtaEstimator.FLOOR_MINUTES,
    stepMinutes: HaversineEtaEstimator.STEP_MINUTES,
  };

  estimate(query: EtaQuery): Promise<EtaRange> {
    return Promise.resolve(this.estimateSync(query));
  }

  estimateMany(query: EtaBatchQuery): Promise<EtaRange[]> {
    return Promise.resolve(
      query.from.map((from) => this.estimateSync({ from, to: query.to })),
    );
  }

  /**
   * The arithmetic, with no promise around it.
   *
   * Public because `GoogleRoutesEtaEstimator` falls back to it — one
   * implementation of the fallback, not a second copy of these constants —
   * and because the tests that pin the constants should not have to await
   * arithmetic.
   */
  estimateSync(query: EtaQuery): EtaRange {
    const roadKm = haversineKm(query.from, query.to) * HaversineEtaEstimator.ROAD_FACTOR;
    const rawMinutes = (roadKm / HaversineEtaEstimator.AVERAGE_SPEED_KMH) * 60;
    return toEtaRange(rawMinutes, HaversineEtaEstimator.SHAPE);
  }
}

/** Renders a range for a customer. Never a bare number — see `EtaRange`. */
export function formatEtaRange(eta: EtaRange | null): string {
  if (eta === null) return "ETA on the way";
  return `${eta.minMinutes}–${eta.maxMinutes} min`;
}
