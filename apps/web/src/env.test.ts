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

/**
 * Fail-closed production gate: with Supabase configured, a production boot
 * must have the complete auth-funnel security config — each missing piece
 * silently DISABLES a control instead of erroring (Turnstile key → CAPTCHA
 * off; service-role key → orphan deletion off; DATABASE_URL → throttle and
 * reconciliation off; AUTH_SCHEMA_AVAILABLE=false → reconciliation off).
 */
describe("env — assertProductionSecurityConfig boot gate", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  /** Everything the gate demands, present. Individual tests blank one piece. */
  function stubCompleteProdConfig(): void {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("DATABASE_URL", "postgres://localhost:6543/postgres");
    vi.stubEnv("OTP_LOG_HMAC_KEY", "f".repeat(64));
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "1x00000000000000000000BB");
    // The transactional-email gate (§4.3b) is part of "complete" too — both
    // halves of it: the sending key and the address alerts are sent TO.
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    vi.stubEnv("OPS_ALERT_EMAIL", "ops@koolee.cloud");
  }

  it("boots when the production security config is complete", async () => {
    stubCompleteProdConfig();
    vi.resetModules();
    await expect(import("./env")).resolves.toBeDefined();
  });

  it("throws at import when RESEND_API_KEY is missing on a live prod boot", async () => {
    stubCompleteProdConfig();
    vi.stubEnv("RESEND_API_KEY", "");
    vi.resetModules();
    await expect(import("./env")).rejects.toThrow(/RESEND_API_KEY/);
  });

  it("boots without RESEND_API_KEY when the deploy is coming-soon", async () => {
    stubCompleteProdConfig();
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_LAUNCH_MODE", "coming_soon");
    vi.resetModules();
    await expect(import("./env")).resolves.toBeDefined();
  });

  /*
   * OPS_ALERT_EMAIL, same shape as the key above. It fails SILENTLY when
   * unset — the alert function logs a skip and returns — so a production
   * deploy that forgets it loses every exception alert while looking healthy.
   */
  it("throws at import when OPS_ALERT_EMAIL is missing on a live prod boot", async () => {
    stubCompleteProdConfig();
    vi.stubEnv("OPS_ALERT_EMAIL", "");
    vi.resetModules();
    await expect(import("./env")).rejects.toThrow(/OPS_ALERT_EMAIL/);
  });

  it("boots without OPS_ALERT_EMAIL when the deploy is coming-soon", async () => {
    stubCompleteProdConfig();
    vi.stubEnv("OPS_ALERT_EMAIL", "");
    vi.stubEnv("NEXT_PUBLIC_LAUNCH_MODE", "coming_soon");
    vi.resetModules();
    await expect(import("./env")).resolves.toBeDefined();
  });

  it("leaves OPS_ALERT_EMAIL optional outside production", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("DATABASE_URL", "postgres://localhost:6543/postgres");
    vi.stubEnv("OTP_LOG_HMAC_KEY", "f".repeat(64));
    vi.stubEnv("OPS_ALERT_EMAIL", "");
    vi.resetModules();
    await expect(import("./env")).resolves.toBeDefined();
  });

  it("throws at import when the Turnstile site key is missing", async () => {
    stubCompleteProdConfig();
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "");
    vi.resetModules();
    await expect(import("./env")).rejects.toThrow(/NEXT_PUBLIC_TURNSTILE_SITE_KEY/);
  });

  it("throws at import when the service-role key is missing", async () => {
    stubCompleteProdConfig();
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    vi.resetModules();
    await expect(import("./env")).rejects.toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it("throws at import when DATABASE_URL is missing (throttle and reconcile would be off)", async () => {
    stubCompleteProdConfig();
    vi.stubEnv("DATABASE_URL", "");
    vi.resetModules();
    await expect(import("./env")).rejects.toThrow(/DATABASE_URL/);
  });

  it('throws at import when AUTH_SCHEMA_AVAILABLE is explicitly "false"', async () => {
    stubCompleteProdConfig();
    vi.stubEnv("AUTH_SCHEMA_AVAILABLE", "false");
    vi.resetModules();
    await expect(import("./env")).rejects.toThrow(/AUTH_SCHEMA_AVAILABLE/);
  });

  it("does not gate a production boot with no Supabase configured — the funnel is inert", async () => {
    stubCompleteProdConfig();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "");
    vi.resetModules();
    await expect(import("./env")).resolves.toBeDefined();
  });

  it("does not gate development boots (fresh-clone contract)", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.resetModules();
    await expect(import("./env")).resolves.toBeDefined();
  });
});
