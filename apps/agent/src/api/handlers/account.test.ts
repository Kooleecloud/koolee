import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as Core from "@koolee/core";
import { clearUserAvatar, setUserAvatar } from "@koolee/core";
import { avatarResponseSchema } from "@koolee/api-contract";

import type { ApiContext } from "../context";
import { ApiHttpError } from "../errors";
import { clearAvatar, setAvatar } from "./account";

vi.mock("@koolee/core", async (importOriginal) => ({
  ...(await importOriginal<typeof Core>()),
  setUserAvatar: vi.fn(),
  clearUserAvatar: vi.fn(),
}));

const NOW = new Date("2026-09-27T12:00:00.000Z");
const USER_ID = "6f1f8a2e-6c3e-4d4d-9c4a-1f0c1e2d3a4b";
const OTHER_USER_ID = "0b2c3d4e-5f60-4718-8a9b-0c1d2e3f4a5b";
const PATH = `${USER_ID}/photo-1.jpg`;

/**
 * `createSignedUrl` is the one storage call the handler makes, twice: once to
 * prove the object exists (`assertObjectExists`) and once to mint the URL the
 * app displays. `found` flips both.
 */
function fakeContext(options: { found: boolean }): {
  ctx: ApiContext;
  createSignedUrl: ReturnType<typeof vi.fn>;
} {
  const createSignedUrl = vi.fn(async (path: string) =>
    options.found
      ? { data: { signedUrl: `https://storage.test/${path}?signed` }, error: null }
      : { data: null, error: { message: "Object not found" } },
  );
  const ctx = {
    core: { db: {}, clock: { now: () => NOW } },
    session: { kind: "agent", role: "agent", userId: USER_ID },
    identity: {
      session: { kind: "agent", role: "agent", userId: USER_ID },
      email: "agent@koolee.local",
      fullName: null,
      avatarStoragePath: null,
      canDrive: true,
    },
    supabase: { storage: { from: () => ({ createSignedUrl }) } },
    now: NOW,
  } as unknown as ApiContext;
  return { ctx, createSignedUrl };
}

beforeEach(() => {
  vi.mocked(setUserAvatar).mockReset();
  vi.mocked(clearUserAvatar).mockReset();
});

describe("setAvatar", () => {
  it("records the key and answers with a signed URL once the object is proven", async () => {
    const { ctx, createSignedUrl } = fakeContext({ found: true });

    const result = await setAvatar(ctx, { storagePath: PATH });

    expect(setUserAvatar).toHaveBeenCalledWith(ctx.core.db, {
      userId: USER_ID,
      storagePath: PATH,
    });
    // The wire shape the app parses, not just the TS type.
    expect(avatarResponseSchema.parse(result)).toEqual(result);
    expect(result).toEqual({
      ok: true,
      avatarStoragePath: PATH,
      avatarUrl: `https://storage.test/${PATH}?signed`,
    });
    // Existence check first, then the display URL with the bucket's TTL.
    expect(createSignedUrl).toHaveBeenNthCalledWith(1, PATH, 60);
    expect(createSignedUrl).toHaveBeenNthCalledWith(2, PATH, 3600);
  });

  it("refuses a key outside the caller's own folder before touching storage or the row", async () => {
    const { ctx, createSignedUrl } = fakeContext({ found: true });

    await expect(
      setAvatar(ctx, { storagePath: `${OTHER_USER_ID}/photo-1.jpg` }),
    ).rejects.toMatchObject({ status: 400, body: { error: "invalid_input" } });

    expect(createSignedUrl).not.toHaveBeenCalled();
    expect(setUserAvatar).not.toHaveBeenCalled();
  });

  it("refuses a traversal attempt that happens to start with the right prefix", async () => {
    const { ctx } = fakeContext({ found: true });

    const error = await setAvatar(ctx, {
      storagePath: `${USER_ID}/../${OTHER_USER_ID}/x.jpg`,
    })
      .then(() => null)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiHttpError);
    expect(setUserAvatar).not.toHaveBeenCalled();
  });

  it("refuses a key whose object does not exist, and never records it", async () => {
    const { ctx } = fakeContext({ found: false });

    await expect(setAvatar(ctx, { storagePath: PATH })).rejects.toMatchObject({
      status: 400,
      body: { error: "invalid_input", field: "storagePath" },
    });

    expect(setUserAvatar).not.toHaveBeenCalled();
  });

  it("lets a core error propagate untouched", async () => {
    const { ctx } = fakeContext({ found: true });
    const boom = new Error("db down");
    vi.mocked(setUserAvatar).mockRejectedValueOnce(boom);

    await expect(setAvatar(ctx, { storagePath: PATH })).rejects.toBe(boom);
  });
});

describe("clearAvatar", () => {
  it("clears the row and answers with nulls", async () => {
    const { ctx, createSignedUrl } = fakeContext({ found: true });

    const result = await clearAvatar(ctx);

    expect(clearUserAvatar).toHaveBeenCalledWith(ctx.core.db, USER_ID);
    expect(avatarResponseSchema.parse(result)).toEqual(result);
    expect(result).toEqual({ ok: true, avatarStoragePath: null, avatarUrl: null });
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it("lets a core error propagate untouched", async () => {
    const { ctx } = fakeContext({ found: true });
    const boom = new Error("no such user");
    vi.mocked(clearUserAvatar).mockRejectedValueOnce(boom);

    await expect(clearAvatar(ctx)).rejects.toBe(boom);
  });
});
