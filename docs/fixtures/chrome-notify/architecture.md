# Architecture

How the POC is put together, and why each piece is the way it is.

## The problem it solves

An event happens server-side — an incoming call — and a user needs to know about it. The user might
be looking at the app, looking at a different tab, using a different application entirely, or have
the tab closed. The notification has to reach them in all four cases.

## The one decision everything else follows from

There are two ways to raise a browser notification:

|                                                         | works while tab open | works while tab closed | Android Chrome |
| ------------------------------------------------------- | -------------------- | ---------------------- | -------------- |
| `new Notification()` from the page                      | yes                  | **no**                 | **throws**     |
| `registration.showNotification()` from a service worker | yes                  | **yes**                | yes            |

**This POC uses only the service-worker path.** A push message wakes the service worker whether or
not any tab exists, so a single code path covers every state with no branching and nothing to
deduplicate. The page never constructs a notification directly — the "Local only" debug button calls
`registration.showNotification()` on the service worker's _registration_, so the notification is
still SW-owned rather than page-owned.

One asymmetry to know before leaning on that button: it does **not** run `sw.js`'s `push` handler and
does not broadcast, so **a local test produces no event-log line**. It proves permission and the OS
display path — not delivery.

The consequence worth internalising: **the page is not involved in showing notifications at all.**
If you are debugging a missing notification, the page is not where to look.

## Two flows

### Subscribing (once per browser, requires a user gesture)

```
[click "Enable notifications"]
        │
        ▼
  register /sw.js  ──────────────────────► service worker installed + activated
        │
        ▼
  Notification.requestPermission()   ◄──── MUST be inside the click handler.
        │                                  Safari rejects requests that aren't
        │                                  gesture-initiated.
        ▼
  GET /api/vapid  ───────────────────────► { publicKey }
        │
        ▼
  pushManager.subscribe({                  Browser contacts its own push service
    userVisibleOnly: true,          ─────► (FCM for Chrome, Mozilla autopush for
    applicationServerKey            ◄───── Firefox, APNs for Safari) and returns
  })                                       an endpoint + encryption keys.
        │
        ▼
  POST /api/subscribe  ──────────────────► stored in .data/subscriptions.json
```

The resulting subscription is **bound to the VAPID key pair**. Regenerating the keys invalidates
every existing subscription, which is why `npm run vapid` refuses to overwrite an existing
`.env.local`.

### Delivering a notification

```
  POST /api/notify
        │
        ▼
  web-push signs a VAPID JWT and encrypts the payload (AES128GCM)
        │                       ▲
        │                       └── the push service never sees the plaintext;
        │                           it is encrypted to keys only this browser holds
        ▼
  HTTPS POST to the subscription's endpoint (e.g. fcm.googleapis.com)
        │
        │  ◄── a 201 here means ACCEPTED, not delivered. This distinction
        │      matters more than any other in this document.
        ▼
  push service delivers to the browser over its own persistent connection
        │
        ▼
  service worker 'push' event fires  ────► showNotification()
        │
        ▼
  OS decides whether to draw it        ◄── invisible to your code. See limitations.md
```

## Components

### `public/sw.js` — the service worker

Plain JavaScript, not TypeScript: files in `public/` are served verbatim and never pass through the
compiler or bundler. Five listeners, grouped here into four:

- **`install` / `activate`** — `skipWaiting()` + `clients.claim()` so a changed worker takes over
  without needing every tab closed. Convenient during development; think about whether you want that
  aggressiveness in production.
- **`push`** — parses the JSON payload and calls `showNotification()`. Wrapped in `event.waitUntil()`
  so the worker is not killed mid-flight. Tolerates a push with no body or a non-JSON body rather
  than throwing and losing the event.
- **`notificationclick`** — closes the notification, then looks for an existing window on this origin
  via `clients.matchAll()`. Focuses and navigates it if found, otherwise opens a new one. Without
  this, clicking a call alert while the app is already open leaves you with two copies of the app.
- **`pushsubscriptionchange`** — fires when the browser rotates or invalidates a subscription on its
  own schedule. Re-subscribes and re-registers with the server. **Without this handler, the old
  subscription starts returning `410`, the server prunes it, and notifications stop permanently while
  the UI still reports "subscribed."**

It also broadcasts what it did to any open page via `postMessage`, which is what drives the demo's
event log. That log is a debugging tool, not a feature — it exists so you can see the service worker
receiving a push separately from the OS displaying it, which is the single most useful distinction
when something goes wrong.

### `src/hooks/useWebPush.ts` — the client API

The one piece designed to be lifted elsewhere. No dependencies beyond React.

