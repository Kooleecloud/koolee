/* eslint-disable no-undef */
/**
 * Hand-rolled service worker for the Koolee agent PWA. THREE JOBS:
 *
 *  1. Offline SHELL — pre-caches the offline fallback page and serves it when
 *     a navigation fails. It deliberately does NOT cache API responses or
 *     queue custody mutations; offline custody capture needs a durable outbox
 *     of its own, which is still separate work.
 *  2. WEB PUSH — see the middle of this file.
 *  3. POSITION FLUSH — drains the driver-position queue on a Background Sync
 *     event, which is how a fix taken in a tunnel reaches the server after the
 *     tab is gone. See the third section.
 *
 * The listeners are MERGED here rather than shipped as separate workers,
 * because a scope can only have one: registering `/push-sw.js` at scope `/`
 * would REPLACE this one and take the offline shell with it. One file, three
 * concerns, and nothing silently uninstalls anything.
 *
 * Bump CACHE_VERSION whenever the precache list changes.
 */

const CACHE_VERSION = "koolee-agent-v1";
const OFFLINE_URL = "/offline";
const PRECACHE = [OFFLINE_URL, "/manifest.webmanifest", "/icons/icon.svg"];

/** Shown on every notification this worker raises. */
const PUSH_ICON = "/icons/icon-192.png";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Never interfere with anything that mutates state.
  if (request.method !== "GET") return;

  // Network-first for navigations, falling back to the offline shell.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        const cache = await caches.open(CACHE_VERSION);
        const cached = await cache.match(OFFLINE_URL);
        return (
          cached ??
          new Response("Offline", {
            status: 503,
            headers: { "Content-Type": "text/plain" },
          })
        );
      }),
    );
    return;
  }

  // Cache-first for the small set of precached static assets.
  const url = new URL(request.url);
  if (url.origin === self.location.origin && PRECACHE.includes(url.pathname)) {
    event.respondWith(caches.match(request).then((cached) => cached ?? fetch(request)));
  }
});

/* ------------------------------------------------------------------ */
/* Web Push                                                            */
/* ------------------------------------------------------------------ */

/**
 * Tell any open page that a push ARRIVED.
 *
 * Without this the most important question in the whole feature is
 * unanswerable: when somebody says "I saw nothing", there is no way to tell
 * "the push never reached this browser" (a delivery problem — keys, network,
 * a stale subscription) from "it reached the browser and the OS refused to
 * draw it" (System Settings, Focus, an alert style of None). Those have
 * completely different fixes, and guessing between them is how an afternoon
 * disappears.
 *
 * `showNotification` resolving still means CREATED, not displayed — this does
 * not fix that and cannot. It splits the problem in half, which is the most
 * any in-browser signal can do.
 */
async function broadcast(payload) {
  const clients = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });
  for (const client of clients) {
    client.postMessage({ source: "koolee-push", at: Date.now(), ...payload });
  }
}

/**
 * EVERY notification is raised HERE, never from the page.
 *
 * A page can only show a notification while the page is alive. The service
 * worker is woken by the push service even with every tab closed and no
 * browser window open. Routing all notifications through the worker means one
 * code path covers "tab focused", "tab in the background", "different tab",
 * "browser behind another app" and "tab closed" — no branching, nothing to
 * deduplicate, and no case that only shows up in production.
 */
self.addEventListener("push", (event) => {
  // A push with no body is legal. Do not let it throw and kill the handler.
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch {
      data = { title: "Koolee", body: event.data.text() };
    }
  }

  const options = {
    body: data.body || "",
    /*
     * `tag` collapses repeats: a second notification with the same tag
     * REPLACES the first rather than stacking — and without `renotify` the
     * replacement is SILENT. No banner, no sound. That looks identical to
     * total delivery failure while the server logs say "sent".
     *
     * Senders choose: unique tag to stack, stable tag + renotify to collapse.
     */
    tag: data.tag || "koolee",
    data: { url: data.url || "/", receivedAt: Date.now(), ...(data.data || {}) },
    icon: PUSH_ICON,
    badge: PUSH_ICON,
  };

  // Chromium-only extras. Other browsers ignore unknown keys rather than
  // throwing, but gating them keeps it explicit which are not cross-browser.
  if (data.requireInteraction) options.requireInteraction = true;
  if (data.renotify) options.renotify = true;

  // `waitUntil` keeps the worker alive until the notification actually
  // exists. Without it the worker can be killed mid-flight and nothing
  // appears — with every log line still reporting success.
  event.waitUntil(
    (async () => {
      await self.registration.showNotification(data.title || "Koolee", options);
      await broadcast({ type: "push-received", tag: options.tag, title: data.title });
    })(),
  );
});

/** Focus an open tab rather than opening a second copy of the app. */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const target = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    (async () => {
      const absolute = new URL(target, self.location.origin).href;
      const clients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      for (const client of clients) {
        if (new URL(client.url).origin === self.location.origin) {
          await client.focus();
          if ("navigate" in client && client.url !== absolute) {
            await client.navigate(absolute);
          }
          return;
        }
      }

      await self.clients.openWindow(absolute);
    })(),
  );
});

