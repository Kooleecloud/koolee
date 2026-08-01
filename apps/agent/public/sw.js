/* eslint-disable no-undef */
/**
 * Minimal hand-rolled service worker for the Koolee agent PWA.
 *
 * Scope for now: offline *shell* only. It pre-caches the offline fallback page
 * and serves it when a navigation request fails. It deliberately does NOT
 * cache API responses or queue mutations — offline custody capture needs a
 * durable outbox (IndexedDB + background sync), which is separate work.
 *
 * Bump CACHE_VERSION whenever the precache list changes.
 */

const CACHE_VERSION = "koolee-agent-v1";
const OFFLINE_URL = "/offline";
const PRECACHE = [OFFLINE_URL, "/manifest.webmanifest", "/icons/icon.svg"];

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
