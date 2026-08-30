# F3 — hosted setup

> **Everything slice F3 needs on a hosted environment that a migration cannot
> do for you.** Written for TD; nothing here was run by the session that built
> the slice, which touched LOCAL only.
>
> Companion docs: [notifications.md](notifications.md),
> [jobs-and-notifications.md](jobs-and-notifications.md),
> [f2-hosted-setup.md](f2-hosted-setup.md).

---

## 0. PUSH SHIPS DISABLED

**`NEXT_PUBLIC_PUSH_NOTIFICATIONS_ENABLED` defaults to `false`, in every
environment.** Nothing below happens until it is explicitly set to `"true"`.

With it off — the default — every push moment logs instead of sending, the
enable affordances do not render in any app, and the VAPID boot gate is
waived, so a production deploy that has never heard of VAPID boots clean.
**Email and the in-app realtime signal are untouched**: they are the
guaranteed channels and they carry the product on their own. That is the point
of the switch — push is the one channel that fails silently and undetectably,
so it is opt-in by explicit configuration rather than something you acquire by
accident when a key happens to be present.

Stored subscriptions are **never** touched by the switch. Turning it off and
back on resumes sends to the same devices with nobody re-subscribing.

> **One variable, not two.** It is `NEXT_PUBLIC_` so the server and the
> browser read the same value — the same pattern as `NEXT_PUBLIC_LAUNCH_MODE`.
> A server flag paired with a public twin is two things that can disagree, and
> this slice has already paid once for exactly that shape. "Is push on" is not
> a secret.

**To enable push, in order:** set the flag, set the VAPID vars (§2–3), then
follow the enable-and-verify walkthrough (§4).

---

## 0b. The short version, once you are enabling it

| # | Step | Who | Blocking? |
|---|---|---|---|
| 0 | Set `NEXT_PUBLIC_PUSH_NOTIFICATIONS_ENABLED=true` in all three apps | human, dashboard | **yes** — nothing sends without it |
| 1 | Apply migration `0032_push_subscriptions` | **CI on merge** | **yes** — nothing can subscribe without it |
| 2 | Generate ONE VAPID pair per environment | human, once | **yes** once the flag is on |
| 3 | Set the 4 VAPID vars in **all three** apps | human, dashboard | **yes** — see §3 |
| 4 | Set `NEXT_PUBLIC_AGENT_APP_URL` / `NEXT_PUBLIC_ADMIN_APP_URL` in `apps/web` | human, dashboard | no — push goes without the deep link |
| 5 | Set `ASSIGNMENT_HORIZON_HOURS` (optional) | human, dashboard | no — defaults to 48, and is NOT gated by the push flag |
| 6 | Enable and verify on each app (§4) | human, per device | no |

**No manual SQL and no dashboard database step.** `0032` is an ordinary
`CREATE TABLE`; CI applies it like every other migration.

**No RLS work, and that is not an omission.** `push_subscriptions` is
server-only — no browser client ever queries it. `0016`'s `ensure_rls` event
trigger switches RLS on for any new table in `public`, so it lands with RLS
enabled and zero policies, which denies `anon` and `authenticated` outright.
The §7 rule "a policy grants nothing, so add the GRANT too" governs
CLIENT-readable tables; adding either here would widen access nothing needs.

---

## 1. Migration `0032_push_subscriptions`

One table: `id`, `user_id` (FK → `users`, `ON DELETE CASCADE`), `endpoint`,
`p256dh`, `auth`, `label`, `app`, `created_at`, `last_seen_at`, `verified_at`.
Two indexes.

**Lock / index risk: none.** A fresh `CREATE TABLE` plus two index builds on a
table with zero rows — no rewrite, no scan, no `CONCURRENTLY` needed. It
touches no existing table; the only reference is an outbound FK to `users`,
which takes a brief `SHARE ROW EXCLUSIVE` on `users` and validates nothing.
Reversible with `DROP TABLE push_subscriptions`.

Verify after CI:

```bash
pnpm db:status      # read-only, safe against production
```

Expect `33 of 33 (matched by content hash)`. Hosted carries one orphan journal
row on purpose (PROJECT-STATUS §3.1) — leave it alone.

---

## 2. VAPID keys — generate ONCE, per environment

