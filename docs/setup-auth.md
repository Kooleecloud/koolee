# Auth setup — provider ownership, CAPTCHA, and OTP-send safety

How Koolee's customer auth (phone/email OTP) is wired, and exactly which
credential lives where. The one-sentence version: **every auth secret lives in
the Supabase dashboard; `apps/web` holds only the public Turnstile site key.**

## Who owns OTP delivery

```
browser → Supabase Auth (GoTrue) → Twilio Verify API → carrier → handset
```

Supabase Auth owns the whole path. It stores the Twilio Verify credentials in
its own project configuration and makes the Verify call server-side. The
application never calls Twilio for OTP, never generates or validates a code,
and must never hold Verify credentials. Codes are generated and validated by
Twilio Verify; Supabase never sees them and neither do we.

Consequences for this repo:

- No `TWILIO_*` variables in any app env file or in `apps/web/src/env.ts`.
- No `twilio` npm dependency, and no Twilio import from any auth module.
- Customer notification SMS ("driver 10 min away", "bags sealed") is a
  **separate** future concern. Its seam is `NotificationDispatcher` in
  `packages/core/src/notifications/dispatcher.ts` (a logging stub today);
  real provider credentials land with the notifications work item, in
  server-side env — still never in the auth flow.

## Supabase dashboard checklist

1. **Auth → Providers → Phone**: enable, provider *Twilio Verify*, paste the
   Twilio Account SID / Auth Token / Verify Service SID here — and only here.
2. **Auth → Attack Protection → CAPTCHA**: enable, provider *Turnstile*, paste
   the **Turnstile secret key** here — and only here. Supabase verifies the
   `captchaToken` the app forwards; the app never calls `siteverify`.
3. **Auth → Providers → Anonymous sign-ins**: enable for the funnel's draft
   sessions (the app degrades to cookie-only drafts when disabled).
4. **Auth → Rate Limits**: keep the project SMS rate limit on; it backstops
   the app-level throttle described below.

## App environment

| Variable | Where | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | `apps/web` env (public) | Renders the Turnstile widget. **The only Turnstile var the app needs.** |

There is deliberately no `TURNSTILE_SECRET_KEY` and no `TWILIO_*` key in app
env. With the site key absent (fresh clone), auth calls send no
`captchaToken` — leave Supabase CAPTCHA protection off in that environment.

## Where the CAPTCHA token attaches

The JS SDK accepts `options.captchaToken` on `signInAnonymously()` and
`signInWithOtp()`, but **not** on `updateUser()` — the anonymous → permanent
upgrade. The protection chain:

| Call site | Turnstile? | Protection |
| --- | --- | --- |
| `signInAnonymously()` — funnel start (flight confirm) | Yes | Token from the form-mounted widget |
| `signInWithOtp({ phone })` — sign-in / conflict branch | Yes | Fresh token per send (`TurnstileGate.getToken()`) |
| `signInWithOtp({ email })` — email paths | Yes | Fresh token per send |
| `updateUser({ phone \| email })` — upgrade | Not possible | Captcha-gated session + server throttle + Supabase SMS limits |
| `verifyOtp(...)` | No | Supabase verification rate limits |

An attacker cannot reach the `updateUser` send without first solving a
Turnstile challenge to obtain an anonymous session, and each session is then
throttled.

## Server-side OTP send throttle (`otp_send_log`)

`guardUpgradeSend` in `apps/web/src/actions/auth.ts`, backed by
`recordOtpSend` in `packages/core/src/auth/otp-throttle.ts`, runs before every
`updateUser` send:

- max **3** sends per user per rolling **15 minutes**;
- max **5** sends per destination per rolling **60 minutes**, across all
  users — this blocks farming one number through fresh anonymous sessions;
- exceeded → the action returns `rate_limited` and **no SMS is sent**;
- rows older than 24h are pruned by the daily cleanup job
  (`cleanupAnonymousUsers`).

## `phone_change` collision reconciliation

`auth.users.phone_change` is not unique, and the funnel deliberately produces
abandoned anonymous sessions that may have written one. Without reconciliation
`verifyOtp({ type: "phone_change" })` can attach a phone to the wrong row —
a customer landing in a stranger's session.

`reconcilePhoneClaims` / `reconcileEmailClaims`
(`packages/core/src/auth/reconcile-claims.ts`) run before every upgrade send,
under a per-identifier Postgres advisory lock:

- colliding **anonymous** rows are abandoned sessions: their draft,
  `public.users` row, and auth user are deleted;
- a colliding **permanent** row is never touched: the action returns
  `phone_conflict` / `email_conflict` **before any SMS is sent**, and the UI
  routes into the "Welcome back" sign-in branch. The old error-message
  parsing survives only as a defensive fallback.

## Acceptance checks

```bash
# No Twilio in auth code, env keys, or imports
grep -ri "twilio" apps/ packages/ --include='*.ts' --include='*.tsx'
# No Turnstile secret anywhere
grep -ri "TURNSTILE_SECRET" .
```

Behavioral checks: a 4th OTP send within 15 minutes returns `rate_limited`
with no new Twilio Verify attempt; submitting a phone owned by a permanent
account returns the conflict before any SMS; two anonymous sessions claiming
the same number resolve to the most recent verifier, with the older session
and its draft deleted.
