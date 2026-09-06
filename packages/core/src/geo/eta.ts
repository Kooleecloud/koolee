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

/**
 * The range, spelled out. For OPERATORS and logs — the admin console and the
 * cutoff monitor's alert detail, where the width of the band is information.
 *
 * Its `null` wording differs from the customer's on purpose. "Locating…" is
 * reassurance, which is the right note for somebody waiting on their bags; an
 * operator reading an alert wants the fact, and the fact is that there is no
 * position on file.
 */
export function formatEtaRange(eta: EtaRange | null): string {
  if (eta === null) return "No position yet";
  return `${eta.minMinutes}–${eta.maxMinutes} min`;
}

/**
 * The number a CUSTOMER reads.
 *
 * WHY THIS IS ONE NUMBER AND THE RANGE STAYS INTERNAL. A range is the honest
 * shape of the estimate and the monitor needs its pessimistic end — that has
 * not changed, and `EtaRange` is still what every estimator returns. But
 * "40–75 min" on a trip page is not honesty, it is a refusal to answer: the
 * question somebody watching a van is asking is "when do I need to be at the
 * door", and a 35-minute band means they have to be at the door for the whole
 * band. Every delivery app in the world answers with a number, and so do we.
 *
 * The number LEANS LATE — 60% of the way up the band, not the midpoint —
 * because the two errors are not symmetric. Being ready early costs a customer
 * a few minutes; being told 40 and answering the door at 70 is the failure
 * they remember. Rounded to 5 so it never claims a precision the estimate
 * does not have.
 *
 * `null` is a real state — no fresh position for this driver — and says so
 * rather than inventing a number.
 *
 * IT USED TO SAY "ETA on the way", which TD is right to call meaningless: it
 * reads as though an ETA is being delivered by courier. Worse, the customer it
 * is shown to is choosing between drivers, and a phrase they cannot parse
 * beside another driver's "about 15 min" reads as *worse*, when the truth is
 * only that we cannot see this one yet.
 *
 * "Locating…" is what it says now. Three syllables, understood from every map
 * app anybody has used, and TRUE rather than merely short: the driver's phone
 * reports every 20–45 seconds while their shift is open, so an absent position
 * genuinely is one we are in the middle of getting.
 */
export function formatEtaMinutes(eta: EtaRange | null): string {
  if (eta === null) return "Locating…";
  return `about ${etaDisplayMinutes(eta)} min`;
}

/** The single number behind {@link formatEtaMinutes}. Exported for tests. */
export function etaDisplayMinutes(eta: EtaRange): number {
  const leaning = eta.minMinutes + (eta.maxMinutes - eta.minMinutes) * 0.6;
  return Math.max(5, Math.round(leaning / 5) * 5);
}
