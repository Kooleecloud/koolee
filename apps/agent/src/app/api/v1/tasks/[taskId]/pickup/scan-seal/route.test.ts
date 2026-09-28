import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictError } from "@koolee/core";

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
  scanSeal: (...args: unknown[]) => mocks.handler(...args),
}));

import type * as Core from "@koolee/core";

import * as route from "./route";

const NOW = new Date("2026-09-27T12:00:00.000Z");
const TASK_ID = "22222222-2222-4222-8222-222222222222";
const BAG_ID = "33333333-3333-4333-8333-333333333333";
const PATH = `/api/v1/tasks/${TASK_ID}/pickup/scan-seal`;
const ctx = {
  core: { db: {}, clock: { now: () => NOW } },
  session: { kind: "agent", role: "agent", userId: "user-1" },
  identity: {},
  supabase: {},
  now: NOW,
};
const routeContext = { params: Promise.resolve({ taskId: TASK_ID }) };
const SCANNED = {
  ok: true,
  bagId: BAG_ID,
  scannedCount: 1,
  totalBags: 2,
  custodyTransferred: false,
};

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

describe("POST /api/v1/tasks/:taskId/pickup/scan-seal", () => {
  it("exposes POST only and opts out of caching", () => {
    expect(typeof route.POST).toBe("function");
    expect("GET" in route).toBe(false);
    expect(route.dynamic).toBe("force-dynamic");
  });

  it("hands the task id and the trimmed seal to scanSeal and answers its counts", async () => {
    mocks.handler.mockResolvedValue(SCANNED);

    const res = await route.POST(
      post({ sealValue: "  SEAL-42  ", lat: 1.5, lng: 2.5 }),
      routeContext,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(SCANNED);
    expect(mocks.handler).toHaveBeenCalledWith(ctx, TASK_ID, {
      sealValue: "SEAL-42",
      lat: 1.5,
      lng: 2.5,
    });
  });

  it("rejects a blank or missing seal with 400 before the handler runs", async () => {
    for (const body of [{}, { sealValue: "   " }]) {
      const res = await route.POST(post(body), routeContext);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("invalid_body");
    }
    expect(mocks.handler).not.toHaveBeenCalled();
  });

  it("maps a seal mismatch (ConflictError) to 409 conflict naming the field", async () => {
    mocks.handler.mockRejectedValue(
      new ConflictError("seal", "That seal is not on this booking."),
    );

    const res = await route.POST(post({ sealValue: "WRONG" }), routeContext);

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "conflict",
      message: "That seal is not on this booking.",
      field: "seal",
    });
  });

  it("is mutating: an Idempotency-Key is claimed and a replay skips the handler", async () => {
    mocks.claim.mockResolvedValue({ state: "replay", status: 200, body: SCANNED });

    const res = await route.POST(
      post({ sealValue: "SEAL-42" }, { "Idempotency-Key": "k-1" }),
      routeContext,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(SCANNED);
    expect(mocks.claim).toHaveBeenCalledWith(
      ctx.core.db,
      expect.objectContaining({ userId: "user-1", key: "k-1", route: `POST ${PATH}` }),
    );
    expect(mocks.handler).not.toHaveBeenCalled();
  });
});
