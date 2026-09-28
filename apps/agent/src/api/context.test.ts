import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as Bearer from "@/lib/supabase/bearer";

import { ApiHttpError } from "./errors";

/**
 * The identity answer as HTTP: only a real "no" may become 401/403, because
 * the native app signs the driver out on those. An outage is a 503.
 */

const mocks = vi.hoisted(() => ({
  resolveAgentIdentity: vi.fn(),
  tryGetCore: vi.fn(),
  bearerClient: vi.fn(),
  serverClient: vi.fn(),
}));

vi.mock("@/lib/session", () => ({
  resolveAgentIdentity: (...a: unknown[]) => mocks.resolveAgentIdentity(...a),
}));
vi.mock("@/lib/core", () => ({ tryGetCore: () => mocks.tryGetCore() }));
vi.mock("@/lib/supabase/bearer", async (importOriginal) => ({
  ...(await importOriginal<typeof Bearer>()),
  getSupabaseBearerClient: (...a: unknown[]) => mocks.bearerClient(...a),
}));
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServerClient: (...a: unknown[]) => mocks.serverClient(...a),
}));

import { resolveActionContext, resolveApiContext } from "./context";

const NOW = new Date("2026-09-27T12:00:00.000Z");
const IDENTITY = {
  session: { kind: "agent", role: "agent", userId: "u-1" },
  email: null,
  fullName: null,
  avatarStoragePath: null,
  canDrive: true,
};

function bearer(): Request {
  return new Request("http://localhost/api/v1/me", {
    headers: { authorization: "Bearer tok-1" },
  });
}

async function statusOf(promise: Promise<unknown>): Promise<[number, string]> {
  const error = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ApiHttpError);
  return [(error as ApiHttpError).status, (error as ApiHttpError).body.error];
}

describe("resolveApiContext / resolveActionContext", () => {
  beforeEach(() => {
    for (const fn of Object.values(mocks)) fn.mockReset();
    mocks.tryGetCore.mockReturnValue({ db: {}, clock: { now: () => NOW } });
    mocks.bearerClient.mockReturnValue({ tag: "bearer" });
    mocks.serverClient.mockResolvedValue({ tag: "cookie" });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("builds the context from an ok answer with the caller-bound client", async () => {
    mocks.resolveAgentIdentity.mockResolvedValue({ status: "ok", identity: IDENTITY });
    const ctx = await resolveApiContext(bearer());
    expect(ctx.session.userId).toBe("u-1");
    expect(ctx.supabase).toEqual({ tag: "bearer" });
    expect(ctx.now).toBe(NOW);

    const action = await resolveActionContext();
    expect(action.supabase).toEqual({ tag: "cookie" });
  });

  it("maps signed_out to 401 and forbidden to 403", async () => {
    mocks.resolveAgentIdentity.mockResolvedValue({ status: "signed_out" });
    expect(await statusOf(resolveApiContext(bearer()))).toEqual([401, "not_authorized"]);

    mocks.resolveAgentIdentity.mockResolvedValue({
      status: "forbidden",
      message: "nope",
    });
    expect(await statusOf(resolveApiContext(bearer()))).toEqual([403, "forbidden"]);
  });

  it("maps an outage to 503 on both transports and logs the cause", async () => {
    const cause = new Error("GoTrue down");
    mocks.resolveAgentIdentity.mockResolvedValue({ status: "unavailable", cause });
    expect(await statusOf(resolveApiContext(bearer()))).toEqual([503, "unavailable"]);
    expect(await statusOf(resolveActionContext())).toEqual([503, "unavailable"]);
    expect(console.error).toHaveBeenCalledWith("[api] identity check failed", cause);
  });

  it("answers 503 when core or Supabase is not configured", async () => {
    mocks.resolveAgentIdentity.mockResolvedValue({ status: "ok", identity: IDENTITY });
    mocks.tryGetCore.mockReturnValue(null);
    expect(await statusOf(resolveApiContext(bearer()))).toEqual([503, "unavailable"]);
    mocks.tryGetCore.mockReturnValue({ db: {}, clock: { now: () => NOW } });
    mocks.bearerClient.mockReturnValue(null);
    expect(await statusOf(resolveApiContext(bearer()))).toEqual([503, "unavailable"]);
  });
});
