import { describe, expect, it } from "vitest";

import { formatMiles } from "./coordinates";

import type { Coordinates } from "./coordinates";
import {
  FALLBACK_DISTANCE_KM,
  PRICING_ROAD_FACTOR,
  quoteDistanceKm,
  TYPICAL_AIRPORT_DISTANCE_KM,
} from "./distance";

const JFK: Coordinates = { lat: 40.6446, lng: -73.7797 };
const MIDTOWN_10018: Coordinates = { lat: 40.75544, lng: -73.9927 };

describe("quoteDistanceKm", () => {
  it("measures the real thing when both ends are known", () => {
    const result = quoteDistanceKm({
      airportCode: "JFK",
      pickup: MIDTOWN_10018,
      airport: JFK,
    });

    expect(result.source).toBe("coordinates");
    // 21.8 km great-circle × the 1.2 pricing road factor = 26.1, against the
    // 26 km the public pricing page has always shown for JFK. That agreement
    // is the point of this module: the funnel used to price the same trip at
    // 20 km, $2.70 under the public quote.
    expect(result.km).toBe(26.1);
  });

  it("rounds to a tenth of a kilometre, so a price never moves on a centroid's fourth decimal", () => {
    const { km } = quoteDistanceKm({
      airportCode: "JFK",
      pickup: MIDTOWN_10018,
      airport: JFK,
    });
    expect(km * 10).toBe(Math.round(km * 10));
  });

  it.each([
    ["JFK", 26],
    ["LGA", 13],
    ["EWR", 19],
  ])("falls back to the typical %s distance with no coordinates", (code, expected) => {
    expect(quoteDistanceKm({ airportCode: code })).toEqual({
      km: expected,
      source: "typical",
    });
  });

  it("falls back to the typical distance when only one end is known", () => {
    expect(quoteDistanceKm({ airportCode: "LGA", pickup: MIDTOWN_10018 })).toEqual({
      km: 13,
      source: "typical",
    });
    expect(quoteDistanceKm({ airportCode: "LGA", airport: JFK })).toEqual({
      km: 13,
      source: "typical",
    });
  });

  it("has a last resort for an airport nobody has measured yet", () => {
    expect(quoteDistanceKm({ airportCode: "BOS" })).toEqual({
      km: FALLBACK_DISTANCE_KM,
      source: "fallback",
    });
  });

  it.each([
    ["JFK", { lat: 40.6446, lng: -73.7797 }, 26],
    ["LGA", { lat: 40.7743, lng: -73.8722 }, 13],
    ["EWR", { lat: 40.6895, lng: -74.1787 }, 19],
  ])(
    "measures %s from Midtown within a kilometre of the published typical",
    (code, airport, typical) => {
      // The calibration behind PRICING_ROAD_FACTOR. If somebody retunes the
      // factor, this is what tells them the public page and the funnel have
      // started to disagree again.
      const { km } = quoteDistanceKm({
        airportCode: code as string,
        pickup: MIDTOWN_10018,
        airport: airport as Coordinates,
      });
      expect(Math.abs(km - (typical as number))).toBeLessThanOrEqual(2);
    },
  );

  it("prices with a gentler road factor than the ETA model, on purpose", () => {
    expect(PRICING_ROAD_FACTOR).toBeLessThan(1.5);
  });

  it("covers every airport the product sells", () => {
    // If a fourth airport is ever added, this fails until somebody measures a
    // typical distance for it rather than letting it quietly price at 20 km.
    expect(Object.keys(TYPICAL_AIRPORT_DISTANCE_KM).sort()).toEqual([
      "EWR",
      "JFK",
      "LGA",
    ]);
  });
});

describe("formatMiles", () => {
  /**
   * Kilometres stay the internal unit — pricing, the centroids, the haversine.
   * This is only about the sentence a customer standing in Manhattan reads.
   */
  it("converts and reads as miles", () => {
    expect(formatMiles(5)).toBe("3.1 miles");
    expect(formatMiles(1.609)).toBe("1 mile");
  });

  it("drops the decimal above ten miles — the estimate does not deserve it", () => {
    // The input is often a ZIP centroid; "12.4 miles" is false precision.
    expect(formatMiles(20)).toBe("12 miles");
  });

  it("does not render a driver at the door as zero", () => {
    expect(formatMiles(0.05)).toBe("less than 0.1 miles");
  });
});
