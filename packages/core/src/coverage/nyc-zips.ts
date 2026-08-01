import { OutOfCoverageError } from "../errors";

/**
 * Service-area allowlist.
 *
 * Hardcoded on purpose for launch: the boundary is a commercial decision that
 * changes rarely and needs to be reviewable in a diff. When it starts changing
 * weekly, move it to a `service_areas` table — the function signatures here
 * will not have to change.
 *
 * Covers Manhattan, plus the parts of Brooklyn, Queens, and Jersey City where
 * a driver can reach JFK/LGA/EWR inside the drive-time assumptions the cutoff
 * maths relies on. Deliberately narrow — an out-of-area booking that gets sold
 * is a booking that misses its flight.
 */

/** Manhattan. */
const MANHATTAN = [
  "10001", "10002", "10003", "10004", "10005", "10006", "10007", "10009",
  "10010", "10011", "10012", "10013", "10014", "10016", "10017", "10018",
  "10019", "10021", "10022", "10023", "10024", "10025", "10026", "10027",
  "10028", "10029", "10030", "10031", "10032", "10033", "10034", "10035",
  "10036", "10037", "10038", "10039", "10040", "10044", "10065", "10069",
  "10075", "10128", "10280", "10282",
];

/** Brooklyn — northern and western neighbourhoods. */
const BROOKLYN = [
  "11201", "11205", "11206", "11207", "11208", "11211", "11215", "11216",
  "11217", "11218", "11220", "11221", "11222", "11225", "11226", "11231",
  "11232", "11233", "11237", "11238", "11249",
];

/** Queens — western neighbourhoods and the JFK/LGA corridors. */
const QUEENS = [
  "11101", "11102", "11103", "11104", "11105", "11106", "11109", "11354",
  "11355", "11361", "11362", "11363", "11364", "11365", "11366", "11367",
  "11368", "11369", "11370", "11372", "11373", "11374", "11375", "11377",
  "11378", "11379", "11385", "11413", "11414", "11415", "11416", "11417",
  "11418", "11419", "11420", "11430", "11432", "11433", "11434", "11435",
  "11436",
];

/** Jersey City and Hoboken — the EWR corridor. */
const HUDSON_COUNTY_NJ = [
  "07030", "07302", "07304", "07305", "07306", "07307", "07310", "07311",
];

export const COVERAGE_ZIPS: ReadonlySet<string> = new Set([
  ...MANHATTAN,
  ...BROOKLYN,
  ...QUEENS,
  ...HUDSON_COUNTY_NJ,
]);

export type CoverageArea = "manhattan" | "brooklyn" | "queens" | "hudson_county_nj";

const AREA_BY_ZIP: ReadonlyMap<string, CoverageArea> = new Map<string, CoverageArea>([
  ...MANHATTAN.map((z) => [z, "manhattan"] as const),
  ...BROOKLYN.map((z) => [z, "brooklyn"] as const),
  ...QUEENS.map((z) => [z, "queens"] as const),
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
