import { describe, expect, it, vi } from "vitest";

import { handleAvatarUpload, type AvatarUploadDeps } from "./avatar-upload";
import { BUCKETS } from "./buckets";

const USER_ID = "11111111-2222-3333-4444-555555555555";

function deps(overrides: Partial<AvatarUploadDeps> = {}): AvatarUploadDeps {
  return {
    userId: USER_ID,
    storage: { upload: vi.fn(async ({ path }) => path) },
    recordAvatar: vi.fn(async () => {}),
    ...overrides,
  };
}

const jpeg = (bytes: number) => ({
  data: new Uint8Array(bytes),
  mimeType: "image/jpeg",
});

describe("handleAvatarUpload", () => {
  it("stores under the user's own folder", async () => {
    const d = deps();
    const outcome = await handleAvatarUpload(d, jpeg(1024));

    expect(outcome.ok).toBe(true);
    // The prefix is what migration 0027's storage policy matches on.
    expect(outcome.ok && outcome.storagePath.startsWith(`${USER_ID}/`)).toBe(true);
    expect(outcome.ok && outcome.storagePath.endsWith(".jpg")).toBe(true);
  });

  it("records the path only after the object is stored", async () => {
    const calls: string[] = [];
    const d = deps({
      storage: {
        upload: vi.fn(async ({ path }) => {
          calls.push("upload");
          return path;
        }),
      },
      recordAvatar: vi.fn(async () => {
        calls.push("record");
      }),
    });

    await handleAvatarUpload(d, jpeg(1024));
    expect(calls).toEqual(["upload", "record"]);
  });

  it("does not record when the object failed to store", async () => {
    // The bad case this ordering exists to prevent: a profile pointing at an
    // object that is not there renders a broken image everywhere.
    const record = vi.fn(async () => {});
    const d = deps({
      storage: { upload: vi.fn(async () => null) },
      recordAvatar: record,
    });

    const outcome = await handleAvatarUpload(d, jpeg(1024));
    expect(outcome).toMatchObject({ ok: false, status: 503 });
    expect(record).not.toHaveBeenCalled();
  });

  it("refuses an empty pick", async () => {
    expect(await handleAvatarUpload(deps(), null)).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(await handleAvatarUpload(deps(), jpeg(0))).toMatchObject({
      ok: false,
      status: 400,
    });
  });

  it("refuses a file over the bucket's upload limit", async () => {
    const outcome = await handleAvatarUpload(
      deps(),
      jpeg(BUCKETS.avatars.maxUploadBytes + 1),
    );
    expect(outcome).toMatchObject({ ok: false, status: 413 });
  });

  it("accepts a file exactly at the limit", async () => {
    const outcome = await handleAvatarUpload(
      deps(),
      jpeg(BUCKETS.avatars.maxUploadBytes),
    );
    expect(outcome.ok).toBe(true);
  });

  it.each(["application/pdf", "image/heic", "text/html", "image/svg+xml"])(
    "refuses %s",
    async (mimeType) => {
      const outcome = await handleAvatarUpload(deps(), {
        data: new Uint8Array(16),
        mimeType,
      });
      expect(outcome).toMatchObject({ ok: false, status: 415 });
    },
  );

  it.each([...BUCKETS.avatars.mimeTypes])("accepts %s", async (mimeType) => {
    const outcome = await handleAvatarUpload(deps(), {
      data: new Uint8Array(16),
      mimeType,
    });
    expect(outcome.ok).toBe(true);
  });

  it("gives each upload a distinct key so a replacement never overwrites", async () => {
    const d = deps();
    const a = await handleAvatarUpload(d, jpeg(64));
    const b = await handleAvatarUpload(d, jpeg(64));
    expect(a.ok && b.ok && a.storagePath).not.toBe(b.ok && b.storagePath);
  });
});
