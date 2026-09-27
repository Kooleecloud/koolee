import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  readTasks: vi.fn(),
}));

vi.mock("@/api/context", () => ({
  resolveApiContext: (...args: unknown[]) => mocks.resolve(...args),
}));
vi.mock("@/api/handlers/tasks", () => ({
  readTasks: (...args: unknown[]) => mocks.readTasks(...args),
}));

import * as route from "./route";

const NOW = new Date("2026-09-27T12:00:00.000Z");
const ctx = {
  core: { db: {}, clock: { now: () => NOW } },
  session: { kind: "agent", role: "agent", userId: "user-1" },
  identity: {},
  supabase: {},
  now: NOW,
};

function get() {
  return route.GET(new Request("http://localhost/api/v1/tasks"), {
    params: Promise.resolve({}),
  });
}

describe("GET /api/v1/tasks", () => {
  beforeEach(() => {
    mocks.resolve.mockReset().mockResolvedValue(ctx);
    mocks.readTasks.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("exposes GET only and opts out of caching", () => {
    expect(typeof route.GET).toBe("function");
    expect("POST" in route).toBe(false);
    expect(route.dynamic).toBe("force-dynamic");
  });

  it("answers the handler's list as a 200 body", async () => {
    const body = { verification: [], pickup: [], serverTime: NOW.toISOString() };
    mocks.readTasks.mockResolvedValue(body);
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(body);
    expect(mocks.readTasks).toHaveBeenCalledWith(ctx);
  });

  it("turns a database failure into a 500 with the generic message, never an empty list", async () => {
    mocks.readTasks.mockRejectedValue(new Error("db down"));
    const res = await get();
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe("internal");
    expect(json.message).not.toContain("db down");
  });
});
