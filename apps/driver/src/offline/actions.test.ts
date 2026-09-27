import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiErrorCode } from "@koolee/api-contract";

/**
 * The action queue against a fake `action_queue` table and a scripted API.
 * The sqlite handle below understands exactly the statements `actions.ts`
 * issues; anything else throws, so a new query shows up here as a failure
 * rather than as a silently empty result.
 */

interface Row {
  id: number;
  idempotency_key: string;
  method: string;
  path: string;
  body: string | null;
  label: string;
  attempts: number;
  last_error: string | null;
  photo: string | null;
}

const table: { rows: Row[]; nextId: number } = { rows: [], nextId: 1 };

const fakeHandle = {
  async getAllAsync(sql: string) {
    if (sql.startsWith("PRAGMA table_info")) return [{ name: "id" }, { name: "body" }];
    throw new Error(`unexpected getAllAsync: ${sql}`);
  },
  async execAsync(sql: string) {
    if (!sql.startsWith("ALTER TABLE action_queue ADD COLUMN photo"))
      throw new Error(`unexpected execAsync: ${sql}`);
  },
  async getFirstAsync(sql: string) {
    if (sql.includes("COUNT(*)")) return { n: table.rows.length };
    if (sql.includes("ORDER BY id LIMIT 1")) return table.rows[0] ?? null;
    throw new Error(`unexpected getFirstAsync: ${sql}`);
  },
  async runAsync(sql: string, ...params: unknown[]) {
    if (sql.startsWith("INSERT INTO action_queue")) {
      const [idempotency_key, method, path, body, label, , photo] = params as [
        string,
        string,
        string,
        string | null,
        string,
        string,
        string | null,
      ];
      const id = table.nextId++;
      table.rows.push({
        id,
        idempotency_key,
        method,
        path,
        body,
        label,
        attempts: 0,
        last_error: null,
        photo,
      });
      return { lastInsertRowId: id, changes: 1 };
    }
    if (sql.startsWith("DELETE FROM action_queue WHERE id = ?")) {
      table.rows = table.rows.filter((r) => r.id !== params[0]);
      return { lastInsertRowId: 0, changes: 1 };
    }
    if (sql.startsWith("UPDATE action_queue SET photo = NULL")) {
      const row = table.rows.find((r) => r.id === params[0]);
      if (row) row.photo = null;
      return { lastInsertRowId: 0, changes: 1 };
    }
    if (sql.startsWith("UPDATE action_queue SET attempts = attempts + 1")) {
      const row = table.rows.find((r) => r.id === params[1]);
      if (row) {
        row.attempts += 1;
        row.last_error = params[0] as string;
      }
      return { lastInsertRowId: 0, changes: 1 };
    }
    throw new Error(`unexpected runAsync: ${sql}`);
  },
};

vi.mock("../location/queue", () => ({ db: async () => fakeHandle }));

const apiFetch = vi.fn();
vi.mock("../lib/api", () => {
  class ApiRequestError extends Error {
    status: number;
    body: { error: string; message: string } | null;
    constructor(
      status: number,
      body: { error: string; message: string } | null,
      fallback: string,
    ) {
      super(body?.message ?? fallback);
      this.name = "ApiRequestError";
      this.status = status;
      this.body = body;
    }
    get code() {
      return this.body?.error ?? null;
    }
  }
  class NetworkError extends Error {
    constructor(cause: unknown) {
      super("Check your connection and try again.");
      this.name = "NetworkError";
      this.cause = cause;
    }
  }
  return {
    apiFetch: (...args: unknown[]) => apiFetch(...args),
    ApiRequestError,
    NetworkError,
  };
});

/** What the phone believes about its connection when a 401 comes back. */
const network = { isConnected: true, isInternetReachable: true };
vi.mock("expo-network", () => ({
  getNetworkStateAsync: async () => ({ ...network }),
}));

const uploadPhoto = vi.fn();
vi.mock("../lib/photos", () => {
  class PhotoError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "PhotoError";
    }
  }
  return { uploadPhoto: (...args: unknown[]) => uploadPhoto(...args), PhotoError };
});

import { ApiRequestError, NetworkError } from "../lib/api";
import { PhotoError } from "../lib/photos";
import {
  enqueueAction,
  onQueueChange,
  queuedActionCount,
  replayActions,
  runStep,
} from "./actions";

const offline = () => Promise.reject(new NetworkError(new Error("offline")));
const refused = (status: number, error: ApiErrorCode, message: string) => () =>
  Promise.reject(
    new ApiRequestError(status, { error, message }, "Something went wrong."),
  );

const PHOTO = {
  bucket: "bag-photos" as const,
  path: "bags/bag-1/x.jpg",
  uri: "file:///tmp/x.jpg",
  contentType: "image/jpeg" as const,
};

beforeEach(() => {
  table.rows = [];
  table.nextId = 1;
  network.isConnected = true;
  network.isInternetReachable = true;
  apiFetch.mockReset();
  uploadPhoto.mockReset();
  uploadPhoto.mockResolvedValue({ path: PHOTO.path });
});