```ts
const {
  ready, // service worker registration attempt has finished
  supported, // platform can do push at all
  permission, // 'default' | 'granted' | 'denied' | 'unsupported'
  subscribed, // this browser has a live push subscription
  busy, // a subscribe/unsubscribe is in flight
  error, // last failure, human-readable
  diagnostics, // why it's unsupported, if it is
  subscribe, // MUST be called from a user gesture
  unsubscribe,
  showLocalNotification, // debug aid, bypasses the server
} = useWebPush();
```

`diagnostics` deliberately reports _why_ something is unavailable rather than just failing:

```ts
{
  secureContext, serviceWorker, pushManager, notification,
  standalone,   // installed to Home Screen — required on iOS
  browser,      // detected from user-agent
  blocker,      // human-readable reason push can't work, or null
}
```

Two implementation details that matter:

- **Diagnostics start as a placeholder and are filled in by an effect**, not by the `useState`
  initializer. Capability detection is unavailable during SSR, so seeding real values makes the first
  client render disagree with the server HTML — a hydration mismatch. This was a real bug in an
  early version.
- **`subscribe()` must be called from a click handler.** Never move it into a mount effect. Safari
  will reject the permission request, and asking on load is poor practice anyway: a denied prompt
  never reappears on its own.

### `src/lib/push.ts` — sending

Wraps `web-push`, which handles VAPID JWT signing and AES128GCM payload encryption. Neither is worth
hand-rolling.

`sendToAll(payload)` fans out to every stored subscription and returns `{ sent, failed, total, errors }`.
Endpoints that return `404`/`410` are collected and pruned — those subscriptions are gone for good,
and keeping them means every future send reports failures that aren't real.

It also keeps a **ring buffer of recent send outcomes** (`recordResult` / `getRecentResults`). This
exists because delayed sends resolve long after their HTTP response has gone, so a failed delayed
push would otherwise leave no trace anywhere. That is not hypothetical — it is exactly how a stale
subscription hid itself during development. Every send is recorded, immediate ones included; the
buffer holds the last 20 outcomes in process memory, so restarting the dev server clears it.

Pushes are sent with `TTL: 60` and `urgency: 'high'`. For a call alert, a notification arriving five
minutes late is worse than none, so the message is allowed to expire rather than queue.

### `src/lib/subscriptions.ts` — storage

A JSON file under `.data/`, keyed by endpoint (the endpoint URL is the subscription's identity).

A file rather than an in-memory `Map` for one specific reason: testing this means **quitting the
browser and restarting the dev server**, and an in-memory store would drop the subscription at
exactly the moment you need it. Turbopack's module reloading would lose it too.

In a real system this is a table keyed by user id. Here every subscription is anonymous and a notify
hits all of them.

## HTTP API

| Method   | Path                 | Purpose                                                                                                                                                    |
| -------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`    | `/api/vapid`         | Returns the VAPID public key. Not a secret — the browser needs it. `503` if keys aren't generated.                                                         |
| `GET`    | `/api/subscribe`     | Count and labels of registered devices.                                                                                                                    |
| `POST`   | `/api/subscribe`     | Register a subscription. Validates `endpoint`, `keys.p256dh`, `keys.auth`. Upserts by endpoint.                                                            |
| `DELETE` | `/api/subscribe`     | Remove by `{ endpoint }`.                                                                                                                                  |
| `POST`   | `/api/notify`        | Send. Body: `{ title, body, tag?, url?, requireInteraction?, renotify?, actions?, data?, delaySeconds? }`. `409` when no subscriptions are registered yet. |
| `GET`    | `/api/notify?since=` | Recent send outcomes — **immediate and delayed both**. The demo page filters to delayed client-side.                                                       |

`delaySeconds` (max 300) schedules the send with `setTimeout` and returns immediately. **This is the
POC's most important test affordance** — it gives you time to switch tabs, switch apps, or close the
browser before the push fires. Testing by clicking "Notify now" while watching the tab only ever
proves the easiest case.

That `setTimeout` is fine for a long-lived dev server and wrong for production: a serverless instance
can be frozen or recycled before the timer fires. Real deployments use a queue.

## Configuration

```
VAPID_PUBLIC_KEY    generated by `npm run vapid`; shipped to the browser
VAPID_PRIVATE_KEY   server-only; signs the VAPID JWT
VAPID_SUBJECT       mailto: or https: URL. Apple REJECTS pushes without a valid one.
```

## Notable choices

**Port 3100**, to avoid colliding with a main app on 3000.

**`/sw.js` served with `no-cache`** via `next.config.ts` headers, plus `Service-Worker-Allowed: /`.
A cached service worker is the single most common way to lose an afternoon to this technology.

**Plain CSS, no MUI or Tailwind**, so the portable logic isn't tangled up in a styling system.

**Icons generated by a script** (`npm run icons`) that hand-encodes PNGs with zlib rather than
pulling in an image library. They are load-bearing, not decoration: iOS will not offer a real PWA
install without a manifest pointing at actual icons, and without that install, iOS web push does not
work at all.
