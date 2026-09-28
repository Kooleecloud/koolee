import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiHttpError } from "@/api/errors";

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  handler: vi.fn(),
}));

vi.mock("@/api/context", () => ({
  resolveApiContext: (...args: unknown[]) => mocks.resolve(...args),
}));
vi.mock("@/api/handlers/visit", () => ({
  confirmPassport: (...args: unknown[]) => mocks.handler(...args),
}));

import * as route from "./route";

const TASK_ID = "00000000-0000-4000-8000-000000000002";
const NOW = new Date("2026-09-27T12:00:00.000Z");
const ctx = {
  core: { db: {}, clock: { now: () => NOW } },
  session: { kind: "agent", role: "agent", userId: "user-1" },
  identity: {},
  supabase: {},
  now: NOW,
};

function post(body: unknown) {
  return new Request(`http://localhost/api/v1/tasks/${TASK_ID}/visit/confirm-passport`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
const routeContext = { params: Promise.resolve({ taskId: TASK_ID }) };

describe("POST /api/v1/tasks/[taskId]/visit/confirm-passport", () => {
  beforeEach(() => {
    mocks.resolve.mockReset().mockResolvedValue(ctx);
    mocks.handler.mockReset().mockResolvedValue({ ok: true });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("exposes POST only and opts out of caching", () => {
    expect(typeof route.POST).toBe("function");
    expect("GET" in route).toBe(false);
    expect(route.dynamic).toBe("force-dynamic");
  });

  it("hands the task id and the contract-parsed body to the handler and answers 200", async () => {
    const res = await route.POST(post({ lat: 1, lng: 2 }), routeContext);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mocks.handler).toHaveBeenCalledTimes(1);
    const [gotCtx, taskId, body] = mocks.handler.mock.calls[0]!;
    expect(gotCtx).toBe(ctx);
    expect(taskId).toBe(TASK_ID);
    expect(body).toEqual({ lat: 1, lng: 2 });
  });

  it("rejects a body the confirmPassportRequestSchema refuses with 400 invalid_body before the handler runs", async () => {
    const res = await route.POST(post({ lng: "east" }), routeContext);
    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: string; message: string };
    expect(json.error).toBe("invalid_body");
    expect(json.message).toContain("lng");
    expect(mocks.handler).not.toHaveBeenCalled();
  });

  it("maps a handler refusal to its status and body", async () => {
    mocks.handler.mockRejectedValue(new ApiHttpError("refused", "Seal every bag first."));
    const res = await route.POST(post({ lat: 1, lng: 2 }), routeContext);
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      error: "refused",
      message: "Seal every bag first.",
    });
  });
});
