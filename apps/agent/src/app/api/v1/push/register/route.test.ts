import { beforeEach, describe, expect, it, vi } from "vitest";
import { InvalidInputError } from "@koolee/core";

/**
 * Drives POST and DELETE through the real wrapper with the context and the
 * handlers mocked, so this proves the wiring the route file owns: which
 * handler, which schema, 201 on register, and that both methods claim an
 * idempotency key — the app replays queued actions, and a sign-out that
 * runs twice must not un-register a token the next sign-in just registered.
 */
const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  claim: vi.fn(),
  complete: vi.fn(),
  register: vi.fn(),
  unregister: vi.fn(),
}));

vi.mock("@/api/context", () => ({
  resolveApiContext: (...args: unknown[]) => mocks.resolve(...args),
}));
vi.mock("@koolee/core", async (importOriginal) => ({
  ...(await importOriginal<typeof Core>()),
  claimIdempotencyKey: (...args: unknown[]) => mocks.claim(...args),
  completeIdempotencyKey: (...args: unknown[]) => mocks.complete(...args),
  releaseIdempotencyKey: vi.fn(),
}));
vi.mock("@/api/handlers/push", () => ({
  registerPushToken: (...args: unknown[]) => mocks.register(...args),
  unregisterPushToken: (...args: unknown[]) => mocks.unregister(...args),
}));

import type * as Core from "@koolee/core";

import * as route from "./route";

const NOW = new Date("2026-09-27T12:00:00.000Z");
const PATH = "/api/v1/push/register";
const TOKEN = "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]";
const ROW_ID = "9f1f8a2e-6c3e-4d4d-9c4a-1f0c1e2d3a4b";
const ctx = {
  core: { db: {}, clock: { now: () => NOW } },
  session: { kind: "agent", role: "agent", userId: "user-1" },
  identity: {},
  supabase: {},
  now: NOW,
};
const routeContext = { params: Promise.resolve({}) };

function request(
  method: "POST" | "DELETE",
  body: unknown,
  headers: Record<string, string> = {},
) {
  return new Request(`http://localhost${PATH}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mocks.resolve.mockReset().mockResolvedValue(ctx);
  mocks.claim.mockReset();
  mocks.complete.mockReset().mockResolvedValue(undefined);
  mocks.register.mockReset();
  mocks.unregister.mockReset();
});

describe("POST + DELETE /api/v1/push/register", () => {
  it("exposes POST and DELETE only and opts out of caching", () => {
    expect(typeof route.POST).toBe("function");
    expect(typeof route.DELETE).toBe("function");
    expect("GET" in route).toBe(false);
    expect(route.dynamic).toBe("force-dynamic");
  });

  it("POST hands the parsed body to registerPushToken and answers 201", async () => {
    mocks.register.mockResolvedValue({ ok: true, id: ROW_ID });

    const res = await route.POST(
      request("POST", { token: TOKEN, platform: "ios", deviceLabel: "iPhone", extra: 1 }),
      routeContext,
    );

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true, id: ROW_ID });
    // Unknown keys are stripped before the handler sees the body.
    expect(mocks.register).toHaveBeenCalledWith(ctx, {
      token: TOKEN,
      platform: "ios",
      deviceLabel: "iPhone",
    });
  });

  it("POST rejects a non-Expo token and an unknown platform with 400 before the handler runs", async () => {
    for (const body of [
      { token: "fcm:abc", platform: "ios" },
      { token: TOKEN, platform: "web" },
      { platform: "ios" },
    ]) {
      const res = await route.POST(request("POST", body), routeContext);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("invalid_body");
    }
    expect(mocks.register).not.toHaveBeenCalled();
  });

  it("POST maps core's own token refusal to 400 invalid_input with the field", async () => {
    mocks.register.mockRejectedValue(
      new InvalidInputError("token", "That is not an Expo push token."),
    );

    const res = await route.POST(
      request("POST", { token: TOKEN, platform: "ios" }),
      routeContext,
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "invalid_input",
      message: "That is not an Expo push token.",
      field: "token",
    });
  });

  it("DELETE hands the token to unregisterPushToken and answers 200 with its verdict", async () => {
    mocks.unregister.mockResolvedValue({ ok: false });

    const res = await route.DELETE(request("DELETE", { token: TOKEN }), routeContext);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false });
    expect(mocks.unregister).toHaveBeenCalledWith(ctx, { token: TOKEN });
  });

  it("DELETE rejects a body without a token with 400", async () => {
    const res = await route.DELETE(request("DELETE", {}), routeContext);
    expect(res.status).toBe(400);
    expect(mocks.unregister).not.toHaveBeenCalled();
  });

  it("both methods are mutating: an Idempotency-Key is claimed and a replay skips the handler", async () => {
    mocks.claim.mockResolvedValue({
      state: "replay",
      status: 201,
      body: { ok: true, id: ROW_ID },
    });

    const res = await route.POST(
      request("POST", { token: TOKEN, platform: "ios" }, { "Idempotency-Key": "k-1" }),
      routeContext,
    );
    expect(res.status).toBe(201);
    expect(mocks.claim).toHaveBeenCalledWith(
      ctx.core.db,
      expect.objectContaining({ userId: "user-1", key: "k-1", route: `POST ${PATH}` }),
    );
    expect(mocks.register).not.toHaveBeenCalled();

    mocks.claim.mockResolvedValue({ state: "replay", status: 200, body: { ok: true } });
    await route.DELETE(
      request("DELETE", { token: TOKEN }, { "Idempotency-Key": "k-2" }),
      routeContext,
    );
    expect(mocks.claim).toHaveBeenLastCalledWith(
      ctx.core.db,
      expect.objectContaining({ key: "k-2", route: `DELETE ${PATH}` }),
    );
    expect(mocks.unregister).not.toHaveBeenCalled();
  });
});
