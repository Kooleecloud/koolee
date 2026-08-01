import { describe, expect, it } from "vitest";

import { OutOfCoverageError } from "../errors";
import {
  assertInCoverage,
  checkCoverage,
  coverageAreaFor,
  COVERAGE_ZIPS,
  isInCoverage,
  normalizeZip,
} from "./nyc-zips";

describe("normalizeZip", () => {
  it("accepts a plain 5-digit ZIP", () => {
    expect(normalizeZip("10001")).toBe("10001");
  });

  it("strips ZIP+4 and surrounding whitespace", () => {
    expect(normalizeZip("  10001-1234 ")).toBe("10001");
  });

  it("rejects anything that is not a ZIP", () => {
    for (const bad of ["", "1000", "100011", "abcde", "1000a", "10001-12"]) {
      expect(normalizeZip(bad)).toBeNull();
    }
  });
});

describe("coverage allowlist", () => {
  it("covers Manhattan, Brooklyn, Queens and Hudson County", () => {
    expect(coverageAreaFor("10001")).toBe("manhattan");
    expect(coverageAreaFor("11201")).toBe("brooklyn");
    expect(coverageAreaFor("11101")).toBe("queens");
    expect(coverageAreaFor("07302")).toBe("hudson_county_nj");
  });

  it("excludes ZIPs outside the service area", () => {
    // Staten Island, the Bronx, Westchester, Los Angeles.
    for (const zip of ["10301", "10451", "10601", "90210"]) {
      expect(isInCoverage(zip)).toBe(false);
      expect(coverageAreaFor(zip)).toBeNull();
    }
  });

  it("has no duplicate entries across areas", () => {
    expect(COVERAGE_ZIPS.size).toBeGreaterThan(100);
    for (const zip of COVERAGE_ZIPS) {
      expect(coverageAreaFor(zip)).not.toBeNull();
    }
  });

  it("contains only well-formed 5-digit ZIPs", () => {
    for (const zip of COVERAGE_ZIPS) {
      expect(zip).toMatch(/^\d{5}$/);
    }
  });
});

describe("checkCoverage", () => {
  it("reports the area for a covered ZIP", () => {
    expect(checkCoverage("10011-2345")).toEqual({
      covered: true,
      zip: "10011",
      area: "manhattan",
    });
  });

  it("distinguishes malformed input from out-of-area", () => {
    expect(checkCoverage("nope")).toEqual({
      covered: false,
      zip: null,
      reason: "malformed",
    });
    expect(checkCoverage("90210")).toEqual({
      covered: false,
      zip: "90210",
      reason: "out_of_area",
    });
  });
});

describe("assertInCoverage", () => {
  it("returns the normalised ZIP when covered", () => {
    expect(assertInCoverage("10001-9999")).toBe("10001");
  });

  it("throws a typed error when not covered", () => {
    expect(() => assertInCoverage("90210")).toThrow(OutOfCoverageError);
    expect(() => assertInCoverage("nope")).toThrow(OutOfCoverageError);
  });

  it("carries the ZIP on the error for the email-capture form", () => {
    try {
      assertInCoverage("90210");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as OutOfCoverageError).zip).toBe("90210");
      expect((error as OutOfCoverageError).code).toBe("OUT_OF_COVERAGE");
    }
  });
});