/**
 * The browser rotates or invalidates a push subscription on its own schedule,
 * with nobody doing anything.
 *
 * WITHOUT THIS HANDLER push dies permanently and silently: the old endpoint
 * starts returning 410, the server prunes it, and notifications stop forever
 * while the UI still reports "subscribed". Re-subscribing here and
 * re-registering with the server is what makes it self-healing.
 *
 * The key is fetched rather than held: a worker outlives the page that
 * registered it, and it has no props.
 */
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      try {
        let subscription = event.newSubscription;

        if (!subscription) {
          // Some browsers populate `newSubscription`; where they do not, we
          // re-subscribe with the key the old one was created from.
          const key =
            (event.oldSubscription &&
              event.oldSubscription.options.applicationServerKey) ||
            (await fetch("/api/push/vapid")
              .then((r) => r.json())
              .then((d) => d.publicKey));

          subscription = await self.registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: key,
          });
        }

        await fetch("/api/push/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subscription: subscription.toJSON(),
            label: "re-registered",
          }),
        });
      } catch (error) {
        // Nothing to show and nobody to tell. The next enable-and-verify pass
        // is the recovery.
        console.warn("[sw] push re-subscription failed", error);
      }
    })(),
  );
});

/* ------------------------------------------------------------------ */
/* 3. Driver-position flush                                            */
/* ------------------------------------------------------------------ */

/**
 * A CONTRACT WITH `src/lib/position-queue.ts`, and nothing checks it.
 *
 * This file is served raw rather than bundled, so it cannot import from the
 * app and there is no type system spanning the two. The database name, the
 * store name, the sync tag, the record shape and the endpoint are duplicated
 * here on purpose; change one side and you must change the other. Both files
 * carry this warning.
 */
const POSITION_DB_NAME = "koolee-positions";
const POSITION_STORE_NAME = "queue";
const POSITION_SYNC_TAG = "koolee-position-flush";
const POSITION_ENDPOINT = "/api/driver-position";

function openPositionDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(POSITION_DB_NAME, 1);
    // No `onupgradeneeded`: the PAGE owns the schema. A worker that created an
    // empty store here would race the page's own upgrade and win, leaving the
    // app writing into a database version it did not expect.
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Send everything held, oldest first, in one request; delete only what the
 * server accepted.
 *
 * Mirrors `flush()` in `position-queue.ts`, including its retry rule: a 5xx
 * or a dead connection leaves the queue intact for the next attempt, while a
 * 4xx drops the batch — a body the server will always refuse must not become
 * a queue that never empties.
 */
async function flushPositionQueue() {
  let db;
  try {
    db = await openPositionDb();
  } catch {
    return;
  }
  if (!db.objectStoreNames.contains(POSITION_STORE_NAME)) {
    db.close();
    return;
  }

  const read = db.transaction(POSITION_STORE_NAME, "readonly");
  const store = read.objectStore(POSITION_STORE_NAME);
  const keysRequest = store.getAllKeys();
  const valuesRequest = store.getAll();

  const { keys, fixes } = await new Promise((resolve) => {
    read.oncomplete = () =>
      resolve({ keys: keysRequest.result || [], fixes: valuesRequest.result || [] });
    read.onerror = () => resolve({ keys: [], fixes: [] });
    read.onabort = () => resolve({ keys: [], fixes: [] });
  });

  if (fixes.length === 0) {
    db.close();
    return;
  }

  let response;
  try {
    response = await fetch(POSITION_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fixes }),
    });
  } catch {
    db.close();
    // THROWN, not swallowed: rejecting the `sync` event is what asks the
    // browser to try again later with its own backoff. Returning quietly
    // would mark the sync succeeded and drop the backlog on the floor.
    throw new Error("position flush failed");
  }

  if (!response.ok && response.status >= 500) {
    db.close();
    throw new Error(`position flush rejected: ${response.status}`);
  }

  const write = db.transaction(POSITION_STORE_NAME, "readwrite");
  const writeStore = write.objectStore(POSITION_STORE_NAME);
  for (const key of keys) writeStore.delete(key);
  await new Promise((resolve) => {
    write.oncomplete = resolve;
    write.onerror = resolve;
    write.onabort = resolve;
  });
  db.close();
}

/**
 * Background Sync: the browser fires this when it believes the network is
 * back, whether or not any tab is open.
 *
 * CHROMIUM ONLY. Safari and Firefox never fire it, and there is no polyfill
 * worth having — on those browsers the queue drains on the page's next
 * successful send instead, which is the guarantee the app had before the
 * queue existed, minus the lost fixes. Nothing here is load-bearing for
 * correctness; it is how a gap gets shorter, not how it gets noticed.
 */
self.addEventListener("sync", (event) => {
  if (event.tag !== POSITION_SYNC_TAG) return;
  event.waitUntil(flushPositionQueue());
});
