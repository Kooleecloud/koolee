import { beforeEach, describe, expect, it, vi } from "vitest";

import { refused } from "@/api/errors";

/**
 * Drives POST through the real wrapper with the context and the handler
 * mocked, so this proves the wiring the route file owns: which handler,
 * which schema, and that the step claims an idempotency key.
 */
const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  claim: vi.fn(),
  complete: vi.fn(),
  handler: vi.fn(),
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
vi.mock("@/api/handlers/pickup", () => ({
  handover: (...args: unknown[]) => mocks.handler(...args),
}));

import type * as Core from "@koolee/core";

import * as route from "./route";

const NOW = new Date("2026-09-27T12:00:00.000Z");
const TASK_ID = "22222222-2222-4222-8222-222222222222";
const PATH = `/api/v1/tasks/${TASK_ID}/pickup/handover`;
const ctx = {
  core: { db: {}, clock: { now: () => NOW } },
  session: { kind: "agent", role: "agent", userId: "user-1" },
  identity: {},
  supabase: {},
  now: NOW,
};
const routeContext = { params: Promise.resolve({ taskId: TASK_ID }) };

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request(`http://localhost${PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mocks.resolve.mockReset().mockResolvedValue(ctx);
  mocks.claim.mockReset();
  mocks.complete.mockReset().mockResolvedValue(undefined);
  mocks.handler.mockReset();
});

describe("POST /api/v1/tasks/:taskId/pickup/handover", () => {
  it("exposes POST only and opts out of caching", () => {
    expect(typeof route.POST).toBe("function");
    expect("GET" in route).toBe(false);
    expect(route.dynamic).toBe("force-dynamic");
  });

  it("hands the task id and the parsed position to handover and answers 200", async () => {
    mocks.handler.mockResolvedValue({ ok: true });

    const res = await route.POST(
      post({ lat: 40.7, lng: -73.9, extra: "x" }),
      routeContext,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mocks.handler).toHaveBeenCalledWith(ctx, TASK_ID, { lat: 40.7, lng: -73.9 });
  });

  it("accepts an empty position", async () => {
    mocks.handler.mockResolvedValue({ ok: true });

    const res = await route.POST(post({}), routeContext);

    expect(res.status).toBe(200);
    expect(mocks.handler).toHaveBeenCalledWith(ctx, TASK_ID, {});
  });

  it("rejects a non-numeric coordinate with 400 before the handler runs", async () => {
    const res = await route.POST(post({ lat: "40.7", lng: -73.9 }), routeContext);

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_body");
    expect(mocks.handler).not.toHaveBeenCalled();
  });

  it("turns a handler refusal into 422 refused with core's sentence", async () => {
    mocks.handler.mockRejectedValue(refused("Scan every bag first."));

    const res = await route.POST(post({}), routeContext);

    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      error: "refused",
      message: "Scan every bag first.",
    });
  });

  it("is mutating: an Idempotency-Key is claimed and a replay skips the handler", async () => {
    mocks.claim.mockResolvedValue({ state: "replay", status: 200, body: { ok: true } });

    const res = await route.POST(post({}, { "Idempotency-Key": "k-1" }), routeContext);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mocks.claim).toHaveBeenCalledWith(
      ctx.core.db,
      expect.objectContaining({ userId: "user-1", key: "k-1", route: `POST ${PATH}` }),
    );
    expect(mocks.handler).not.toHaveBeenCalled();
  });
});
