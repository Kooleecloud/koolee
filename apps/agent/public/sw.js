/* eslint-disable no-undef */
/**
 * Hand-rolled service worker for the Koolee agent PWA. TWO JOBS:
 *
 *  1. Offline SHELL — pre-caches the offline fallback page and serves it when
 *     a navigation fails. It deliberately does NOT cache API responses or
 *     queue mutations; offline custody capture needs a durable outbox
 *     (IndexedDB + background sync), which is separate work.
 *  2. WEB PUSH — see the second half of this file.
 *
 * The push listeners are MERGED here rather than shipped as a second worker,
 * because a scope can only have one: registering `/push-sw.js` at scope `/`
 * would REPLACE this one and take the offline shell with it. One file, two
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
