import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Fail-loud production gate: staff sign-in is this app, so a production boot
 * with the Supabase URL or anon key missing must throw at import — not render
 * a silently unusable login screen. `next build` (NEXT_PHASE set) and
 * development boots stay exempt: the fresh-clone zero-credential contract.
 */
describe("env — production boot assertion (agent)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  function stubCompleteProdConfig(): void {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
  }

  it("boots when the production auth config is complete", async () => {
    stubCompleteProdConfig();
    vi.resetModules();
    await expect(import("./env")).resolves.toBeDefined();
  });

  it("throws at import when the Supabase URL is missing", async () => {
    stubCompleteProdConfig();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.resetModules();
    await expect(import("./env")).rejects.toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });

  it("throws at import when the anon key is missing", async () => {
    stubCompleteProdConfig();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    vi.resetModules();
    await expect(import("./env")).rejects.toThrow(/NEXT_PUBLIC_SUPABASE_ANON_KEY/);
  });

  it("names every missing variable at once, not just the first", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    vi.resetModules();
    await expect(import("./env")).rejects.toThrow(
      /NEXT_PUBLIC_SUPABASE_URL[\s\S]*NEXT_PUBLIC_SUPABASE_ANON_KEY/,
    );
  });

  it("does not gate the build phase (fresh clone must build with zero credentials)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PHASE", "phase-production-build");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    vi.resetModules();
    await expect(import("./env")).resolves.toBeDefined();
  });

  it("does not gate development boots", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.resetModules();
    await expect(import("./env")).resolves.toBeDefined();
  });
});
