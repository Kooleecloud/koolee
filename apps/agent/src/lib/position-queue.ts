/**
 * Fixes that have been taken but not yet accepted by the server.
 *
 * WHY A QUEUE AT ALL. A driver's phone loses the network constantly — a
 * parking structure, a tunnel, a lift, a dead patch between two cells — and
 * until now a fix taken during one of those was simply gone: `fetch` rejected,
 * the catch swallowed it, and the next fix was 20 to 45 seconds away. The
 * customer's map went quiet for the length of the outage plus the gap, and
 * nothing anywhere recorded that it had happened.
 *
 * WHAT MAKES A REPLAY SAFE. Every fix carries the DEVICE's own timestamp, and
 * `recordDriverPosition` refuses to let an older `recordedAt` overwrite a
 * newer one. So a backlog draining on top of a live fix cannot rewind the pin
 * — which is the failure that made this feature dangerous before that guard
 * existed, and the reason the guard landed first.
 *
 * WHY KEEP A BACKLOG WHEN ONLY THE NEWEST FIX MOVES THE PIN. For the live pin
 * it is true that everything but the last entry is redundant. The backlog is
 * for the other half of the problem: the append-only ping log, which is what
 * makes "how long were we blind, and whose phone was it" answerable at all.
 * A queue that kept only the newest fix would hide precisely the outage it
 * exists to survive.
 *
 * THE SERVICE WORKER READS THIS SAME STORE. `public/sw.js` opens the database
 * by name and drains it on a Background Sync event, which is how a flush
 * happens after the tab is gone. The database name, the store name, the record
 * shape and the endpoint are therefore a CONTRACT between these two files and
 * there is no type system spanning them — `sw.js` is served raw, not bundled.
 * Change one, change both; both carry a pointer to the other.
 */

/** Shared with `public/sw.js`. Changing either name breaks the SW's flush. */
export const POSITION_DB_NAME = "koolee-positions";
export const POSITION_STORE_NAME = "queue";
export const POSITION_SYNC_TAG = "koolee-position-flush";
export const POSITION_ENDPOINT = "/api/driver-position";

/**
 * How many fixes to hold before dropping the oldest.
 *
 * A hundred and twenty is about forty minutes at the en-route cadence, which
 * comfortably covers every outage worth surviving — a tunnel, a car park, a
 * lift, a dead patch on a motorway. Past that the driver has been offline long
 * enough that the interesting fact is the OUTAGE, not the individual fixes
 * inside it, and an unbounded store on a phone that has been offline all day
 * is how a PWA gets its storage quota revoked.
 *
 * Oldest are dropped rather than newest: the newest fix is the one that moves
 * the pin.
 */
const MAX_QUEUED = 120;

export interface PositionFix {
  lat: number;
  lng: number;
  /** ISO 8601. The DEVICE's fix time, never the send time. */
  recordedAt: string;
}

/**
 * Whether this browser can queue at all.
 *
 * Private windows, some embedded webviews and a phone whose storage is full
 * all fail here. The caller degrades to "send and forget", which is exactly
 * the behaviour that existed before this file — never to an error.
 */
export function canQueue(): boolean {
  return typeof indexedDB !== "undefined";
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(POSITION_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(POSITION_STORE_NAME)) {
        // `autoIncrement` gives insertion order for free, which is the order a
        // backlog has to drain in for the ping log to read as a track.
        db.createObjectStore(POSITION_STORE_NAME, { autoIncrement: true });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/**
 * Hold a fix for later. Never throws — a queue that fails loudly on a phone
 * with no storage left would take the driver's screen with it, and the fix it
 * could not save is worth less than the shift it would interrupt.
 */
export async function enqueue(fix: PositionFix): Promise<void> {
  if (!canQueue()) return;
  try {
    const db = await open();
    const tx = db.transaction(POSITION_STORE_NAME, "readwrite");
    const store = tx.objectStore(POSITION_STORE_NAME);
    store.add(fix);
    await done(tx);
    await trim(db);
    db.close();
  } catch {
    // Storage is full, blocked, or this is a private window. Nothing to do.
  }
}

/** Drop the oldest entries once the store is over `MAX_QUEUED`. */
async function trim(db: IDBDatabase): Promise<void> {
  const tx = db.transaction(POSITION_STORE_NAME, "readwrite");
  const store = tx.objectStore(POSITION_STORE_NAME);
  const countRequest = store.count();
  await new Promise<void>((resolve) => {
    countRequest.onsuccess = () => {
      const excess = countRequest.result - MAX_QUEUED;
      if (excess <= 0) return resolve();
      // Oldest first — `autoIncrement` keys ascend with insertion.
      const cursorRequest = store.openCursor();
      let removed = 0;
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor || removed >= excess) return resolve();
        cursor.delete();
        removed += 1;
        cursor.continue();
      };
      cursorRequest.onerror = () => resolve();
    };
    countRequest.onerror = () => resolve();
  });
  await done(tx).catch(() => undefined);
}

/** Everything held, oldest first, with the keys needed to delete them after. */
async function readAll(
  db: IDBDatabase,
): Promise<{ keys: IDBValidKey[]; fixes: PositionFix[] }> {
  const tx = db.transaction(POSITION_STORE_NAME, "readonly");
  const store = tx.objectStore(POSITION_STORE_NAME);
  const keysRequest = store.getAllKeys();
  const valuesRequest = store.getAll();
  await done(tx);
  return {
    keys: keysRequest.result ?? [],
    fixes: (valuesRequest.result ?? []) as PositionFix[],
  };
}

