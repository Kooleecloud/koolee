import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Boot-time guard for OTP_LOG_HMAC_KEY: with a database configured the OTP
 * throttle WILL write destination hashes, so a missing key must fail at env
 * validation (module import) — not at the first OTP send. Without a database
 * the fresh-clone never-throw contract still holds.
 */
describe("env — OTP_LOG_HMAC_KEY boot validation", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("throws at import when DATABASE_URL is set and the key is missing", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://localhost:5432/postgres");
    vi.stubEnv("OTP_LOG_HMAC_KEY", "");
    vi.resetModules();
    await expect(import("./env")).rejects.toThrow(/OTP_LOG_HMAC_KEY/);
  });

  it("throws at import when the key is shorter than 32 chars", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://localhost:5432/postgres");
    vi.stubEnv("OTP_LOG_HMAC_KEY", "too-short");
    vi.resetModules();
    await expect(import("./env")).rejects.toThrow(/OTP_LOG_HMAC_KEY/);
  });

  it("accepts a database plus a well-formed key", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://localhost:5432/postgres");
    vi.stubEnv("OTP_LOG_HMAC_KEY", "f".repeat(64));
    vi.resetModules();
    await expect(import("./env")).resolves.toBeDefined();
  });

  it("still boots green with zero credentials (fresh-clone contract)", async () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("OTP_LOG_HMAC_KEY", "");
    vi.resetModules();
    await expect(import("./env")).resolves.toBeDefined();
  });
});
