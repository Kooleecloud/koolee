import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `verifyTurnstileToken` reads TURNSTILE_SECRET_KEY through env.ts, which
 * snapshots process.env at import — so each test stubs the env and re-imports
 * the module fresh.
 */

async function importFresh() {
  vi.resetModules();
  return import("./turnstile");
}

const okFetch = (success: boolean) =>
  vi.fn(async () => ({
    json: async () => ({ success }),
  })) as unknown as typeof fetch;

beforeEach(() => {
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("verifyTurnstileToken", () => {
  it("passes open (with reason) when no secret is configured", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
    const { verifyTurnstileToken } = await importFresh();
    const result = await verifyTurnstileToken("any-token");
    expect(result).toEqual({ ok: true, reason: "not_configured" });
  });

  it("rejects a missing token when a secret is configured", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "test-secret");
    const { verifyTurnstileToken } = await importFresh();
    expect(await verifyTurnstileToken(null)).toEqual({
      ok: false,
      reason: "missing_token",
    });
    expect(await verifyTurnstileToken("")).toEqual({
      ok: false,
      reason: "missing_token",
    });
  });

  it("accepts a token siteverify approves", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "test-secret");
    const { verifyTurnstileToken } = await importFresh();
    const fetchImpl = okFetch(true);
    const result = await verifyTurnstileToken("good-token", { fetchImpl });
    expect(result.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("rejects a token siteverify refuses", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "test-secret");
    const { verifyTurnstileToken } = await importFresh();
    const result = await verifyTurnstileToken("bad-token", { fetchImpl: okFetch(false) });
    expect(result).toEqual({ ok: false, reason: "rejected" });
  });

  it("fails closed when Cloudflare is unreachable", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "test-secret");
    const { verifyTurnstileToken } = await importFresh();
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const result = await verifyTurnstileToken("token", { fetchImpl });
    expect(result).toEqual({ ok: false, reason: "unreachable" });
  });

  it("posts the secret, token and remote ip to siteverify", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "test-secret");
    const { verifyTurnstileToken } = await importFresh();
    const fetchImpl = okFetch(true);
    await verifyTurnstileToken("tok-123", { remoteIp: "1.2.3.4", fetchImpl });

    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, RequestInit];
    expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    const body = new URLSearchParams(String(init.body));
    expect(body.get("secret")).toBe("test-secret");
    expect(body.get("response")).toBe("tok-123");
    expect(body.get("remoteip")).toBe("1.2.3.4");
  });
});
