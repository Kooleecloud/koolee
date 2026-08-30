# chrome-notify

A small Web Push POC: browser-native notifications that reach the user whether the app tab is
unfocused, sitting behind another tab, hidden behind another app, or closed entirely.

Built to match `GS-internal-apps-fe` (Next 16.2.1, React 19, App Router, TypeScript) so the pieces
lift across cleanly.

## Documentation

| | |
|---|---|
| [docs/architecture.md](docs/architecture.md) | How it works — the two flows, every component, the HTTP API, and why each choice was made |
| [docs/limitations.md](docs/limitations.md) | What this technology cannot do, and how to build something dependable on top of it |
| [docs/debugging.md](docs/debugging.md) | Symptom-first playbook. **Start here when notifications don't appear.** |

If you read only one thing: `showNotification()` resolving means the notification was *created*, not
*displayed*, and not *seen*. No web API can tell you the difference. Everything in
[limitations.md](docs/limitations.md) follows from that.

## The one design decision that matters

There are two ways to raise a notification, and it is tempting to use both:

| | works while tab open | works while tab closed | Android Chrome |
|---|---|---|---|
| `new Notification(...)` from the page | yes | **no** | **throws** |
| `registration.showNotification(...)` from the service worker | yes | **yes** | yes |

This POC uses **only the service-worker path**. A push message wakes the service worker regardless
of whether any tab is open, so one code path covers every state with no branching and nothing to
deduplicate. If you take one thing from this POC into the real app, take that.

## Setup

```bash
npm install
npm run vapid     # generates the VAPID keypair into .env.local
npm run icons     # generates the PWA icons (needed for the iOS leg)
npm run dev       # http://localhost:3100
```

Open <http://localhost:3100>, click **Enable notifications**, then use the delayed send buttons.

`npm run vapid` writes `.env.local` and refuses to overwrite an existing one — regenerating the
keypair invalidates every subscription already stored in `.data/`.

## How to actually test it

The **"Notify in 10s"** button is the point. It gives you ten seconds to put the browser into the
state you want to test before the push is sent. Testing by clicking "Notify now" while staring at
the tab only ever proves the easy case.

| # | State | Expected |
|---|---|---|
| 1 | Tab visible | Notification appears over the page |
| 2 | Different tab, same window | Appears |
| 3 | Browser behind another app (`Cmd+Tab` away) | Appears |
| 4 | App tab closed, browser still open | Appears; clicking it reopens the app |
| 5 | Browser fully quit | Safari yes; **Chrome on macOS no** — see below |

**"Simulate incoming call in 10s"** sends the realistic payload: a *stable* tag (`call-4821`) plus
`renotify` and `requireInteraction`. That is the collapse-rather-than-stack behaviour a real call
alert wants — click it twice and the repeat replaces the existing alert instead of piling up a
second one.

**"Local only (no server)"** raises a notification via the service worker's registration with no push
involved. If that works and the push buttons don't, your problem is delivery (VAPID, subscription,
network) rather than permissions. It deliberately bypasses the `push` handler, so it produces **no
event-log line** — that is expected, not a failure.

## Two traps that cost real debugging time

**1. macOS silently swallows notifications.** If Google Chrome is off in System Settings →
Notifications, `showNotification()` still resolves successfully and the notification object is
genuinely created — macOS just never draws it. No web API can detect this. When notifications
"don't work", check that switch *first*, and confirm with a native test:

```bash
osascript -e 'display notification "test" with title "test"'
```

If that shows and Chrome's don't, it's the per-app switch. Chrome may need a full `Cmd+Q` and
relaunch after you toggle it.

**2. Reusing a `tag` suppresses the alert.** A notification whose tag matches one already showing
**replaces** it, and without `renotify: true` the replacement does *not* re-alert — no banner, no
sound. A second push looks like total silence even though delivery succeeded and the log confirms
it. Use a unique tag when notifications should stack, and a stable tag plus `renotify` when a repeat
should collapse into the existing one (a call ringing again). `renotify` is Chromium-only; Safari
replaces silently regardless.

## Browser reality

| | Chrome / Edge | Firefox | Safari macOS | Safari iOS |
|---|---|---|---|---|
| States 1–4 above | ✅ | ✅ | ✅ | ✅ |
| Browser fully quit | ❌ on macOS | ❌ | ✅ (delivered via APNs) | ✅ |
| Works on `localhost` | ✅ | ✅ | ⚠️ unreliable | ❌ needs real HTTPS |
| `actions` (inline buttons) | ✅ | ✅ | ❌ ignored | ❌ ignored |
| `requireInteraction` | ✅ | ❌ | ❌ | ❌ |
| `renotify` | ✅ | ❌ | ❌ | ❌ |

