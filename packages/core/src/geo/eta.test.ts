import { describe, expect, it } from "vitest";

import { haversineKm, toCoordinates, type Coordinates } from "./coordinates";
import { formatEtaRange, HaversineEtaEstimator } from "./eta";
import { createEtaEstimator } from "./factory";

/** Terminal coordinates, matching the seed and migration 0028. */
const JFK: Coordinates = { lat: 40.6446, lng: -73.7797 };
const LGA: Coordinates = { lat: 40.7743, lng: -73.8722 };
const EWR: Coordinates = { lat: 40.6895, lng: -74.1787 };
/** ZIP centroids from `zip-centroids.ts`. */
const MIDTOWN_10018: Coordinates = { lat: 40.75544, lng: -73.9927 };
const WILLIAMSBURG_11211: Coordinates = { lat: 40.71277, lng: -73.95371 };

describe("haversineKm", () => {
  it("is zero for a point against itself", () => {
    expect(haversineKm(JFK, JFK)).toBe(0);
  });

  it("is symmetric", () => {
    expect(haversineKm(JFK, EWR)).toBeCloseTo(haversineKm(EWR, JFK), 9);
  });

  // Published great-circle distances, checked to the kilometre. These are the
  // sanity bounds: a transposed lat/lng or a degrees/radians slip fails here
  // long before anyone sees a wrong ETA.
  it.each([
    ["Midtown → JFK", MIDTOWN_10018, JFK, 21.8],
    ["Midtown → LGA", MIDTOWN_10018, LGA, 10.4],
    ["Midtown → EWR", MIDTOWN_10018, EWR, 17.3],
    ["JFK → EWR", JFK, EWR, 34.0],
    ["Williamsburg → JFK", WILLIAMSBURG_11211, JFK, 16.5],
  ])("%s is about %s km", (_label, from, to, expected) => {
    expect(haversineKm(from, to)).toBeCloseTo(expected as number, 0);
  });

  it("does not confuse latitude with longitude", () => {
    const transposed = { lat: MIDTOWN_10018.lng, lng: MIDTOWN_10018.lat };
    expect(haversineKm(transposed, JFK)).toBeGreaterThan(1000);
  });
});

describe("toCoordinates", () => {
  it("returns a point when both halves are present", () => {
    expect(toCoordinates(40.5, -74)).toEqual({ lat: 40.5, lng: -74 });
  });

  it.each([
    ["both null", null, null],
    ["lat only", 40.5, null],
    ["lng only", null, -74],
    ["undefined", undefined, undefined],
    ["NaN", Number.NaN, -74],
  ])("returns null for %s", (_label, lat, lng) => {
    expect(toCoordinates(lat, lng)).toBeNull();
  });

  it("treats 0 as a real coordinate, not as absent", () => {
    expect(toCoordinates(0, 0)).toEqual({ lat: 0, lng: 0 });
  });
});

describe("HaversineEtaEstimator", () => {
  const estimator = new HaversineEtaEstimator();

  it("floors at five minutes for a driver already at the door", () => {
    expect(estimator.estimate({ from: JFK, to: JFK })).toEqual({
      minMinutes: 5,
      maxMinutes: 10,
    });
  });

  it("always returns a range, never a point", () => {
    for (const to of [JFK, LGA, EWR, WILLIAMSBURG_11211]) {
      const eta = estimator.estimate({ from: MIDTOWN_10018, to });
      expect(eta.maxMinutes).toBeGreaterThan(eta.minMinutes);
    }
  });

  it("returns whole five-minute steps at both ends", () => {
    for (const to of [JFK, LGA, EWR, WILLIAMSBURG_11211]) {
      const eta = estimator.estimate({ from: MIDTOWN_10018, to });
      expect(eta.minMinutes % 5).toBe(0);
      expect(eta.maxMinutes % 5).toBe(0);
    }
  });

  /**
   * Short hops — a driver already inside the customer's zone, which is the
   * only case a customer ever reads. Bounds are what a person would accept
   * looking at a map of Manhattan-to-Brooklyn in traffic.
   */
  it.each([
    ["Midtown → Williamsburg (5.8 km)", MIDTOWN_10018, WILLIAMSBURG_11211, 15, 45],
    ["Midtown → LGA (10.4 km)", MIDTOWN_10018, LGA, 30, 75],
  ])("%s lands between %s and %s minutes", (_label, from, to, low, high) => {
    const eta = estimator.estimate({ from, to });
    expect(eta.minMinutes).toBeGreaterThanOrEqual(low as number);
    expect(eta.maxMinutes).toBeLessThanOrEqual(high as number);
  });

  /**
   * Long hops run PESSIMISTIC and this test pins that rather than hiding it.
   * Midtown → JFK is ~50 minutes in real traffic; 18 km/h says 75–145. The
   * average-city-speed model has no notion of a highway, so the further the
   * run the more it over-states.
   *
   * That is the safe direction for both consumers and it is why the constant
   * has not been split in two:
   *  - the customer-facing card only ever shows a driver already in zone, a
   *    few kilometres out, where the model is realistic (the case above);
   *  - `cutoffRiskMonitor` uses the pickup → airport leg, where over-stating
   *    the drive makes the alert fire EARLY, which is the whole point of it.
   * A routing provider behind the same seam is what fixes the middle ground.
   */
  it("over-states a long airport run, deliberately", () => {
    const eta = estimator.estimate({ from: MIDTOWN_10018, to: JFK });
    expect(eta).toEqual({ minMinutes: 75, maxMinutes: 145 });
  });

  it("is monotonic — a farther point never estimates sooner", () => {
    const near = estimator.estimate({ from: MIDTOWN_10018, to: LGA });
    const far = estimator.estimate({ from: MIDTOWN_10018, to: JFK });
    expect(far.minMinutes).toBeGreaterThan(near.minMinutes);
    expect(far.maxMinutes).toBeGreaterThan(near.maxMinutes);
  });

  it("brackets the raw estimate it is derived from", () => {
    const rawMinutes =
      ((haversineKm(MIDTOWN_10018, JFK) * HaversineEtaEstimator.ROAD_FACTOR) /
        HaversineEtaEstimator.AVERAGE_SPEED_KMH) *
      60;
    const eta = estimator.estimate({ from: MIDTOWN_10018, to: JFK });
    expect(eta.minMinutes).toBeLessThanOrEqual(rawMinutes);
    expect(eta.maxMinutes).toBeGreaterThanOrEqual(rawMinutes);
  });
});

describe("createEtaEstimator", () => {
  it("builds the haversine estimator", () => {
    expect(createEtaEstimator({ kind: "haversine" })).toBeInstanceOf(HaversineEtaEstimator);
  });
});

describe("formatEtaRange", () => {
  it("renders a range", () => {
    expect(formatEtaRange({ minMinutes: 20, maxMinutes: 30 })).toBe("20–30 min");
  });

  it("says the ETA is on the way when there is no position to work from", () => {
    expect(formatEtaRange(null)).toBe("ETA on the way");
  });
});