VAPID (Voluntary Application Server Identification) is how a push service —
Google's FCM for Chrome, Mozilla's autopush for Firefox, Apple's APNs for
Safari — knows a push request came from Koolee. The public key goes to the
browser at subscribe time; every outgoing push is signed with the private key.

```bash
pnpm push:vapid
```

Writes the four values into **every app's** `.env.local` (all gitignored) and
prints the public key. It is idempotent and never regenerates: an existing
pair found in any app is reused and simply distributed to whichever apps are
missing it. For hosted, copy the values into each deployment's environment.

> ### ⚠ REGENERATING INVALIDATES EVERY STORED SUBSCRIPTION
>
> Each row in `push_subscriptions` is bound to the public key it was created
> with. Generate a new pair and **every device stops receiving notifications
> while its UI still reports "subscribed"** — nothing tells a browser its
> application server key changed. Recovery is: truncate the table, and ask
> every agent, driver and admin to enable notifications again by hand.
>
> The script never regenerates over an existing pair for this reason. If you
> genuinely mean to rotate: delete the `VAPID_` lines from all three
> `.env.local` files, re-run, then truncate `push_subscriptions`.

**One pair per environment.** Production and dev must not share: a subscription
created against dev's key cannot receive a push signed with production's, and
mixing them produces silent non-delivery rather than an error.

---

## 3. Environment variables

### All three apps need ALL FOUR VAPID values

**Not just apps/web.** This is the single most expensive thing to get wrong
here, and it already went wrong once: the agent and admin apps were given only
the public key, which is enough to REGISTER a device but not to SIGN a push.
Their runtimes fell back to `ConsolePushSender` — which logs a line and
**reports success** — so the agent's "send me a test notification" button
asked "did you see it?" about a notification that had never left the process.

Every app that sends needs the private key, and each of the three sends at
least its own self-test. `pnpm push:vapid` writes all four into all three
`.env.local` files for exactly this reason.

| Variable | Where | Notes |
|---|---|---|
| `NEXT_PUBLIC_PUSH_NOTIFICATIONS_ENABLED` | **all three** | `"true"` to enable. Anything else is off |
| `VAPID_PUBLIC_KEY` | **all three** | From `pnpm push:vapid` |
| `VAPID_PRIVATE_KEY` | **all three** | Secret. Never in the repo |
| `VAPID_SUBJECT` | **all three** | `mailto:` or `https:`. **Apple REFUSES a push whose subject is neither** |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | **all three** | Same value as `VAPID_PUBLIC_KEY`. The browser needs it to subscribe |
| `NEXT_PUBLIC_AGENT_APP_URL` | apps/web | Deep links on staff pushes. Absent → push goes without a link |
| `NEXT_PUBLIC_ADMIN_APP_URL` | apps/web | Same |
| `ASSIGNMENT_HORIZON_HOURS` | web + admin | **Default 48.** See §5. NOT gated by the push flag |

All four VAPID values are a production boot gate **whenever the push flag is
on**, and waived entirely when it is off.

The gate runs only when the push flag is ON. It is checked at boot in each
app's `env.ts`, beside the `RESEND_API_KEY` / `OPS_ALERT_EMAIL` /
`ANTHROPIC_API_KEY` gates, and for the same reason: **the fallback is `ConsolePushSender`, which logs and reports
SUCCESS.** Without the gate a production deploy reports every notification as
sent while no device ever rings. `NEXT_PUBLIC_VAPID_PUBLIC_KEY` is checked
separately because it is a different variable carrying the same value, and
forgetting it is the likely mistake: a server that can send with a browser
that can never subscribe.

A `coming_soon` deploy is exempt, like the other gates.

`ASSIGNMENT_HORIZON_HOURS` must MATCH between `apps/web` and `apps/admin`, or
the console's at-risk badges disagree with the sweep. It is unrelated to push
and is **not** affected by the kill switch.

---

## 4. Enable and verify — per app, per device

> **Precondition:** `NEXT_PUBLIC_PUSH_NOTIFICATIONS_ENABLED=true` and all four
> VAPID values set, in the app you are testing. With the flag off there is no
> button to press — that is correct, not a bug. If the button is there but
> `/api/push/test` answers **503 `not_configured`**, the flag is on and the
> keys are missing in THAT app: nothing was sent, and no amount of checking
> System Settings will help.