async function remove(db: IDBDatabase, keys: IDBValidKey[]): Promise<void> {
  if (keys.length === 0) return;
  const tx = db.transaction(POSITION_STORE_NAME, "readwrite");
  const store = tx.objectStore(POSITION_STORE_NAME);
  for (const key of keys) store.delete(key);
  await done(tx).catch(() => undefined);
}

/**
 * What to do with a batch, given what the server said.
 *
 * PURE, AND EXPORTED, because it is the one rule in this file that is easy to
 * get wrong and impossible to see going wrong. The IndexedDB plumbing around
 * it either works or throws; this decides whether a driver's backlog is kept,
 * dropped, or retried forever, and each of those has a distinct failure:
 *
 *  - keep on a permanent error → a queue that never empties, re-sent on every
 *    network change for the rest of the shift;
 *  - drop on a transient error → the tunnel cost the fixes anyway, which is
 *    the bug this whole file exists to fix;
 *  - retry without backoff → a bad connection hammered by a phone that has
 *    just told us it is on a bad connection.
 *
 * MIRRORED IN `public/sw.js`, which cannot import it. Change both.
 */
export type FlushDisposition = "delete" | "retry";

export function flushDisposition(status: number): FlushDisposition {
  // Accepted. Nothing left to hold.
  if (status >= 200 && status < 300) return "delete";
  /*
   * 4xx is the server saying "not this body, not ever" — malformed, or a
   * driver no longer on shift. Retrying cannot change the answer, so the
   * batch goes rather than becoming permanent luggage. 409 in particular is
   * an ordinary end-of-shift race, not a fault.
   */
  if (status >= 400 && status < 500) return "delete";
  // 5xx, or anything else: the server is having a moment. Keep and retry.
  return "retry";
}

export interface FlushResult {
  /** How many fixes the server accepted. Zero is ordinary — an empty queue. */
  sent: number;
  /** True when everything held was accepted and the store is now empty. */
  drained: boolean;
}

/**
 * Send everything held, oldest first, in ONE request.
 *
 * ONE REQUEST, NOT ONE PER FIX. A backlog of sixty fixes emerging from a
 * tunnel would otherwise be sixty round trips racing each other on a
 * connection that has just proved it is bad — and, because they would arrive
 * out of order, sixty chances for the ordering guard to have to do its job.
 *
 * DELETED ONLY ON ACCEPTANCE. A 5xx or a dropped connection leaves the queue
 * exactly as it was, to be tried again on the next flush. A 4xx — a malformed
 * body, or a driver who is no longer on shift — drops the batch, because
 * retrying it forever would mean a queue that never empties and a request
 * that fails on every network change for the rest of the shift.
 */
export async function flush(): Promise<FlushResult> {
  if (!canQueue()) return { sent: 0, drained: true };
  let db: IDBDatabase | null = null;
  try {
    db = await open();
    const { keys, fixes } = await readAll(db);
    if (fixes.length === 0) return { sent: 0, drained: true };

    const response = await fetch(POSITION_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fixes }),
      keepalive: true,
    });

    if (flushDisposition(response.status) === "delete") {
      await remove(db, keys);
      return { sent: response.ok ? fixes.length : 0, drained: true };
    }
    return { sent: 0, drained: false };
  } catch {
    return { sent: 0, drained: false };
  } finally {
    db?.close();
  }
}

/**
 * Ask the service worker to drain the queue once the network is back, even if
 * this tab is gone by then.
 *
 * Background Sync is Chromium-only. On Safari and Firefox this resolves to
 * `false` and the queue drains on the next foreground flush instead — which
 * is the same guarantee the app had before, plus the fixes are no longer lost
 * in the meantime.
 */
export async function requestBackgroundFlush(): Promise<boolean> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return false;
  try {
    const registration = await navigator.serviceWorker.ready;
    // `sync` is not in the DOM lib's ServiceWorkerRegistration type.
    const sync = (
      registration as ServiceWorkerRegistration & {
        sync?: { register: (tag: string) => Promise<void> };
      }
    ).sync;
    if (!sync) return false;
    await sync.register(POSITION_SYNC_TAG);
    return true;
  } catch {
    return false;
  }
}

/**
 * The last thing a backgrounding tab does: hand the newest fix over with
 * `sendBeacon`, which the browser delivers after the page is gone.
 *
 * WHY NOT `fetch` HERE. A `pagehide` handler has no time budget — the browser
 * is free to kill the page mid-request, and on iOS it reliably does.
 * `sendBeacon` queues the body in the browser process instead, so it survives
 * the page. It cannot report success, which is fine: the fix is in the
 * IndexedDB queue as well, and a duplicate is idempotent by `recordedAt`.
 *
 * ONE FIX, NOT THE BACKLOG. Beacon bodies are size-capped (64 KB in most
 * browsers) and a rejected beacon is silent, so this sends the thing that
 * matters — where the driver is right now.
 */
export function beaconLastFix(fix: PositionFix): boolean {
  if (typeof navigator === "undefined" || !navigator.sendBeacon) return false;
  try {
    return navigator.sendBeacon(
      POSITION_ENDPOINT,
      new Blob([JSON.stringify(fix)], { type: "application/json" }),
    );
  } catch {
    return false;
  }
}
