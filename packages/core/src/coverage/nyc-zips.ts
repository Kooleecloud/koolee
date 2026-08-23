import {
  BRONX_ZIPS as BRONX,
  BROOKLYN_ZIPS as BROOKLYN,
  HUDSON_COUNTY_NJ_ZIPS as HUDSON_COUNTY_NJ,
  MANHATTAN_ZIPS as MANHATTAN,
  QUEENS_ZIPS as QUEENS,
  STATEN_ISLAND_ZIPS as STATEN_ISLAND,
} from "@koolee/db/coverage-zips";

import { OutOfCoverageError } from "../errors";

/**
 * Service-area coverage logic.
 *
 * The ZIP data itself lives in `@koolee/db/coverage-zips` (pure data, no
 * imports) so the seed can distribute agent zones over the same list without
 * a db → core cycle; the semantics — areas, normalization, the coverage
 * checks — live here. Still hardcoded on purpose for launch: the boundary is
 * a commercial decision that changes rarely and needs to be reviewable in a
 * diff. When it starts changing weekly, move it to a `service_areas` table —
 * the function signatures here will not have to change.
 *
 * Covers all five NYC boroughs plus the Hudson County (NJ) EWR corridor —
 * widened for launch-demo completeness (2026-08). Before real sales,
 * re-verify each area against the drive-time assumptions the cutoff maths
 * relies on — an out-of-area booking that gets sold is a booking that misses
 * its flight.
 */

export const COVERAGE_ZIPS: ReadonlySet<string> = new Set([
  ...MANHATTAN,
  ...BROOKLYN,
  ...QUEENS,
  ...BRONX,
  ...STATEN_ISLAND,
  ...HUDSON_COUNTY_NJ,
]);

export type CoverageArea =
  | "manhattan"
  | "brooklyn"
  | "queens"
  | "bronx"
  | "staten_island"
  | "hudson_county_nj";

const AREA_BY_ZIP: ReadonlyMap<string, CoverageArea> = new Map<string, CoverageArea>([
  ...MANHATTAN.map((z) => [z, "manhattan"] as const),
  ...BROOKLYN.map((z) => [z, "brooklyn"] as const),
  ...QUEENS.map((z) => [z, "queens"] as const),
  ...BRONX.map((z) => [z, "bronx"] as const),
  ...STATEN_ISLAND.map((z) => [z, "staten_island"] as const),
  ...HUDSON_COUNTY_NJ.map((z) => [z, "hudson_county_nj"] as const),
]);

/** Strips ZIP+4 and whitespace. Returns null if the input is not a 5-digit ZIP. */
export function normalizeZip(zip: string): string | null {
  const trimmed = zip.trim();
  const match = /^(\d{5})(?:-\d{4})?$/.exec(trimmed);
  return match?.[1] ?? null;
}

export function isInCoverage(zip: string): boolean {
  const normalized = normalizeZip(zip);
  return normalized !== null && COVERAGE_ZIPS.has(normalized);
}

export function coverageAreaFor(zip: string): CoverageArea | null {
  const normalized = normalizeZip(zip);
  return normalized === null ? null : (AREA_BY_ZIP.get(normalized) ?? null);
}

export type CoverageCheck =
  | { covered: true; zip: string; area: CoverageArea }
  | { covered: false; zip: string | null; reason: "malformed" | "out_of_area" };

/** Non-throwing check, for the address step of the booking flow. */
export function checkCoverage(zip: string): CoverageCheck {
  const normalized = normalizeZip(zip);
  if (normalized === null) {
    return { covered: false, zip: null, reason: "malformed" };
  }

  const area = AREA_BY_ZIP.get(normalized);
  if (!area) {
    return { covered: false, zip: normalized, reason: "out_of_area" };
  }

  return { covered: true, zip: normalized, area };
}

/** Throwing variant, for service-layer guards. */
export function assertInCoverage(zip: string): string {
  const result = checkCoverage(zip);
  if (!result.covered) throw new OutOfCoverageError(result.zip ?? zip);
  return result.zip;
}