describe("runStep", () => {
  it("sends the step now with a fresh idempotency key and queues nothing", async () => {
    apiFetch.mockResolvedValue({ ok: true });
    const out = await runStep({ label: "Arrive", path: "/api/v1/tasks/t/visit/arrive" });
    expect(out).toEqual({ queued: false });
    expect(apiFetch).toHaveBeenCalledTimes(1);
    const [, path, init] = apiFetch.mock.calls[0] as [
      unknown,
      string,
      { idempotencyKey: string },
    ];
    expect(path).toBe("/api/v1/tasks/t/visit/arrive");
    expect(init.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(await queuedActionCount()).toBe(0);
  });

  it("queues the step under the SAME key when there is no connection", async () => {
    apiFetch.mockImplementation(offline);
    const out = await runStep({
      label: "Seal bag 1",
      path: "/api/v1/tasks/t/visit/seal-bag",
      body: { bagId: "b", sealCode: "S1" },
    });
    expect(out).toEqual({ queued: true });
    expect(table.rows).toHaveLength(1);
    const [, , init] = apiFetch.mock.calls[0] as [
      unknown,
      string,
      { idempotencyKey: string },
    ];
    expect(table.rows[0]!.idempotency_key).toBe(init.idempotencyKey);
    expect(table.rows[0]!.body).toBe(JSON.stringify({ bagId: "b", sealCode: "S1" }));
    expect(table.rows[0]!.label).toBe("Seal bag 1");
  });

  it("rethrows a server refusal instead of queueing it", async () => {
    apiFetch.mockImplementation(
      refused(409, "conflict", "Seal S1 is already on another bag."),
    );
    await expect(runStep({ label: "Seal bag 1", path: "/p" })).rejects.toMatchObject({
      message: "Seal S1 is already on another bag.",
    });
    expect(table.rows).toHaveLength(0);
  });

  it("queues a 401 taken without a signal: the token lapsed offline, not the step", async () => {
    // `apiFetch` throws this before any request when supabase-js has no token
    // to hand back — which is what an expired session looks like in a
    // basement. The step is sound and the session returns with the signal.
    network.isConnected = false;
    apiFetch.mockImplementation(refused(401, "not_authorized", "Please sign in again."));
    const out = await runStep({ label: "Seal bag 1", path: "/p", body: { a: 1 } });
    expect(out).toEqual({ queued: true });
    expect(table.rows).toHaveLength(1);
    expect(table.rows[0]!.label).toBe("Seal bag 1");
  });

  it("rethrows a 401 the server actually sent — the phone is online", async () => {
    apiFetch.mockImplementation(refused(401, "not_authorized", "Please sign in again."));
    await expect(runStep({ label: "Seal bag 1", path: "/p" })).rejects.toMatchObject({
      status: 401,
      message: "Please sign in again.",
    });
    expect(table.rows).toHaveLength(0);
  });

  it("uploads the photo first, and keeps it with the queued step only if the upload never happened", async () => {
    // Upload fails offline: the row carries the photo for replay.
    uploadPhoto.mockRejectedValueOnce(new NetworkError(new Error("offline")));
    expect(await runStep({ label: "Seal bag 1", path: "/p", photo: PHOTO })).toEqual({
      queued: true,
    });
    expect(apiFetch).not.toHaveBeenCalled();
    expect(JSON.parse(table.rows[0]!.photo!)).toEqual(PHOTO);

    // Upload lands, POST fails offline: the row carries no photo.
    table.rows = [];
    apiFetch.mockImplementation(offline);
    expect(await runStep({ label: "Seal bag 2", path: "/p", photo: PHOTO })).toEqual({
      queued: true,
    });
    expect(table.rows[0]!.photo).toBeNull();
  });

  it("rethrows a photo problem rather than queueing something that cannot succeed", async () => {
    uploadPhoto.mockRejectedValueOnce(
      new PhotoError("That photo is no longer on this phone."),
    );
    await expect(
      runStep({ label: "x", path: "/p", photo: PHOTO }),
    ).rejects.toBeInstanceOf(PhotoError);
    expect(table.rows).toHaveLength(0);
  });
});

describe("replayActions", () => {
  const queue = (n: number, over: Partial<Parameters<typeof enqueueAction>[0]> = {}) =>
    Promise.all(
      Array.from({ length: n }, (_, i) =>
        enqueueAction({
          label: `step ${i + 1}`,
          method: "POST",
          path: `/p/${i + 1}`,
          body: { i: i + 1 },
          idempotencyKey: `k-${i + 1}`,
          ...over,
        }),
      ),
    );

  it("replays oldest first, one at a time, with each row's stored key", async () => {
    await queue(3);
    apiFetch.mockResolvedValue({ ok: true });
    const result = await replayActions();
    expect(result).toEqual({ replayed: 3, failed: 0, remaining: 0 });
    expect(apiFetch.mock.calls.map((c) => (c as [unknown, string])[1])).toEqual([
      "/p/1",
      "/p/2",
      "/p/3",
    ]);
    expect(
      apiFetch.mock.calls.map(
        (c) => (c as [unknown, string, { idempotencyKey: string }])[2],
      ),
    ).toMatchObject([
      { idempotencyKey: "k-1", body: { i: 1 }, method: "POST" },
      { idempotencyKey: "k-2" },
      { idempotencyKey: "k-3" },
    ]);
    expect(table.rows).toHaveLength(0);
  });

  it("drops a 4xx, records the message, tells the caller, and carries on", async () => {
    await queue(2);
    const onActionFailed = vi.fn();
    apiFetch
      .mockImplementationOnce(
        refused(409, "conflict", "Seal S1 is already on another bag."),
      )
      .mockResolvedValueOnce({ ok: true });
    const result = await replayActions({ onActionFailed });
    expect(result).toEqual({ replayed: 1, failed: 1, remaining: 0 });
    expect(onActionFailed).toHaveBeenCalledWith({
      id: 1,
      label: "step 1",
      message: "Seal S1 is already on another bag.",
      status: 409,
    });
    expect(table.rows).toHaveLength(0);
  });

  it("keeps the row on a 5xx, bumps attempts, and stops", async () => {
    await queue(2);
    apiFetch.mockImplementation(refused(503, "unavailable", "Try again in a moment."));
    const result = await replayActions();
    expect(result).toEqual({ replayed: 0, failed: 0, remaining: 2 });
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(table.rows[0]).toMatchObject({
      attempts: 1,
      last_error: "Try again in a moment.",
    });
    expect(table.rows[1]).toMatchObject({ attempts: 0 });
  });

  it("keeps the row and stops when the connection is gone", async () => {
    await queue(2);
    apiFetch.mockImplementation(offline);
    const result = await replayActions();
    expect(result).toEqual({ replayed: 0, failed: 0, remaining: 2 });
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(table.rows[0]!.attempts).toBe(1);
  });

  it("keeps the row on a lapsed session and on idempotency_in_progress: both succeed later", async () => {
    await queue(1);
    apiFetch.mockImplementation(refused(401, "not_authorized", "Please sign in again."));
    expect(await replayActions()).toEqual({ replayed: 0, failed: 0, remaining: 1 });

    apiFetch.mockImplementation(
      refused(409, "idempotency_in_progress", "Still working on that — retry shortly."),
    );
    expect(await replayActions()).toEqual({ replayed: 0, failed: 0, remaining: 1 });
    expect(table.rows[0]!.attempts).toBe(2);
  });

  it("uploads a queued photo before its POST and forgets the local file once it is up", async () => {
    await queue(1, { photo: PHOTO });
    apiFetch.mockResolvedValue({ ok: true });
    const order: string[] = [];
    uploadPhoto.mockImplementation(async () => {
      order.push("upload");
      return { path: PHOTO.path };
    });
    apiFetch.mockImplementation(async () => {
      order.push("post");
      return { ok: true };
    });
    expect(await replayActions()).toEqual({ replayed: 1, failed: 0, remaining: 0 });
    expect(order).toEqual(["upload", "post"]);
    expect(uploadPhoto).toHaveBeenCalledWith(PHOTO);
  });

  it("clears the photo after an upload whose POST then failed, so the retry does not need the file", async () => {
    await queue(1, { photo: PHOTO });
    apiFetch.mockImplementation(offline);
    await replayActions();
    expect(table.rows[0]!.photo).toBeNull();
    expect(table.rows[0]!.attempts).toBe(1);
  });

  it("drops a step whose photo can no longer be uploaded and says why", async () => {
    await queue(1, { photo: PHOTO });
    uploadPhoto.mockRejectedValueOnce(
      new PhotoError("That photo is no longer on this phone."),
    );
    const onActionFailed = vi.fn();
    expect(await replayActions({ onActionFailed })).toEqual({
      replayed: 0,
      failed: 1,
      remaining: 0,
    });
    expect(onActionFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "That photo is no longer on this phone.",
        status: null,
      }),
    );
  });

  it("runs one replay at a time", async () => {
    await queue(1);
    let release!: () => void;
    apiFetch.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ ok: true });
        }),
    );
    const a = replayActions();
    const b = replayActions();
    expect(b).toBe(a);
    // The first request goes out after the table read; wait for it before
    // letting it finish, or `release` is not assigned yet.
    await vi.waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));
    release();
    expect(await a).toEqual({ replayed: 1, failed: 0, remaining: 0 });
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it("notifies listeners with the new count on enqueue and after replay", async () => {
    const counts: number[] = [];
    const off = onQueueChange((n) => counts.push(n));
    await queue(1);
    apiFetch.mockResolvedValue({ ok: true });
    await replayActions();
    off();
    expect(counts).toEqual([1, 0]);
  });
});
