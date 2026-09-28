import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotFoundError } from "@koolee/core";

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  readTaskDetail: vi.fn(),
}));

vi.mock("@/api/context", () => ({
  resolveApiContext: (...args: unknown[]) => mocks.resolve(...args),
}));
vi.mock("@/api/handlers/tasks", () => ({
  readTaskDetail: (...args: unknown[]) => mocks.readTaskDetail(...args),
}));

import * as route from "./route";

const NOW = new Date("2026-09-27T12:00:00.000Z");
const TASK_ID = "44444444-4444-4444-8444-444444444444";
const ctx = {
  core: { db: {}, clock: { now: () => NOW } },
  session: { kind: "agent", role: "agent", userId: "user-1" },
  identity: {},
  supabase: {},
  now: NOW,
};

/** `null` stands for "no segment" — `undefined` would just pick the default. */
function get(query = "", taskId: string | null = TASK_ID) {
  const request = new Request(`http://localhost/api/v1/tasks/${taskId ?? ""}${query}`);
  const record: Record<string, string> = {};
  if (taskId !== null) record.taskId = taskId;
  const params = Promise.resolve(record);
  return route.GET(request, { params });
}

describe("GET /api/v1/tasks/:taskId", () => {
  beforeEach(() => {
    mocks.resolve.mockReset().mockResolvedValue(ctx);
    mocks.readTaskDetail
      .mockReset()
      .mockResolvedValue({ kind: "verification", visit: {} });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("exposes GET only and opts out of caching", () => {
    expect(typeof route.GET).toBe("function");
    expect("POST" in route).toBe(false);
    expect(route.dynamic).toBe("force-dynamic");
  });

  it("reads a pickup when the query says so", async () => {
    mocks.readTaskDetail.mockResolvedValue({ kind: "pickup", pickup: {} });
    const res = await get("?kind=pickup");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ kind: "pickup", pickup: {} });
    expect(mocks.readTaskDetail).toHaveBeenCalledWith(ctx, TASK_ID, "pickup");
  });

  it("treats a missing or unknown kind as a verification, like the page", async () => {
    await get();
    await get("?kind=verification");
    await get("?kind=nonsense");
    expect(mocks.readTaskDetail.mock.calls.map((call) => call[2])).toEqual([
      "verification",
      "verification",
      "verification",
    ]);
  });

  it("answers 404 not_found when core says the task is not this agent's", async () => {
    mocks.readTaskDetail.mockRejectedValue(new NotFoundError("Pickup task", TASK_ID));
    const res = await get("?kind=pickup");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: "not_found",
      message: `Pickup task ${TASK_ID} not found.`,
    });
  });

  it("answers 404 without calling the handler when the segment is empty", async () => {
    const res = await get("", null);
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("not_found");
    expect(mocks.readTaskDetail).not.toHaveBeenCalled();
  });

  it("answers 401 before touching the handler when there is no session", async () => {
    const { ApiHttpError } = await import("@/api/errors");
    mocks.resolve.mockRejectedValue(
      new ApiHttpError("not_authorized", "Please sign in again."),
    );
    const res = await get("?kind=pickup");
    expect(res.status).toBe(401);
    expect(mocks.readTaskDetail).not.toHaveBeenCalled();
  });
});
