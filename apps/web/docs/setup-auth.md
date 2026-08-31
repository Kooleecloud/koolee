# Auth setup — provider ownership, CAPTCHA, and OTP-send safety

Baseline: `dev` @ `5db21a4`. Feature-level overview:
[docs/features/auth.md](../../../docs/features/auth.md).

How Koolee's customer auth (phone/email OTP) is wired, and exactly which
credential lives where. The one-sentence version: **every auth _provider_
credential lives in the Supabase dashboard; `apps/web` holds only the public
Turnstile site key and its own OTP-log HMAC key.**

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

1. **Auth → Providers → Phone**: enable, provider _Twilio Verify_, paste the
   Twilio Account SID / Auth Token / Verify Service SID here — and only here.
2. **Auth → Attack Protection → CAPTCHA**: enable, provider _Turnstile_, paste
   the **Turnstile secret key** here — and only here. Supabase verifies the
   `captchaToken` the app forwards; the app never calls `siteverify`.
3. **Auth → Providers → Anonymous sign-ins**: enable for the funnel's draft
   sessions (the app degrades to cookie-only drafts when disabled).
4. **Auth → Rate Limits**: keep the project SMS rate limit on; it backstops
   the app-level throttle described below.

## App environment

| Variable                         | Where                        | Purpose                                                                                                                               |
| -------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | `apps/web` env (public)      | Renders the Turnstile widget. **The only Turnstile var the app needs.**                                                               |
| `OTP_LOG_HMAC_KEY`               | `apps/web` env (server-only) | Keys the HMAC that turns a phone/email into `otp_send_log.destination_hash`. Ours, not a provider's — no OTP is ever derived from it. |

There is deliberately no `TURNSTILE_SECRET_KEY` and no `TWILIO_*` key in app
env. With the site key absent (fresh clone), auth calls send no
`captchaToken` — leave Supabase CAPTCHA protection off in that environment.
`OTP_LOG_HMAC_KEY` is different: `apps/web/src/env.ts` refuses to boot any
server with a `DATABASE_URL` unless it is set and at least 32 chars, because
without it the throttle below cannot hash a destination at all. Rotating it
resets the rate-limit windows, which is harmless.

## Where the CAPTCHA token attaches

The JS SDK accepts `options.captchaToken` on `signInAnonymously()` and
`signInWithOtp()`, but **not** on `updateUser()` — the anonymous → permanent
upgrade. The protection chain:

| Call site                                              | Turnstile?   | Protection                                                    |
| ------------------------------------------------------ | ------------ | ------------------------------------------------------------- |
| `signInAnonymously()` — funnel start (flight confirm)  | Yes          | Token from the form-mounted widget                            |
| `signInWithOtp({ phone })` — sign-in / conflict branch | Yes          | Fresh token per send (`TurnstileGate.getToken()`)             |
| `signInWithOtp({ email })` — email paths               | Yes          | Fresh token per send                                          |
| `updateUser({ phone \| email })` — upgrade             | Not possible | Captcha-gated session + server throttle + Supabase SMS limits |
| `verifyOtp(...)`                                       | No           | Supabase verification rate limits                             |

An attacker cannot reach the `updateUser` send without first solving a
Turnstile challenge to obtain an anonymous session, and each session is then
throttled.

## Server-side OTP send throttle (`otp_send_log`)

`guardUpgradeSend` in `apps/web/src/actions/auth.ts`, backed by
`guardUpgradeOtpSend` in `packages/core/src/auth/upgrade-guard.ts`, runs
before every `updateUser` send. The throttle and the claim reconciliation
below execute as **one transaction** holding two advisory locks in fixed
order — user, then destination — so neither cap goes soft under concurrent
bursts and no other guarded send can interleave between the two steps:

- max **3** sends per user per rolling **15 minutes** (the user lock is what
  makes this hold across a burst to _different_ destinations);
- max **5** sends per destination per rolling **60 minutes**, across all
  users — this blocks farming one number through fresh anonymous sessions;
- exceeded → the action returns `rate_limited` and **no SMS is sent**;
- the log stores `destination_hash` — HMAC-SHA-256 via `hashDestination`
  (`packages/core/src/auth/hash-destination.ts`), keyed by
  `OTP_LOG_HMAC_KEY` — never the phone or email itself. Normalization lives
  in that one function so the write path and the counting read path cannot
  drift apart and silently stop matching;
- rows older than 24h are pruned by the daily cleanup job
  (`cleanupAnonymousUsers`).

Whether reconciliation runs is declared by the `AUTH_SCHEMA_AVAILABLE` env
var (set `"false"` only for a bare local Postgres with no GoTrue schema);
any unexpected guard failure returns `provider_error` and sends nothing.
Production boots refuse to start with this security config incomplete
(`assertProductionSecurityConfig` in `apps/web/src/env.ts`).

## `phone_change` collision reconciliation

`auth.users.phone_change` is not unique, and the funnel deliberately produces
abandoned anonymous sessions that may have written one. Without reconciliation
`verifyOtp({ type: "phone_change" })` can attach a phone to the wrong row —
a customer landing in a stranger's session.

Reconciliation runs inside the guarded transaction above, before every
upgrade send (standalone `reconcilePhoneClaims` / `reconcileEmailClaims` in
`packages/core/src/auth/reconcile-claims.ts` remain for direct use), under
the same per-identifier advisory lock:

- colliding **anonymous** rows are abandoned sessions: their draft,
  `public.users` row, and auth user are deleted;
- a colliding **permanent** row is never touched: the action returns
  `phone_conflict` / `email_conflict` **before any SMS is sent**, and the UI
  routes into the "Welcome back" sign-in branch. The old error-message
  parsing survives only as a defensive fallback.

## Acceptance checks

```bash
# No Twilio env keys or imports. (Not a bare "twilio" grep: the mandated
# provider-ownership comments in auth code legitimately contain the word.)
grep -riE "TWILIO_|from ['\"]twilio" apps/ packages/ --include='*.ts' --include='*.tsx'
# No Turnstile secret anywhere in source. (Scoped like the grep above: a
# bare `grep -ri "TURNSTILE_SECRET" .` trips on this doc and on stale
# `.next/` build output from before the key was removed.)
grep -riE "TURNSTILE_SECRET" apps/ packages/ supabase/ scripts/ \
  --include='*.ts' --include='*.tsx' --include='*.toml' --include='*.sh' \
  --include='*.example' --include='*.mjs'
```

Behavioral checks: a 4th OTP send within 15 minutes returns `rate_limited`
with no new Twilio Verify attempt; submitting a phone owned by a permanent
account returns the conflict before any SMS; two anonymous sessions claiming
the same number resolve to the most recent verifier, with the older session
and its draft deleted.
