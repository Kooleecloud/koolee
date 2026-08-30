import { describe, expect, it } from "vitest";

import {
  isCaptchaError,
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

describe("isCaptchaError", () => {
  it("recognises the message GoTrue actually sends", () => {
    // Verbatim from a dev project's auth log, 2026-08-30 — the failure that
    // spent hours looking like a wrong password.
    expect(
      isCaptchaError("captcha protection: request disallowed (no captcha_token found)"),
    ).toBe(true);
    expect(isCaptchaError("captcha verification process failed")).toBe(true);
    expect(isCaptchaError("Captcha protection: request disallowed")).toBe(true);
  });

  it("leaves a real credential failure alone", () => {
    // These must keep collapsing to one message: the difference between
    // "no such account" and "wrong password" is an enumeration oracle.
    expect(isCaptchaError("Invalid login credentials")).toBe(false);
    expect(isCaptchaError("Email not confirmed")).toBe(false);
    expect(isCaptchaError("User not found")).toBe(false);
  });

  it("is safe on an absent message", () => {
    expect(isCaptchaError(undefined)).toBe(false);
    expect(isCaptchaError(null)).toBe(false);
    expect(isCaptchaError("")).toBe(false);
  });
});
