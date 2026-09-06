# Debugging playbook

Symptom-first. Every failure mode below was actually hit while building this POC.

## Read the event log first

The demo page's event log distinguishes the two things that look identical from the outside:

| Log line                      | Means                                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------- |
| `Push sent to N device(s)`    | The **server** got a `201` from the push service. Accepted, **not** delivered.        |
| `SW received push → "..."`    | The **service worker in your browser** received it and `showNotification()` resolved. |
| _nothing, after "Local only"_ | Expected. That button skips the `push` handler, so it never broadcasts.               |

That second line is the fork in almost every investigation. It appears _after_ `showNotification()`
resolves, so if you see it and no notification, the browser did its job and the OS dropped it.

## Nothing appears at all

Work down this list in order. It is ordered by how often each one is the answer.

### 1. Is the OS showing notifications at all?

```bash
osascript -e 'display notification "test" with title "test"'
```

- **Nothing** → Focus mode or Do Not Disturb is on. Not a code problem.
- **It appears** → the OS is fine; continue.

### 2. Is the browser allowed to show them?

System Settings → Notifications → **Google Chrome**:

- **Allow notifications** must be ON
- Alert style must be **Banners** or **Alerts**, not **None**

Then **quit Chrome completely** (`Cmd+Q`, not just closing the window) and relaunch. Authorization
changes frequently don't take effect until the app restarts.

If Chrome isn't in that list at all, it hasn't registered with the notification system — quit and
relaunch, then reload the page.

**Check Notification Center** (menu-bar clock). If the missing notifications are stacked up in there,
everything works and only the on-screen banner was suppressed — that's an alert-style setting.

### 3. Are you reusing a notification `tag`?

A same-tag notification **replaces** the existing one, and without `renotify: true` the replacement
does not re-alert. Repeated clicks of a button that sends a fixed tag produce exactly one visible
notification, ever.

Send with a unique tag to check:

```bash
curl -s -X POST http://localhost:3100/api/notify -H 'Content-Type: application/json' \
  -d '{"title":"Tag A","body":"x","tag":"a-1"}'
curl -s -X POST http://localhost:3100/api/notify -H 'Content-Type: application/json' \
  -d '{"title":"Tag B","body":"x","tag":"b-1"}'
```

Two banners → tag collapsing was your problem.

### 4. Is the site permission granted in the browser?

`chrome://settings/content/notifications` — confirm `localhost:3100` is under **Allowed**.

If it's **Blocked**, the prompt will never reappear on its own. Reset it there.

### 5. Is there actually a subscription?

```bash
curl -s http://localhost:3100/api/subscribe
```

`{"count":0}` means nothing is registered — "Enable notifications" was never completed, or the
subscription was pruned. The demo page polls this every 5s, so you can watch it drop to zero.

### 6. Is the service worker current?

`chrome://serviceworker-internals`, or DevTools → Application → Service Workers.

A stale worker is the classic time-sink. `/sw.js` is served `no-cache` and the worker calls
`skipWaiting()`, but if in doubt: DevTools → Application → Service Workers → **Unregister**, then
hard-reload (`Cmd+Shift+R`).

## "It works for me but not for the user"

Check you are both in the **same browser instance**. This genuinely happened during development: an
automated browser (Playwright) launches a _separate_ Chrome with its own temp profile at
`~/Library/Caches/ms-playwright-mcp/`. It subscribed, received every push correctly, and reported
success — for a browser nobody was looking at.

The store labels devices by user-agent, which is identical across profiles. If you are testing
across several browsers or profiles, make the label more specific before trusting it.

```bash
ps -o pid,command -ax | grep "MacOS/Google Chrome" | grep -v grep | grep -o "user-data-dir=[^ ]*"
```

## Delayed sends report nothing

They resolve after their HTTP response is gone. Outcomes are recorded in a ring buffer instead:

```bash
curl -s 'http://localhost:3100/api/notify?since=0'
```

That endpoint returns **every** recent send, immediate and delayed alike — the demo page is what
filters down to delayed. The buffer holds the last 20 outcomes in process memory, so restarting the
dev server wipes it.

The demo page polls this every 2s and logs the results. If a delayed push fails, that is where it
shows up — nowhere else. Before this existed, a delayed send that failed was completely invisible,
which is how a stale subscription hid itself for an hour.

## Subscription vanishes on its own

The store empties with nothing calling `DELETE`. Only `pruneSubscriptions` does that, and only on a
`404`/`410` from the push service — meaning the push service considers the subscription gone.

Causes: the browser rotated it (should now be handled by `pushsubscriptionchange`), the user cleared
site data, the profile was deleted, or the browser was uninstalled.

Watch for it in the terminal running `npm run dev` — pruning and per-device errors go to the dev
server's stdout. If you want a file to tail, start the server that way yourself:

```bash
npm run dev 2>&1 | tee /tmp/chrome-notify-dev.log
```

## Network checks

Chrome holds a long-lived connection to FCM on **ports 5228–5230**, separate from normal HTTPS. VPNs
and corporate firewalls sometimes block those while leaving `fcm.googleapis.com:443` open — which
makes the server side look perfectly healthy while nothing reaches the browser.

```bash
for p in 5228 5229 5230; do
  nc -z -G 4 mtalk.google.com $p && echo "$p OPEN" || echo "$p BLOCKED"
done
```

Firefox and Safari use entirely different push infrastructure, so testing in **Safari** is a quick
way to rule network-path problems in or out.

## Safari and iOS

- **Safari on macOS** is unreliable on `localhost`. Use a tunnel.
- **iOS** requires a real HTTPS origin _and_ the site installed to the Home Screen:

```bash
cloudflared tunnel --url http://localhost:3100
```

Open the tunnel URL in Safari → Share → **Add to Home Screen** → open from the icon → _then_ enable.
Push does not work in a normal iOS Safari tab. The diagnostics panel reports this.

`next dev --experimental-https` is not a substitute — a self-signed cert needs a trust profile
installed on the phone.

## Server-side sanity checks

```bash
curl -s http://localhost:3100/api/vapid       # keys configured?
curl -s http://localhost:3100/api/subscribe   # devices registered?
curl -s -X POST http://localhost:3100/api/notify \
  -H 'Content-Type: application/json' \
  -d '{"title":"Test","body":"x","tag":"debug-1"}'
```

A `503` from `/api/vapid` means `npm run vapid` hasn't run, or the dev server needs restarting to
pick up `.env.local`.

A `409` from `/api/notify` means the store is empty — nothing has completed "Enable notifications"
yet, or the last subscription was pruned. It is the expected response on a fresh checkout.

Per-device failures come back in `errors` with their status code:

| Code          | Meaning                                                                        |
| ------------- | ------------------------------------------------------------------------------ |
| `201` / `200` | Accepted by the push service — **not** proof of delivery                       |
| `400`         | Malformed request, usually a bad VAPID JWT                                     |
| `401` / `403` | VAPID signature rejected — keys mismatched, or `VAPID_SUBJECT` missing/invalid |
| `404` / `410` | Subscription gone. Pruned automatically.                                       |
| `413`         | Payload too large (~4KB limit)                                                 |
| `429`         | Rate limited by the push service                                               |

## Two rules worth remembering

1. **A successful API call is not evidence the user saw anything.** Every layer here reports success
   independently, and the OS layer at the end reports nothing at all.
2. **Isolate at the lowest layer first.** The native `osascript` test would have resolved the
   original investigation in seconds; instead it started at FCM delivery and worked downward.
