import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { hashDestination } from "./hash-destination";

const KEY = "a".repeat(64);
// Fixture destinations are hashed before they go anywhere near otp_send_log;
// no test in this suite writes a plaintext destination into a log row.
const PHONE = "+13322602829";

describe("hashDestination", () => {
  beforeEach(() => {
    vi.stubEnv("OTP_LOG_HMAC_KEY", KEY);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("hashes differently-formatted spellings of one phone identically", () => {
    const canonical = hashDestination(PHONE, "phone");
    expect(hashDestination("+1 332 260 2829", "phone")).toBe(canonical);
    expect(hashDestination("+1 (332) 260-2829", "phone")).toBe(canonical);
  });

  it("normalizes email case and surrounding whitespace", () => {
    expect(hashDestination(" Traveler@Example.COM ", "email")).toBe(
      hashDestination("traveler@example.com", "email"),
    );
  });

  it("gives the same string different hashes as phone vs email", () => {
    expect(hashDestination(PHONE, "phone")).not.toBe(hashDestination(PHONE, "email"));
  });

  it("produces a hex digest that does not reveal the plaintext", () => {
    const hash = hashDestination(PHONE, "phone");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain("3322602829");
  });

  it("is keyed: a different OTP_LOG_HMAC_KEY changes the digest", () => {
    const before = hashDestination(PHONE, "phone");
    vi.stubEnv("OTP_LOG_HMAC_KEY", "b".repeat(64));
    expect(hashDestination(PHONE, "phone")).not.toBe(before);
  });

  it("throws when OTP_LOG_HMAC_KEY is not set", () => {
    vi.stubEnv("OTP_LOG_HMAC_KEY", "");
    expect(() => hashDestination(PHONE, "phone")).toThrow(/OTP_LOG_HMAC_KEY/);
  });
});
