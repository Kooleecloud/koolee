# chrome-notify — the web-push POC, verbatim

These four files are copied unmodified from TD's standalone POC
(`~/code/personal/chrome-notify`) and are **reference, not code**. Slice F3
ported the POC's decisions, not its files; where an implementation choice in
`packages/core/src/notifications/push.ts`, `packages/ui/src/lib/use-web-push.ts`
or any `public/sw.js` looks arbitrary, the reasoning is almost certainly here.

The two documents worth reading before touching push:

- **`limitations.md`** — the catalogue of failures that are invisible to
  JavaScript, and the reason the agent app asks a human "did you see it?".
  It is also where the two traps that cost real debugging time are written up:
  macOS silently swallowing notifications when the browser is switched off in
  System Settings, and a reused `tag` suppressing the alert entirely.
- **`debugging.md`** — what to try, in order, when a notification does not
  appear.

One of its open questions is now answered. `limitations.md` asks whether
`registration.getNotifications()` still lists a notification the OS
suppressed. Verified in a headed browser during F3: where the platform cannot
draw one, **it does not list it** — so `getNotifications()` is not a detection
signal, and the ask-a-human design stands.
