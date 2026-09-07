/**
 * The queue's STORAGE behaviour, against a real IndexedDB implementation.
 *
 * WHY THIS FILE IS SEPARATE from `position-queue.test.ts`. That one covers the
 * pure keep/drop/retry rule and runs in a bare node environment. This one
 * needs `fake-indexeddb` and a stubbed `fetch`, and the setup is loud enough
 * that mixing the two would bury the rule that matters most under plumbing.
 *
 * WHAT IT IS ACTUALLY PROTECTING. Every assertion here is a case that is
 * invisible in review and only shows up on a driver's phone in a tunnel:
 *
 *  - fixes survive an offline send and are replayed in the order they were
 *    taken (the ping log reads as a track, not a shuffle);
 *  - a 5xx leaves the queue intact — a server having a moment must not cost
 *    the same fixes the tunnel would have;
 *  - a 4xx drains it — otherwise a body the server will always refuse becomes
 *    permanent luggage, re-sent on every network change for the rest of the
 *    shift;
 *  - the store is bounded, so a phone offline all day does not lose its
 *    storage quota;
 *  - nothing here ever throws into the caller, because the caller is a GPS
 *    callback on a screen a driver is depending on.
 */
import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { enqueue, flush, type PositionFix } from "./position-queue";

const ENDPOINT = "/api/driver-position";

const fixAt = (iso: string, lat = 40.75, lng = -73.98): PositionFix => ({
  lat,
  lng,
  recordedAt: iso,
});

/** Everything currently held, straight out of the store. */
async function queued(): Promise<PositionFix[]> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("koolee-positions", 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => {
      const created = request.result;
      if (!created.objectStoreNames.contains("queue")) {
        created.createObjectStore("queue", { autoIncrement: true });
      }
    };
  });
  const tx = db.transaction("queue", "readonly");
  const all = tx.objectStore("queue").getAll();
  await new Promise((resolve) => {
    tx.oncomplete = resolve;
    tx.onerror = resolve;
  });
  db.close();
  return (all.result ?? []) as PositionFix[];
}

/**
 * Typed so `mock.calls[0]` is a real tuple rather than `[]` — an untyped
 * `vi.fn` makes every assertion about the request body a type error, and the
 * test still passes at runtime, which is the worst of both.
 */
function respondWith(status: number) {
  return vi.fn(
    async (_url: string, _init?: RequestInit) => new Response(null, { status }),
  );
}

beforeEach(async () => {
  // A fresh database per test. `fake-indexeddb/auto` keeps one global, so a
  // leaked row would silently make the next test's assertions meaningless.
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase("koolee-positions");
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
  vi.stubGlobal("navigator", { sendBeacon: undefined, serviceWorker: undefined });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the offline queue", () => {
  it("holds a fix and hands it back on the next flush", async () => {
    const fetchMock = respondWith(200);
    vi.stubGlobal("fetch", fetchMock);

    await enqueue(fixAt("2026-09-06T15:00:00.000Z"));
    expect(await queued()).toHaveLength(1);

    const result = await flush();

    expect(result).toEqual({ sent: 1, drained: true });
    expect(await queued()).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(ENDPOINT);
    expect(JSON.parse(String(init?.body))).toEqual({
      fixes: [fixAt("2026-09-06T15:00:00.000Z")],
    });
  });

  /*
   * ONE REQUEST, OLDEST FIRST. Sixty fixes emerging from a tunnel must not be
   * sixty round trips racing each other on a connection that has just proved
   * it is bad — and the order is what lets the ping log read as a track rather
   * than a shuffle.
   */
  it("drains a backlog in one request, oldest first", async () => {
    const fetchMock = respondWith(200);
    vi.stubGlobal("fetch", fetchMock);

    await enqueue(fixAt("2026-09-06T15:00:00.000Z"));
    await enqueue(fixAt("2026-09-06T15:00:20.000Z"));
    await enqueue(fixAt("2026-09-06T15:00:40.000Z"));

    const result = await flush();

    expect(result.sent).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]?.body));
    expect(body.fixes.map((f: PositionFix) => f.recordedAt)).toEqual([
      "2026-09-06T15:00:00.000Z",
      "2026-09-06T15:00:20.000Z",
      "2026-09-06T15:00:40.000Z",
    ]);
    expect(await queued()).toHaveLength(0);
  });

  /*
   * THE CASE THE WHOLE FILE EXISTS FOR. A server fault must not cost the fixes
   * — that is the same loss as the tunnel, arriving by a different road.
   */
  it("keeps everything when the server is having a moment", async () => {
    vi.stubGlobal("fetch", respondWith(503));

    await enqueue(fixAt("2026-09-06T15:00:00.000Z"));
    await enqueue(fixAt("2026-09-06T15:00:20.000Z"));

    const result = await flush();

    expect(result).toEqual({ sent: 0, drained: false });
    expect(await queued()).toHaveLength(2);
  });

  it("keeps everything when the network is gone entirely", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );

    await enqueue(fixAt("2026-09-06T15:00:00.000Z"));
    const result = await flush();

    expect(result).toEqual({ sent: 0, drained: false });
    expect(await queued()).toHaveLength(1);
  });

  /*
   * 409 is the ordinary end-of-shift race: a tab still open after clock-off.
   * Retrying cannot change the answer, so the batch goes rather than becoming
   * a queue that never empties.
   */
  it("drops a batch the server will always refuse", async () => {
    vi.stubGlobal("fetch", respondWith(409));

    await enqueue(fixAt("2026-09-06T15:00:00.000Z"));
    const result = await flush();

    expect(result.drained).toBe(true);
    expect(result.sent).toBe(0);
    expect(await queued()).toHaveLength(0);
  });

  it("does not call the network at all when there is nothing held", async () => {
    const fetchMock = respondWith(200);
    vi.stubGlobal("fetch", fetchMock);

    expect(await flush()).toEqual({ sent: 0, drained: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  /*
   * BOUNDED, AND THE OLDEST GO. An unbounded store on a phone that has been
   * offline all day is how a PWA loses its storage quota — and the newest fix
   * is the one that moves the pin, so it is the one worth keeping.
   */
  it("caps the store and discards the oldest fixes", async () => {
    for (let i = 0; i < 130; i += 1) {
      await enqueue(fixAt(new Date(Date.UTC(2026, 8, 6, 15, 0, i)).toISOString()));
    }

    const held = await queued();
    expect(held).toHaveLength(120);
    // The first ten are gone; the newest survived.
    expect(held[0]!.recordedAt).toBe("2026-09-06T15:00:10.000Z");
    expect(held.at(-1)!.recordedAt).toBe("2026-09-06T15:02:09.000Z");
  });

  /*
   * NEVER THROWS INTO THE CALLER. The caller is a `watchPosition` callback on
   * a screen a driver is depending on mid-shift; a storage failure must cost a
   * pin, never the app.
   */
  it("swallows a storage failure rather than raising it", async () => {
    const broken = vi.spyOn(indexedDB, "open").mockImplementation(() => {
      throw new DOMException("storage is full", "QuotaExceededError");
    });

    await expect(enqueue(fixAt("2026-09-06T15:00:00.000Z"))).resolves.toBeUndefined();
    broken.mockRestore();
  });

  it("reports an empty drain rather than throwing when storage is unreadable", async () => {
    const broken = vi.spyOn(indexedDB, "open").mockImplementation(() => {
      throw new DOMException("storage is full", "QuotaExceededError");
    });

    await expect(flush()).resolves.toEqual({ sent: 0, drained: false });
    broken.mockRestore();
  });
});
