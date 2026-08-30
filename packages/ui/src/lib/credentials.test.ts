import { describe, expect, it } from "vitest";

import {
  normalizeEmail,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_RULE_COPY,
  PASSWORD_TOO_SHORT_COPY,
  SIGN_IN_FAILED_COPY,
} from "./credentials";

/**
 * The point of this module is that there is only one of it. These tests pin
 * the properties that made the duplicated versions diverge.
 */

describe("normalizeEmail", () => {
  it("lowercases and trims, so the invite and the sign-in agree", () => {
    // The invite flow already did this; sign-in and reset only trimmed.
    expect(normalizeEmail("  Alice@Koolee.Cloud ")).toBe("alice@koolee.cloud");
  });

  it("is idempotent", () => {
    expect(normalizeEmail(normalizeEmail("A@B.com"))).toBe("a@b.com");
  });

  it("returns an empty string for anything that is not one", () => {
    // FormData.get returns `File | string | null`; none of the others is an
    // address, and an empty string fails the zod check the caller runs next.
    expect(normalizeEmail(null)).toBe("");
    expect(normalizeEmail(undefined)).toBe("");
    expect(normalizeEmail(42)).toBe("");
  });
});

describe("the password rule", () => {
  it("states the same number in the hint and in the error", () => {
    expect(PASSWORD_RULE_COPY).toContain(String(PASSWORD_MIN_LENGTH));
    expect(PASSWORD_TOO_SHORT_COPY).toContain(String(PASSWORD_MIN_LENGTH));
  });

  it("has a floor below its ceiling", () => {
    expect(PASSWORD_MIN_LENGTH).toBeLessThan(PASSWORD_MAX_LENGTH);
  });
});

describe("the sign-in failure message", () => {
  it("names neither the email nor the password as the thing that was wrong", () => {
    // Any wording that distinguishes "no such account" from "wrong password"
    // is an account-enumeration oracle.
    expect(SIGN_IN_FAILED_COPY).toBe("Email or password didn't match.");
    expect(SIGN_IN_FAILED_COPY).not.toMatch(/no account|not found|unknown|incorrect password/i);
  });
});
