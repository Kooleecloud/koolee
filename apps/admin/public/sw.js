/* eslint-disable no-undef */
/**
 * Service worker for the Koolee ops console — WEB PUSH ONLY.
 *
 * No offline shell, no caching, no fetch handler. It exists because a push
 * notification can only be raised from a service worker, and it deliberately
 * does nothing else: a `fetch` listener here would put every request in this
 * app through code that has no reason to touch them.
 *
 * (The agent PWA's worker does both — its push listeners are merged into the
 * offline-shell worker it already had, because a scope only gets one worker.)
 *
 * Plain JS on purpose: files in `public/` are served verbatim and never go
 * through the TypeScript compiler or the bundler.
 */

/** Shown on every notification this worker raises. */
const PUSH_ICON = "/icons/icon-192.png";

self.addEventListener("install", () => {
  // Activate a new version without waiting for every tab to close. There is
  // no cache to migrate, so there is nothing for a waiting worker to protect.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

/* ------------------------------------------------------------------ */
/* Web Push                                                            */
/* ------------------------------------------------------------------ */

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
  event.waitUntil(self.registration.showNotification(data.title || "Koolee", options));
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