Consequences that are baked into the code:

- **Permission is only ever requested from a click.** Safari rejects requests not tied to a user
  gesture. Never move this into a mount effect.
- **Chromium-only options are gated** behind explicit flags in `sw.js` rather than passed blindly,
  so it stays obvious which fields don't travel.
- **Chrome on macOS cannot receive push once fully quit** — it keeps no background process, unlike
  on Windows. This is a platform limit, not something the code can work around. If reaching an
  on-call user with the browser closed is a hard requirement, web push alone won't do it and you
  need a native or mobile channel.
- macOS **Focus / Do Not Disturb silently suppresses everything**, and the browser needs to be
  allowed in System Settings → Notifications. Check both before debugging code.

## Safari and iOS: you need real HTTPS

`localhost` is a secure context for Chrome and Firefox, but Safari is unreliable there and iOS won't
work at all. Use a tunnel:

```bash
cloudflared tunnel --url http://localhost:3100     # no account needed
```

Then on iOS: open the tunnel URL in Safari → Share → **Add to Home Screen** → open it from the Home
Screen icon → *then* tap Enable. Push does **not** work in a normal iOS Safari tab, only in the
installed PWA (iOS 16.4+). The diagnostics panel will tell you if you've missed this step.

`next dev --experimental-https` is not a substitute — a self-signed cert would need a trust profile
installed on the phone.

## Layout

```
public/sw.js                  service worker — push, notificationclick, pushsubscriptionchange
public/manifest.json          required for iOS Add-to-Home-Screen
src/hooks/useWebPush.ts       ← the portable piece
src/lib/push.ts               VAPID signing + payload encryption via web-push
src/lib/subscriptions.ts      JSON-file store under .data/
src/app/api/vapid/route.ts    GET  public key
src/app/api/subscribe/route.ts POST/DELETE/GET subscriptions
src/app/api/notify/route.ts   POST send, with optional delaySeconds
```

Subscriptions live in a **file** rather than memory on purpose: testing means quitting the browser
and restarting the dev server, and an in-memory store would drop the subscription exactly when you
need it.

## Porting into GS-internal-apps-fe

1. `src/hooks/useWebPush.ts` → `src/shared/hooks/`. No changes needed; it has no dependencies beyond
   React.
2. `public/sw.js` and `public/manifest.json` → `public/`. Add the `/sw.js` no-cache header from
   `next.config.ts`; a stale service worker is the single most common way to lose an afternoon.
3. The three route handlers → `src/app/api/push/*/route.ts`, with `src/lib/subscriptions.ts` swapped
   for a real table keyed by **user id** so a notify targets one user rather than every device.
4. The notify trigger moves server-side, to wherever the call event originates.

### The one integration wrinkle

That app already has a live transport — `src/modules/command-center/lib/liveConnection.ts` and
`useCmcLiveConnection.ts` run a WebSocket with a 5s polling fallback. When the tab **is** open, both
that socket and the push will fire for the same call.

Two ways to handle it:

- **`tag`** (what this POC does) — a second notification with the same tag replaces the first rather
  than stacking. Cheap, no server coordination, and it degrades safely. The cost is that the push
  still gets sent.
- **Server-side suppression** — skip the push if that user has a live socket connected. Saves the
  round trip but needs the socket layer to publish connection state, and it fails toward *no*
  notification if that state is stale, which is the worse direction to fail for a call alert.

Recommendation: start with `tag`. Only add suppression if push volume actually becomes a problem.

## Verification status

Verified end to end against real FCM on Chrome:

- Service worker registers and activates; hydration clean
- Subscribe → real `fcm.googleapis.com` endpoint stored
- Push accepted by FCM (proves VAPID signing and AES128GCM encryption are correct), received by the
  service worker, notification shown with the right title/body/tag/url
- Delayed send returns immediately and fires after the delay
- A dead endpoint returns `410` and is pruned from the store while healthy ones still deliver
- `delaySeconds` clamped to 300

Not verified by automation: the visual behaviour of states 1–5 in the matrix, and Safari/iOS. Those
need a human at the keyboard — that's what the delayed buttons are for.
