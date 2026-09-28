import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as Bearer from "@/lib/supabase/bearer";
import { AuthApiError, AuthRetryableFetchError } from "@supabase/supabase-js";
import type * as Core from "@koolee/core";
import { NotAuthorizedError } from "@koolee/core";

/**
 * The four answers to "who is this?" — and, above all, that a failure to ASK
 * never comes back as "signed out". The native app signs a driver out on a
 * 401/403, so a GoTrue or database blip mapped to either would end a shift.
 */

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  bearerClient: vi.fn(),
  serverClient: vi.fn(),
  tryGetCore: vi.fn(),
  requireStaffRole: vi.fn(),
  getStaffIdentity: vi.fn(),
}));

vi.mock("@/lib/supabase/bearer", async (importOriginal) => ({
  ...(await importOriginal<typeof Bearer>()),
  getSupabaseBearerClient: (...a: unknown[]) => mocks.bearerClient(...a),
}));
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServerClient: (...a: unknown[]) => mocks.serverClient(...a),
}));
vi.mock("@/lib/core", () => ({ tryGetCore: () => mocks.tryGetCore() }));
vi.mock("@koolee/core", async (importOriginal) => ({
  ...(await importOriginal<typeof Core>()),
  requireStaffRole: (...a: unknown[]) => mocks.requireStaffRole(...a),
  getStaffIdentity: (...a: unknown[]) => mocks.getStaffIdentity(...a),
}));

import { getAgentIdentity, requireAgentSession, resolveAgentIdentity } from "./session";

const USER = { id: "6f1f8a2e-6c3e-4d4d-9c4a-1f0c1e2d3a4b", email: "agent@koolee.local" };

function bearer(): Request {
  return new Request("http://localhost/api/v1/me", {
    headers: { authorization: "Bearer tok-1" },
  });
}

describe("resolveAgentIdentity", () => {
  beforeEach(() => {
    for (const fn of Object.values(mocks)) fn.mockReset();
    const client = { auth: { getUser: mocks.getUser } };
    mocks.bearerClient.mockReturnValue(client);
    mocks.serverClient.mockResolvedValue(client);
    mocks.tryGetCore.mockReturnValue({ db: { tag: "db" } });
    mocks.requireStaffRole.mockResolvedValue("agent");
    mocks.getStaffIdentity.mockResolvedValue({
      fullName: "Leo Vargas",
      email: USER.email,
      avatarStoragePath: null,
      canDrive: true,
    });
  });

  it("answers ok for an active agent, validating the bearer token against GoTrue", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: USER }, error: null });
    const result = await resolveAgentIdentity(bearer());
    expect(result.status).toBe("ok");
    expect(mocks.getUser).toHaveBeenCalledWith("tok-1");
    expect(mocks.requireStaffRole).toHaveBeenCalledWith({ tag: "db" }, USER.id, [
      "agent",
    ]);
    if (result.status === "ok") {
      expect(result.identity.session).toEqual({
        kind: "agent",
        role: "agent",
        userId: USER.id,
      });
      expect(result.identity.canDrive).toBe(true);
    }
  });

  it("answers signed_out for a token GoTrue rejects", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: null },
      error: new AuthApiError("invalid JWT", 401, "bad_jwt"),
    });
    expect(await resolveAgentIdentity(bearer())).toEqual({ status: "signed_out" });
    expect(mocks.requireStaffRole).not.toHaveBeenCalled();
  });

  it("answers unavailable — never signed_out — when GoTrue cannot be reached", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: null },
      error: new AuthRetryableFetchError("fetch failed", 0),
    });
    expect((await resolveAgentIdentity(bearer())).status).toBe("unavailable");
  });

  it("answers unavailable for a GoTrue 5xx or a rate limit", async () => {
    for (const status of [500, 503, 429]) {
      mocks.getUser.mockResolvedValueOnce({
        data: { user: null },
        error: new AuthApiError("upstream", status, "unexpected_failure"),
      });
      expect((await resolveAgentIdentity(bearer())).status).toBe("unavailable");
    }
  });

  it("answers forbidden, with core's sentence, for a real session without the agent role", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: USER }, error: null });
    mocks.requireStaffRole.mockRejectedValue(
      new NotAuthorizedError("No active staff role for this account."),
    );
    expect(await resolveAgentIdentity(bearer())).toEqual({
      status: "forbidden",
      message: "No active staff role for this account.",
    });
  });

  it("answers unavailable when the role check's database read fails", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: USER }, error: null });
    mocks.requireStaffRole.mockRejectedValue(new Error("connect ECONNREFUSED"));
    expect((await resolveAgentIdentity(bearer())).status).toBe("unavailable");
  });

  it("answers unavailable when Supabase or the database is not configured", async () => {
    mocks.bearerClient.mockReturnValue(null);
    expect((await resolveAgentIdentity(bearer())).status).toBe("unavailable");
    mocks.bearerClient.mockReturnValue({ auth: { getUser: mocks.getUser } });
    mocks.getUser.mockResolvedValue({ data: { user: USER }, error: null });
    mocks.tryGetCore.mockReturnValue(null);
    expect((await resolveAgentIdentity(bearer())).status).toBe("unavailable");
  });

  it("uses the cookie client when there is no bearer header", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: USER }, error: null });
    const result = await resolveAgentIdentity(new Request("http://localhost/tasks"));
    expect(result.status).toBe("ok");
    expect(mocks.serverClient).toHaveBeenCalled();
    expect(mocks.bearerClient).not.toHaveBeenCalled();
  });

  it("getAgentIdentity is null for every answer but ok", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: null },
      error: new AuthRetryableFetchError("fetch failed", 0),
    });
    expect(await getAgentIdentity(bearer())).toBeNull();
  });

  it("requireAgentSession refuses signed-out and forbidden, and rethrows an outage as itself", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    await expect(requireAgentSession(bearer())).rejects.toBeInstanceOf(
      NotAuthorizedError,
    );

    mocks.getUser.mockResolvedValue({ data: { user: USER }, error: null });
    mocks.requireStaffRole.mockRejectedValue(new Error("db down"));
    const outage = await requireAgentSession(bearer()).catch((e: unknown) => e);
    expect(outage).toBeInstanceOf(Error);
    expect(outage).not.toBeInstanceOf(NotAuthorizedError);
    expect((outage as Error).message).toBe("db down");
  });
});
