import { describe, expect, it } from "vitest";

import { ZIP_CENTROIDS, zipCentroid } from "@koolee/db/zip-centroids";

import { COVERAGE_ZIPS } from "../coverage";

/**
 * The contract this file protects: every ZIP Koolee SELLS in has a centroid.
 *
 * A missing centroid is not a crash — the address keeps NULL coordinates and
 * the ETA renders "ETA on the way" — it is a silent downgrade of driver
 * selection for everyone in that ZIP. Widening the coverage allowlist without
 * regenerating the dataset is exactly how that would happen, so it fails here
 * instead. (The test lives in core rather than db because db carries no test
 * runner and this assertion needs both lists.)
 */
describe("ZIP centroids", () => {
  it("covers every ZIP in the coverage allowlist", () => {
    const missing = [...COVERAGE_ZIPS].filter((zip) => zipCentroid(zip) === null);
    expect(missing).toEqual([]);
  });

  it("holds more than coverage does, so an out-of-zone address still resolves", () => {
    expect(ZIP_CENTROIDS.length).toBeGreaterThan(COVERAGE_ZIPS.size);
  });

  it("has no duplicate ZIPs", () => {
    const seen = new Set(ZIP_CENTROIDS.map((c) => c.zip));
    expect(seen.size).toBe(ZIP_CENTROIDS.length);
  });

  it("is sorted, so a regeneration diffs cleanly", () => {
    const zips = ZIP_CENTROIDS.map((c) => c.zip);
    expect(zips).toEqual([...zips].sort());
  });

  // Every row is NY/NJ metro. The box is the real extent of prefixes 100-119
  // and 070-079 — south to Monmouth County, north to Orange County — with a
  // little slack, not a tight fit. It exists to catch a transposed pair or a
  // wrong-hemisphere sign, which land thousands of kilometres out, rather
  // than as an ETA of four days.
  it("keeps every point inside the NY/NJ metro bounding box", () => {
    const outside = ZIP_CENTROIDS.filter(
      (c) => c.lat < 40.1 || c.lat > 41.6 || c.lng < -75.2 || c.lng > -71.8,
    );
    expect(outside).toEqual([]);
  });

  it("resolves a ZIP+4 by its first five digits", () => {
    expect(zipCentroid("10018-1234")).toEqual(zipCentroid("10018"));
  });

  it("returns null for a ZIP it does not hold", () => {
    expect(zipCentroid("94103")).toBeNull();
  });
});
