import { haversineKm, type Coordinates } from "./coordinates";

/**
 * Drive-time estimation, as a seam.
 *
 * Koolee has no routing provider. The one implementation here derives a
 * number from two coordinates and a pair of constants; a real Maps or traffic
 * API would implement the same interface and change nothing above it. Nothing
 * in core reads the environment, so the choice is injected through
 * `createRuntime` like the notifier and the payment provider.
 *
 * The result is a RANGE, never a single number, and that is the important
 * part of the contract. An estimate built from ZIP centroids and an average
 * speed is not accurate to the minute and must not be rendered as though it
 * were — "20–30 min" is honest about its own resolution in a way "24 min" is
 * not.
 */
export interface EtaRange {
  minMinutes: number;
  maxMinutes: number;
}

export interface EtaQuery {
  from: Coordinates;
  to: Coordinates;
}

export interface EtaEstimator {
  estimate(query: EtaQuery): EtaRange;
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
  static readonly ROAD_FACTOR = 1.5;
  static readonly AVERAGE_SPEED_KMH = 18;
  static readonly FLOOR_MINUTES = 5;
  static readonly SPREAD = 0.3;
  static readonly STEP_MINUTES = 5;

  estimate(query: EtaQuery): EtaRange {
    const roadKm = haversineKm(query.from, query.to) * HaversineEtaEstimator.ROAD_FACTOR;
    const rawMinutes = (roadKm / HaversineEtaEstimator.AVERAGE_SPEED_KMH) * 60;
    const centre = Math.max(rawMinutes, HaversineEtaEstimator.FLOOR_MINUTES);

    const step = HaversineEtaEstimator.STEP_MINUTES;
    const spread = HaversineEtaEstimator.SPREAD;

    const minMinutes = Math.max(
      HaversineEtaEstimator.FLOOR_MINUTES,
      Math.floor((centre * (1 - spread)) / step) * step,
    );
    const maxMinutes = Math.max(
      minMinutes + step,
      Math.ceil((centre * (1 + spread)) / step) * step,
    );

    return { minMinutes, maxMinutes };
  }
}

/** Renders a range for a customer. Never a bare number — see `EtaRange`. */
export function formatEtaRange(eta: EtaRange | null): string {
  if (eta === null) return "ETA on the way";
  return `${eta.minMinutes}–${eta.maxMinutes} min`;
}