Push is the one channel that fails **silently and undetectably**. Permission
can be granted, the push delivered, the service worker fired and
`showNotification` resolved with the screen staying empty: an OS per-app
switch, Focus / Do Not Disturb, an alert style of "None", an enterprise
policy. No API on any platform reports it. So the product asks a human, and so
should this walkthrough.

### Agent app (`/account` → Notifications)

1. Tap **Turn on notifications**. Accept the browser prompt.
2. A real test push goes through the full pipeline and the card asks
   **"Did a notification just appear?"**
3. **Yes** → `verified_at` is stamped. Done.
4. **No** → follow the on-screen remediation, in that order (it is ordered by
   how often each is the actual cause):
   - macOS: System Settings → Notifications → *your browser* → Allow. You may
     need to quit the browser completely and reopen it.
   - Focus / Do Not Disturb is on.
   - Alert style is "None" — check Notification Centre. If the test is sitting
     in there, the whole pipeline works and only the banner was suppressed.
   - A managed/work browser profile can block them outright.
   - **iOS**: notifications only work from the Home Screen app. Share → Add to
     Home Screen → reopen from the icon → enable there.

To isolate the browser from the OS on macOS:

```bash
osascript -e 'display notification "test" with title "test"'
```

Nothing appears → the OS is suppressing everything. It appears but the
browser's do not → the per-app switch.

### Ops console (Overview → Desktop notifications)

Same button, no did-you-see-it step (desktop staff have the board in front of
them). `POST /api/push/test` sends yourself one when you want to check.

### Customer web

Nothing to enable. A dismissible card appears on the trip page **only** within
24 hours of the pickup window opening, and never during the funnel.

### The smoke test that actually matters

Do this once per environment, per browser, on the agent app:

| # | Setup | Expect |
|---|---|---|
| 1 | Tab open and focused, hit `POST /api/push/test` | A notification appears |
| 2 | Switch to a DIFFERENT tab, send again | A notification appears |
| 3 | Switch to a different **app**, send again | A notification appears |
| 4 | **Close the tab entirely**, send from another device or curl, wait | A notification appears |

Step 4 is the one that justifies web push existing at all — everything above
it is also covered by the in-app realtime signal. If 1–3 pass and 4 does not,
the service worker is not being woken; check that `/sw.js` is served with
`Cache-Control: no-cache` and `Service-Worker-Allowed: /`.

Note: on macOS, **Chrome fully quit** means no delivery. Safari and iOS still
deliver via APNs. This is a platform limit, not a bug.

---

## 5. `ASSIGNMENT_HORIZON_HOURS`

**Default 48.** How many hours before a pickup window an agent is assigned.

Beyond the horizon a paid booking rests with **no verification task and no
pickup task** — that is correct, not a problem, and the console knows it:
neither the board's "needs an agent" badge nor `unassignedToday` counts a
booking outside the horizon. A five-minute Inngest sweep
(`assignment-horizon-sweep`) assigns bookings as their windows come into
range.

Changing the number is a **config change only** — no migration, no deploy of
new logic. Raising it assigns earlier, lowering it assigns later; both are
safe, because the sweep picks up whatever the on-paid path declined to do.

Set it in **both `apps/web` and `apps/admin`**, to the same value. Web is
where assignment happens; admin is where "unassigned" is rendered, and a
mismatch means the console shows red badges for work the sweep has correctly
not started.

A non-numeric or non-positive value **warns and falls back to 48** rather than
booting with `NaN` hours, which would stop assigning anybody while looking
fine.

---

## 6. Turning push off again

Set `NEXT_PUBLIC_PUSH_NOTIFICATIONS_ENABLED=false` (or remove it) and redeploy.
Sends stop immediately, the affordances disappear, and **`push_subscriptions`
is left alone** — flipping it back on resumes delivery to the same devices with
nobody re-subscribing. Do NOT truncate the table to "turn push off"; that is
the one action that cannot be undone without every person re-enabling by hand.

---

## 7. What is NOT in this slice

- **SMS.** Still parked (A2P registration).
- **Notification history or a preferences UI.** A person turns push on or off
  per device; there is no per-moment opt-out.
- **Escalation ladders.** Nothing acknowledges, nothing escalates. Push is
  never load-bearing — email and the in-app signal remain the guaranteed
  channels, by design.
- **Anything that makes push reliable.** It cannot be made reliable. The
  design assumes it will silently fail for some fraction of people, which is
  why every push moment also has an email or a live screen.
