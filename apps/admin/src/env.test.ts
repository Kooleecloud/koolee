import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Fail-loud production gate: each of these vars, absent, silently disables
 * something ops depends on (sign-in, staff invites, evidence-photo signed
 * URLs, agent invite links). A production boot must throw at import instead.
 * `next build` (NEXT_PHASE set) and development boots stay exempt: the
 * fresh-clone zero-credential contract.
 */
describe("env — production boot assertion (admin)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  function stubCompleteProdConfig(): void {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
    vi.stubEnv("NEXT_PUBLIC_AGENT_APP_URL", "https://agent.example.com");
  }

  it("boots when the production ops config is complete", async () => {
    stubCompleteProdConfig();
    vi.resetModules();
    await expect(import("./env")).resolves.toBeDefined();
  });

  it.each([
    ["NEXT_PUBLIC_SUPABASE_URL"],
    ["NEXT_PUBLIC_SUPABASE_ANON_KEY"],
    ["SUPABASE_SERVICE_ROLE_KEY"],
    ["NEXT_PUBLIC_AGENT_APP_URL"],
  ] as const)("throws at import when %s is missing", async (key) => {
    stubCompleteProdConfig();
    vi.stubEnv(key, "");
    vi.resetModules();
    await expect(import("./env")).rejects.toThrow(new RegExp(key));
  });

  it("does not gate the build phase (fresh clone must build with zero credentials)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    vi.resetModules();
    await expect(import("./env")).resolves.toBeDefined();
  });

  it("does not gate development boots", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.resetModules();
    await expect(import("./env")).resolves.toBeDefined();
  });
});
