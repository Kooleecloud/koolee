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
  reportPickupException: (...args: unknown[]) => mocks.handler(...args),
}));

import type * as Core from "@koolee/core";

import * as route from "./route";

const NOW = new Date("2026-09-27T12:00:00.000Z");
const TASK_ID = "22222222-2222-4222-8222-222222222222";
const PATH = `/api/v1/tasks/${TASK_ID}/pickup/exception`;
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

describe("POST /api/v1/tasks/:taskId/pickup/exception", () => {
  it("exposes POST only and opts out of caching", () => {
    expect(typeof route.POST).toBe("function");
    expect("GET" in route).toBe(false);
    expect(route.dynamic).toBe("force-dynamic");
  });

  it("hands the task id, reason, trimmed note and position to reportPickupException", async () => {
    mocks.handler.mockResolvedValue({ ok: true });

    const res = await route.POST(
      post({ reason: "other", note: "  Counter closed early.  ", lat: 5, lng: 6 }),
      routeContext,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mocks.handler).toHaveBeenCalledWith(ctx, TASK_ID, {
      reason: "other",
      note: "Counter closed early.",
      lat: 5,
      lng: 6,
    });
  });

  it("rejects an unknown reason or a missing one with 400 before the handler runs", async () => {
    for (const body of [{}, { reason: "ran_out_of_fuel" }]) {
      const res = await route.POST(post(body), routeContext);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("invalid_body");
    }
    expect(mocks.handler).not.toHaveBeenCalled();
  });

  it("turns core's 'other needs a note' refusal into 422 refused", async () => {
    mocks.handler.mockRejectedValue(refused("Describe what happened."));

    const res = await route.POST(post({ reason: "other" }), routeContext);

    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      error: "refused",
      message: "Describe what happened.",
    });
  });

  it("is mutating: an Idempotency-Key is claimed and a replay skips the handler", async () => {
    mocks.claim.mockResolvedValue({ state: "replay", status: 200, body: { ok: true } });

    const res = await route.POST(
      post({ reason: "vehicle_problem" }, { "Idempotency-Key": "k-1" }),
      routeContext,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mocks.claim).toHaveBeenCalledWith(
      ctx.core.db,
      expect.objectContaining({ userId: "user-1", key: "k-1", route: `POST ${PATH}` }),
    );
    expect(mocks.handler).not.toHaveBeenCalled();
  });
});
