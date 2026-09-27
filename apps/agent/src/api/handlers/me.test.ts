import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as Core from "@koolee/core";
import { meResponseSchema } from "@koolee/api-contract";

const mocks = vi.hoisted(() => ({ getActiveShift: vi.fn() }));

vi.mock("@koolee/core", async (importOriginal) => ({
  ...(await importOriginal<typeof Core>()),
  getActiveShift: (...a: unknown[]) => mocks.getActiveShift(...a),
}));

import type { ApiContext } from "../context";
import { readMe } from "./me";

const NOW = new Date("2026-09-27T12:00:00.000Z");
const createSignedUrl = vi.fn();

function context(avatarStoragePath: string | null): ApiContext {
  return {
    core: { db: {}, clock: { now: () => NOW } },
    session: {
      kind: "agent",
      role: "agent",
      userId: "6f1f8a2e-6c3e-4d4d-9c4a-1f0c1e2d3a4b",
    },
    identity: {
      session: {
        kind: "agent",
        role: "agent",
        userId: "6f1f8a2e-6c3e-4d4d-9c4a-1f0c1e2d3a4b",
      },
      email: "agent@koolee.local",
      fullName: "Nina Petrov",
      avatarStoragePath,
      canDrive: true,
    },
    supabase: { storage: { from: () => ({ createSignedUrl }) } },
    now: NOW,
  } as unknown as ApiContext;
}

describe("readMe", () => {
  beforeEach(() => {
    mocks.getActiveShift.mockReset().mockResolvedValue(null);
    createSignedUrl.mockReset();
  });

  it("returns the identity, a signed avatar URL and the server clock", async () => {
    createSignedUrl.mockResolvedValue({
      data: { signedUrl: "https://x/signed" },
      error: null,
    });
    const body = meResponseSchema.parse(
      await readMe(context("6f1f8a2e-6c3e-4d4d-9c4a-1f0c1e2d3a4b/a.jpg")),
    );
    expect(body.fullName).toBe("Nina Petrov");
    expect(body.avatarUrl).toBe("https://x/signed");
    expect(body.canDrive).toBe(true);
    expect(body.shift).toBeNull();
    expect(body.serverTime).toBe(NOW.toISOString());
    expect(createSignedUrl).toHaveBeenCalledWith(
      "6f1f8a2e-6c3e-4d4d-9c4a-1f0c1e2d3a4b/a.jpg",
      3600,
    );
  });

  it("leaves the avatar null when there is no photo or signing fails", async () => {
    expect((await readMe(context(null))).avatarUrl).toBeNull();
    expect(createSignedUrl).not.toHaveBeenCalled();
    createSignedUrl.mockResolvedValue({ data: null, error: { message: "nope" } });
    expect(
      (await readMe(context("6f1f8a2e-6c3e-4d4d-9c4a-1f0c1e2d3a4b/a.jpg"))).avatarUrl,
    ).toBeNull();
  });
});
