import { beforeEach, describe, expect, it, vi } from "vitest";
import { InvalidInputError, NotAuthorizedError } from "@koolee/core";
import { POSITIONS_MAX_BATCH } from "@koolee/api-contract";

/**
 * Drives POST through the real wrapper with the context and the handler
 * mocked, so this proves the wiring the route file owns: which handler,
 * which schema, that off-shift is 409 `not_on_shift`, and that a ping does
 * NOT claim an idempotency row.
 */
const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  claim: vi.fn(),
  handler: vi.fn(),
}));

vi.mock("@/api/context", () => ({
  resolveApiContext: (...args: unknown[]) => mocks.resolve(...args),
}));
vi.mock("@koolee/core", async (importOriginal) => ({
  ...(await importOriginal<typeof Core>()),
  claimIdempotencyKey: (...args: unknown[]) => mocks.claim(...args),
}));
vi.mock("@/api/handlers/positions", () => ({
  recordPositions: (...args: unknown[]) => mocks.handler(...args),
}));

import type * as Core from "@koolee/core";

import * as route from "./route";

const NOW = new Date("2026-09-27T12:00:00.000Z");
const ctx = {
  core: { db: {}, clock: { now: () => NOW } },
  session: { kind: "agent", role: "agent", userId: "user-1" },
  identity: {},
  supabase: {},
  now: NOW,
};
const routeContext = { params: Promise.resolve({}) };

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/v1/positions", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mocks.resolve.mockReset().mockResolvedValue(ctx);
  mocks.claim.mockReset();
  mocks.handler.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("POST /api/v1/positions", () => {
  it("exposes POST only and opts out of caching", () => {
    expect(typeof route.POST).toBe("function");
    expect("GET" in route).toBe(false);
    expect(route.dynamic).toBe("force-dynamic");
  });

  it("hands a single fix to recordPositions and answers its count", async () => {
    mocks.handler.mockResolvedValue({ ok: true, accepted: 1 });

    const res = await route.POST(
      post({ lat: 40.7, lng: -73.9, recordedAt: "2026-09-27T11:59:55.000Z" }),
      routeContext,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, accepted: 1 });
    expect(mocks.handler).toHaveBeenCalledWith(ctx, {
      lat: 40.7,
      lng: -73.9,
      recordedAt: "2026-09-27T11:59:55.000Z",
    });
  });

  it("hands a batch through untouched", async () => {
    mocks.handler.mockResolvedValue({ ok: true, accepted: 2 });
    const fixes = [
      { lat: 1, lng: 2 },
      { lat: 3, lng: 4 },
    ];

    const res = await route.POST(post({ fixes }), routeContext);

    expect(res.status).toBe(200);
    expect(mocks.handler).toHaveBeenCalledWith(ctx, { fixes });
  });

  it("rejects an empty batch, an oversized batch and a fix without lng with 400", async () => {
    const tooMany = Array.from({ length: POSITIONS_MAX_BATCH + 1 }, () => ({
      lat: 1,
      lng: 2,
    }));
    for (const body of [{ fixes: [] }, { fixes: tooMany }, { lat: 1 }]) {
      const res = await route.POST(post(body), routeContext);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("invalid_body");
    }
    expect(mocks.handler).not.toHaveBeenCalled();
  });

  it("answers 409 not_on_shift when core refuses an off-shift ping", async () => {
    mocks.handler.mockRejectedValue(new NotAuthorizedError("Not on shift."));

    const res = await route.POST(post({ lat: 1, lng: 2 }), routeContext);

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "not_on_shift", message: "Not on shift." });
  });

  it("answers 400 invalid_input for a fix off the planet", async () => {
    mocks.handler.mockRejectedValue(
      new InvalidInputError("position", "That is not a position on this planet."),
    );

    const res = await route.POST(post({ lat: 91, lng: 2 }), routeContext);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "invalid_input",
      message: "That is not a position on this planet.",
      field: "position",
    });
  });

  it("is not mutating: an Idempotency-Key header claims nothing", async () => {
    mocks.handler.mockResolvedValue({ ok: true, accepted: 1 });

    const res = await route.POST(
      post({ lat: 1, lng: 2 }, { "Idempotency-Key": "k-1" }),
      routeContext,
    );

    expect(res.status).toBe(200);
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.handler).toHaveBeenCalledTimes(1);
  });
});
