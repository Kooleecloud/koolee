import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ConflictError, NotAuthorizedError, NotFoundError } from "@koolee/core";

import { ApiHttpError } from "./errors";

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  claim: vi.fn(),
  complete: vi.fn(),
  release: vi.fn(),
}));

vi.mock("@/api/context", () => ({
  resolveApiContext: (...args: unknown[]) => mocks.resolve(...args),
}));
vi.mock("@koolee/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@koolee/core")>()),
  claimIdempotencyKey: (...args: unknown[]) => mocks.claim(...args),
  completeIdempotencyKey: (...args: unknown[]) => mocks.complete(...args),
  releaseIdempotencyKey: (...args: unknown[]) => mocks.release(...args),
}));

import { apiRoute, hashBody, stableStringify } from "./route";

const NOW = new Date("2026-09-27T12:00:00.000Z");
const ctx = {
  core: { db: {}, clock: { now: () => NOW } },
  session: { kind: "agent", role: "agent", userId: "user-1" },
  identity: {},
  supabase: {},
  now: NOW,
};

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/v1/tasks/t1/visit/arrive", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}
const routeContext = { params: Promise.resolve({ taskId: "t1" }) };

describe("apiRoute", () => {
  beforeEach(() => {
    mocks.resolve.mockReset().mockResolvedValue(ctx);
    mocks.claim.mockReset();
    mocks.complete.mockReset().mockResolvedValue(undefined);
    mocks.release.mockReset().mockResolvedValue(undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("answers 401 from the context resolver without touching the handler", async () => {
    mocks.resolve.mockRejectedValue(
      new ApiHttpError("not_authorized", "Please sign in again."),
    );
    const handler = vi.fn();
    const res = await apiRoute({}, handler)(
      new Request("http://localhost/api/v1/me"),
      routeContext,
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: "not_authorized",
      message: "Please sign in again.",
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("validates the body with the contract schema and names the first issue", async () => {
    const route = apiRoute({ body: z.object({ truckId: z.uuid() }) }, async () => ({
      body: {},
    }));
    const res = await route(post({ truckId: "nope" }), routeContext);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_body");
    expect(body.message).toMatch(/truckId/);
  });

  it("hands the handler the parsed body, params and url", async () => {
    const handler = vi.fn().mockResolvedValue({ status: 201, body: { ok: true } });
    const route = apiRoute({ body: z.object({ lat: z.number() }) }, handler);
    const res = await route(post({ lat: 1.5, extra: "stripped" }), routeContext);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true });
    const [gotCtx, input] = handler.mock.calls[0]!;
    expect(gotCtx).toBe(ctx);
    expect(input.body).toEqual({ lat: 1.5 });
    expect(input.params).toEqual({ taskId: "t1" });
    expect(input.url.pathname).toBe("/api/v1/tasks/t1/visit/arrive");
    expect(mocks.claim).not.toHaveBeenCalled();
  });

  it("maps a thrown core refusal to its status and stores nothing without a key", async () => {
    const route = apiRoute({ mutating: true }, async () => {
      throw new NotFoundError("Pickup task", "t1");
    });
    const res = await route(post({}), routeContext);
    expect(res.status).toBe(404);
    expect((await res.json()).message).toBe("Pickup task t1 not found.");
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.complete).not.toHaveBeenCalled();
  });

  it("honours notOnShift for the positions route only", async () => {
    const throwing = async () => {
      throw new NotAuthorizedError("Not on shift.");
    };
    expect((await apiRoute({}, throwing)(post({}), routeContext)).status).toBe(403);
    expect(
      (await apiRoute({ notOnShift: true }, throwing)(post({}), routeContext)).status,
    ).toBe(409);
  });

  describe("idempotency", () => {
    const schema = z.object({ bagId: z.string() });

    it("claims the key, runs once, and stores the answer", async () => {
      mocks.claim.mockResolvedValue({ state: "claimed" });
      const handler = vi.fn().mockResolvedValue({ body: { ok: true } });
      const route = apiRoute({ body: schema, mutating: true }, handler);
      const res = await route(
        post({ bagId: "b" }, { "Idempotency-Key": "key-1" }),
        routeContext,
      );
      expect(res.status).toBe(200);
      expect(mocks.claim).toHaveBeenCalledWith(ctx.core.db, {
        userId: "user-1",
        key: "key-1",
        route: "POST /api/v1/tasks/t1/visit/arrive",
        requestHash: hashBody({ bagId: "b" }),
        now: NOW,
      });
      expect(handler).toHaveBeenCalledTimes(1);
      expect(mocks.complete).toHaveBeenCalledWith(ctx.core.db, {
        userId: "user-1",
        key: "key-1",
        status: 200,
        body: { ok: true },
        now: NOW,
      });
    });

    it("replays the stored answer verbatim without running the handler", async () => {
      mocks.claim.mockResolvedValue({
        state: "replay",
        status: 409,
        body: { error: "conflict", message: "Sealed." },
      });
      const handler = vi.fn();
      const route = apiRoute({ body: schema, mutating: true }, handler);
      const res = await route(
        post({ bagId: "b" }, { "Idempotency-Key": "key-1" }),
        routeContext,
      );
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "conflict", message: "Sealed." });
      expect(handler).not.toHaveBeenCalled();
      expect(mocks.complete).not.toHaveBeenCalled();
    });

    it("tells a racing duplicate to retry and refuses a reused key", async () => {
      const route = apiRoute({ body: schema, mutating: true }, vi.fn());
      mocks.claim.mockResolvedValueOnce({ state: "in_progress" });
      let res = await route(
        post({ bagId: "b" }, { "Idempotency-Key": "k" }),
        routeContext,
      );
      expect(res.status).toBe(409);
      expect((await res.json()).error).toBe("idempotency_in_progress");

      mocks.claim.mockResolvedValueOnce({ state: "mismatch" });
      res = await route(post({ bagId: "b" }, { "Idempotency-Key": "k" }), routeContext);
      expect(res.status).toBe(422);
      expect((await res.json()).error).toBe("idempotency_mismatch");
    });

    it("stores a domain refusal but releases the key after a server failure", async () => {
      mocks.claim.mockResolvedValue({ state: "claimed" });
      const refusing = apiRoute({ body: schema, mutating: true }, async () => {
        throw new ConflictError("seal", "Sealed.");
      });
      await refusing(post({ bagId: "b" }, { "Idempotency-Key": "k1" }), routeContext);
      expect(mocks.complete).toHaveBeenCalledWith(
        ctx.core.db,
        expect.objectContaining({ key: "k1", status: 409 }),
      );

      const crashing = apiRoute({ body: schema, mutating: true }, async () => {
        throw new Error("db down");
      });
      const res = await crashing(
        post({ bagId: "b" }, { "Idempotency-Key": "k2" }),
        routeContext,
      );
      expect(res.status).toBe(500);
      expect(mocks.release).toHaveBeenCalledWith(ctx.core.db, {
        userId: "user-1",
        key: "k2",
      });
    });

    it("rejects an oversized key and ignores the header on non-mutating routes", async () => {
      const route = apiRoute({ body: schema, mutating: true }, vi.fn());
      const res = await route(
        post({ bagId: "b" }, { "Idempotency-Key": "x".repeat(129) }),
        routeContext,
      );
      expect(res.status).toBe(400);

      const read = apiRoute({}, async () => ({ body: { ok: true } }));
      await read(post({}, { "Idempotency-Key": "k" }), routeContext);
      expect(mocks.claim).not.toHaveBeenCalled();
    });
  });

  it("hashes bodies independent of key order and undefined members", () => {
    expect(stableStringify({ b: 1, a: [1, { d: 2, c: undefined }] })).toBe(
      '{"a":[1,{"d":2}],"b":1}',
    );
    expect(hashBody({ a: 1, b: 2 })).toBe(hashBody({ b: 2, a: 1 }));
    expect(hashBody(undefined)).toBe(hashBody(null));
  });
});
