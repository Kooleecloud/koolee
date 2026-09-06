# Limitations and reliability

What this technology cannot do, and how to build something dependable on top of it anyway.

## The core limitation

**`showNotification()` resolving tells you the notification was created. Not that it was displayed,
and certainly not that it was seen.**

There is no web API — on any browser — that reports back whether the operating system actually drew
a notification on screen. Permission can be `granted`, the push can be delivered, the service worker
can fire, the promise can resolve, and the user can see absolutely nothing.

This was observed directly during development: macOS had Google Chrome switched off in System
Settings → Notifications. Every layer reported success. The screen stayed empty.

Everything below follows from this. **A reliable design cannot be built on detecting the failure. It
has to be built on not depending on the notification alone.**

## Catalogue

### Undetectable in-browser — the dangerous ones

| Limitation                            | Notes                                                            |
| ------------------------------------- | ---------------------------------------------------------------- |
| OS-level per-app switch off           | macOS System Settings → Notifications → Chrome. Invisible to JS. |
| Focus / Do Not Disturb / Focus Assist | Also a **legitimate user choice** you should not try to defeat.  |
| Alert style set to "None"             | Delivered to Notification Center, never drawn on screen.         |
| Enterprise policy                     | A managed browser can block notifications outright.              |
| Tag collapsing                        | Same-tag notifications replace silently. See traps below.        |

### Detectable — but only when you try to push

Subscriptions expire, rotate, or die when a user clears site data, reinstalls the browser, or
switches profiles. You find out on the _next_ push, as a `410`. For an incoming call, that is one
call already missed.

`pushsubscriptionchange` in the service worker mitigates rotation but does not cover every case, and
it cannot run if the browser never starts.

### Hard platform limits

|                                                  | Chrome / Edge   | Firefox | Safari macOS   | Safari iOS                |
| ------------------------------------------------ | --------------- | ------- | -------------- | ------------------------- |
| Tab unfocused / other tab / browser backgrounded | yes             | yes     | yes            | yes                       |
| Tab closed, browser running                      | yes             | yes     | yes            | yes                       |
| **Browser fully quit**                           | **no** on macOS | no      | yes (via APNs) | yes                       |
| Works on `localhost`                             | yes             | yes     | unreliable     | **no** — needs real HTTPS |
| `actions` (inline buttons)                       | yes             | yes     | ignored        | ignored                   |
| `requireInteraction`                             | yes             | no      | no             | no                        |
| `renotify`                                       | yes             | no      | no             | no                        |

Additional constraints:

- **Permission is effectively one-shot.** A denied prompt never reappears on its own; the user must
  dig into site settings. _When_ you ask matters more than anything else in the onboarding flow —
  never on page load.
- **iOS requires Home Screen installation** (16.4+). Real friction, and easy for a user to get stuck
  in a denied state that needs the PWA deleted and re-added.
- **Push is not real-time-guaranteed.** Push services batch and throttle; a dozing device may receive
  a burst late. For an incoming call, a notification arriving 40 seconds late is worse than none.
- **`userVisibleOnly: true` is mandatory.** Every push must produce a visible notification; silent
  data pushes get you unsubscribed.
- **A `201` from the push service means accepted, not delivered.** There are no delivery receipts.
- **Multiple devices per user** means multiple alerts unless you target deliberately.
- **~4KB payload limit.**
- **Incognito windows** don't persist subscriptions.

### Open question

Whether `registration.getNotifications()` still lists a notification the OS suppressed is
**untested**. If it does not, that would be a genuine detection signal and is worth five minutes to
find out: toggle Chrome off in System Settings, push, and inspect. Do not design around it until
someone checks.

## Two traps that cost real debugging time

### 1. macOS silently swallows notifications

If Chrome is off in System Settings → Notifications, `showNotification()` still resolves and the
notification object is genuinely created. macOS just never draws it.

**Isolate it with a native notification**, which removes the browser from the picture entirely:

```bash
osascript -e 'display notification "test" with title "test"'
```

- Nothing appears → the OS is suppressing everything (Focus, Do Not Disturb)
- It appears but Chrome's don't → the per-app switch

Chrome may need a full `Cmd+Q` and relaunch after toggling the setting. Also check Notification
Center (click the menu-bar clock) — if the missing notifications are stacked up in there, the whole
pipeline works and only the on-screen banner was suppressed.

### 2. Reusing a `tag` suppresses the alert

A notification whose `tag` matches one already showing **replaces** it, and without `renotify: true`
the replacement does _not_ re-alert — no banner, no sound. A second push looks like total silence
even though delivery succeeded and the logs confirm it.

- Notifications that should **stack** → unique tag each time
- A repeat that should **collapse** into the existing alert (the same call ringing again) → stable
  tag plus `renotify: true`

`renotify` is Chromium-only. **On Safari a same-tag replacement is always silent**, so if a
call-ringing-again alert must re-alert there, vary the tag instead of relying on `renotify`.

Both traps share a signature: every layer reports success while the user sees nothing.

## Designing for reliability

Not one channel — a ladder, where each rung covers the blind spot of the one below.

### Rung 0 — in-app, while the tab is open

A ringing UI in the page, plus audio, plus a `document.title` flash so the tab strip shows it.

This is **more** reliable than an OS notification, not less: no OS gate, no permission prompt, no
push service, no delivery uncertainty. Audio plays from a backgrounded tab as long as the user has
interacted with the page at some point in the session.

For "user is on a different tab" — one of the original requirements — this alone is sufficient.

### Rung 1 — web push

Genuinely needed only for **tab closed**. Framing it that way is useful: it is a much smaller job
than "the notification system," and should get a proportionate share of the effort.

### Rung 2 — human-verified setup

The direct answer to an undetectable failure: **ask a human.**

During onboarding, send a test notification and ask _"Did you see that?"_ with a Yes / No. On **No**,
show platform-specific remediation — detect macOS + Chrome and give the exact System Settings path,
detect iOS and explain Add to Home Screen.

Slack, Discord and Front all do this, and they do it precisely because the failure cannot be
detected any other way. It converts an invisible, permanent failure into a two-second question.

This is the highest-value thing that could be added to this POC.

### Rung 3 — engagement heuristic

Track `notificationclick` and `notificationclose`. If a user has been sent twenty notifications over
a week and interacted with none of them, flag them as "probably not seeing these" and re-prompt the
Rung 2 test.

Heuristic, not proof — a user may simply be ignoring them. But it is the only passive signal that
exists.

### Rung 4 — acknowledgement and escalation

For anything time-critical, treat an alert as **undelivered until the user acts on it**. If nothing
is acknowledged within N seconds, escalate to a different channel: in-app ring, then SMS, then a
phone call.

Web push should never be the only path for something that matters. This is an architecture decision
above the level of this POC, and it likely involves a backend and a second provider.

## Where to start

Rungs 0 and 2 deliver most of the reliability for a fraction of the effort, and **neither involves
push at all**. In priority order:

1. The "did you see it?" verification flow with platform-aware remediation text
2. An in-app ringing state with audio and title flash for the tab-open case
3. A subscription health check on load that re-subscribes proactively, rather than discovering a dead
   subscription mid-call

## Questions worth answering before building further

- **How bad is a missed alert?** If the answer is "annoying," rungs 0–2 are plenty. If it is
  "someone doesn't get care," web push should not be load-bearing at all, and the real conclusion is
  _which_ second channel you need.
- **Is acknowledgement/escalation in scope?** It changes whether the system needs a concept of an
  alert being acknowledged, which reaches into the data model.
- **How many devices per user, and should all of them alert?** Affects whether subscriptions are
  keyed per user or per session.
