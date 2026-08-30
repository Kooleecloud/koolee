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
    // Ticket extraction (§4.3c): without it the funnel silently swaps the
    // model adapter for the text-layer heuristic and keeps saying "extracted".
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
    // Web push (F3): without the keys every send reports success and no
    // device ever rings. The switch has to be ON here, or the VAPID gate is
    // waived and the assertions below would pass vacuously.
    vi.stubEnv("NEXT_PUBLIC_PUSH_NOTIFICATIONS_ENABLED", "true");
    vi.stubEnv("VAPID_PUBLIC_KEY", "vapid-public");
    vi.stubEnv("VAPID_PRIVATE_KEY", "vapid-private");
    vi.stubEnv("VAPID_SUBJECT", "mailto:ops@koolee.cloud");
    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "vapid-public");
    // Money (Tier 5): four variables that were ungated until the pre-flight
    // called it the notable hole. Each fails silently in its own way — see
    // the block in env.ts.
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_key");
    vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "pk_test_key");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_test");
    vi.stubEnv("CRON_SECRET", "cron-secret");
  }

  it("boots when the production security config is complete", async () => {
    stubCompleteProdConfig();
    vi.resetModules();
    await expect(import("./env")).resolves.toBeDefined();
  });

  it("boots with push DISABLED and no VAPID vars at all — the default posture", async () => {
    // Push ships off. A production deploy that has never heard of VAPID must
    // come up clean: the gate exists to catch a channel that is accidentally
    // inert, not to force everyone to configure a channel they have not
    // turned on.
    stubCompleteProdConfig();
    vi.stubEnv("NEXT_PUBLIC_PUSH_NOTIFICATIONS_ENABLED", "false");
    for (const key of [
      "VAPID_PUBLIC_KEY",
      "VAPID_PRIVATE_KEY",
      "VAPID_SUBJECT",
      "NEXT_PUBLIC_VAPID_PUBLIC_KEY",
    ]) {
      vi.stubEnv(key, "");
    }
    vi.resetModules();
    await expect(import("./env")).resolves.toBeDefined();
  });

  it("boots with push UNSET and no VAPID vars — unset means off", async () => {
    stubCompleteProdConfig();
    vi.stubEnv("NEXT_PUBLIC_PUSH_NOTIFICATIONS_ENABLED", "");
    for (const key of ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"]) {
      vi.stubEnv(key, "");
    }
    vi.resetModules();
    await expect(import("./env")).resolves.toBeDefined();
  });

  it("throws when the VAPID keys are missing on a live prod boot", async () => {
    // The fallback is `ConsolePushSender`, which LOGS AND REPORTS SUCCESS —
    // so without this gate every notification "sends" and nothing rings.
    for (const key of ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"]) {
      stubCompleteProdConfig();
      vi.stubEnv(key, "");
      vi.resetModules();
      await expect(import("./env")).rejects.toThrow(/VAPID/);
      vi.unstubAllEnvs();
    }
  });

  it("throws when the browser-side VAPID key is missing", async () => {
    // A server that can send with a browser that can never subscribe.
    stubCompleteProdConfig();
    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "");
    vi.resetModules();
    await expect(import("./env")).rejects.toThrow(/NEXT_PUBLIC_VAPID_PUBLIC_KEY/);
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

  /*
   * ANTHROPIC_API_KEY, the third silent degradation. `resolveExtractionConfig`
   * returns the heuristic extractor when it is unset, and nothing in the
   * response, the UI or the status code distinguishes that from a good read —
   * which is how staging spent a slice reporting one leg of a round trip,
   * the wrong traveler name and a printed duration as a departure time.
   */
  it("throws at import when ANTHROPIC_API_KEY is missing on a live prod boot", async () => {
    stubCompleteProdConfig();
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.resetModules();
    await expect(import("./env")).rejects.toThrow(/ANTHROPIC_API_KEY/);
  });

  it("boots without ANTHROPIC_API_KEY when the deploy is coming-soon", async () => {
    stubCompleteProdConfig();
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_LAUNCH_MODE", "coming_soon");
    vi.resetModules();
    await expect(import("./env")).resolves.toBeDefined();
  });

  it("leaves ANTHROPIC_API_KEY optional outside production", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("DATABASE_URL", "postgres://localhost:6543/postgres");
    vi.stubEnv("OTP_LOG_HMAC_KEY", "f".repeat(64));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
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

/**
 * The money gates.
 *
 * All four were `optionalString` with no assertion until Tier 5, and the
 * pre-flight (§2.4, §6.8) named that the notable hole: nothing refused a
 * production boot with payments unconfigured. Each of them fails silently in
 * its own way, and `CRON_SECRET` is the worst of the four — every other signal
 * stays green while authorizations expire uncaptured.
 */
describe("env — the money boot gates", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  function stubLiveProd(): void {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("DATABASE_URL", "postgres://localhost:6543/postgres");
    vi.stubEnv("OTP_LOG_HMAC_KEY", "f".repeat(64));
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "1x00000000000000000000BB");
    vi.stubEnv("RESEND_API_KEY", "re_test_key");
    vi.stubEnv("OPS_ALERT_EMAIL", "ops@koolee.cloud");
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
    vi.stubEnv("NEXT_PUBLIC_PUSH_NOTIFICATIONS_ENABLED", "false");
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_key");
    vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "pk_test_key");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_test");
    vi.stubEnv("CRON_SECRET", "cron-secret");
  }

  it("boots when all four are set", async () => {
    stubLiveProd();
    vi.resetModules();
    await expect(import("./env")).resolves.toBeDefined();
  });

  it.each([
    [
      "STRIPE_SECRET_KEY",
      // Absent ⇒ the in-memory FAKE provider. The pay step succeeds, the
      // booking is confirmed, and no card is ever charged.
      /STRIPE_SECRET_KEY/,
    ],
    [
      "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
      // A live secret with no publishable key is the "misconfigured" pay
      // step — discovered by a customer rather than by the boot.
      /NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY/,
    ],
    [
      "STRIPE_WEBHOOK_SECRET",
      // Every delivery rejected, so nothing ever reaches `paid`.
      /STRIPE_WEBHOOK_SECRET/,
    ],
    [
      "CRON_SECRET",
      // The quiet one: /api/jobs/* 503s, the cron keeps running, and
      // authorizations expire uncaptured while every other signal is green.
      /CRON_SECRET/,
    ],
  ])("throws on a live prod boot with %s missing", async (key, pattern) => {
    stubLiveProd();
    vi.stubEnv(key, "");
    vi.resetModules();
    await expect(import("./env")).rejects.toThrow(pattern);
  });

  it.each([
    "STRIPE_SECRET_KEY",
    "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "CRON_SECRET",
  ])("boots without %s when the deploy is coming-soon", async (key) => {
    // A coming-soon deploy cannot take a payment, so it needs none of them.
    // This is also the posture production is in today.
    stubLiveProd();
    vi.stubEnv(key, "");
    vi.stubEnv("NEXT_PUBLIC_LAUNCH_MODE", "coming_soon");
    vi.resetModules();
    await expect(import("./env")).resolves.toBeDefined();
  });

  it("leaves all four optional outside production", async () => {
    // The fresh-clone contract: a laptop with no Stripe account boots green
    // and gets the fake provider, which is the whole point of it.
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("DATABASE_URL", "postgres://localhost:6543/postgres");
    vi.stubEnv("OTP_LOG_HMAC_KEY", "f".repeat(64));
    for (const key of [
      "STRIPE_SECRET_KEY",
      "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
      "STRIPE_WEBHOOK_SECRET",
      "CRON_SECRET",
    ]) {
      vi.stubEnv(key, "");
    }
    vi.resetModules();
    await expect(import("./env")).resolves.toBeDefined();
  });
});
