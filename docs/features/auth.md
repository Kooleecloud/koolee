# Auth

> Two entirely separate auth systems: **customers** (phone/email OTP, self-serve)
> and **staff** (invite-only email/password). Baseline: `dev` @ `5db21a4`.
> ← [Features index](README.md)
>
> Deeper detail: [setup-auth.md](../../apps/web/docs/setup-auth.md) ·
> [staff-auth.md](../../apps/admin/docs/staff-auth.md) ·
> [pre-launch-security.md](../../apps/web/docs/pre-launch-security.md)

---

## 1. Who owns what

**Supabase Auth (GoTrue) owns identity.** Koolee owns authorization.

| Concern                            | Owner                                                               |
| ---------------------------------- | ------------------------------------------------------------------- |
| OTP generation + delivery          | Supabase Auth → Twilio Verify                                       |
| Twilio credentials                 | **Supabase dashboard only.** Never in app env                       |
| CAPTCHA verification               | **Supabase.** The app forwards a token; it never calls `siteverify` |
| Turnstile _secret_ key             | Supabase dashboard → Auth → Attack Protection                       |
| Turnstile _site_ key               | App env (`NEXT_PUBLIC_TURNSTILE_SITE_KEY`)                          |
| Session → role, ownership checks   | `packages/core`                                                     |
| OTP throttle, claim reconciliation | `packages/core/src/auth/`                                           |

🧭 **The pattern to carry:** Koolee deliberately does _not_ re-implement what
Supabase already does. The security work in `core/auth` is the part Supabase
does **not** do — rate-limiting sends per user/destination and resolving
identity-claim collisions.

---

## 2. Customer auth

### 2.1 — The funnel is anonymous-first

A customer fills the funnel **before** authenticating. The auth gate is
`/book/verify`, inside step 4.

Anonymous sign-ins are **OFF** on the hosted project, so there is a **cookie
fallback** for holding a draft without an anon user. The draft must survive the
anonymous → permanent upgrade either way.

### 2.2 — The upgrade

At the gate, the anonymous session (or cookie draft) is upgraded to a real user
identified by a verified phone or email. Services:
`ensureCustomerFromAuth`, `attachVerifiedPhone`, `attachEmail`,
`markEmailVerified`, `completeProfile`, `deleteAnonymousCustomer`
([customers.ts](../../packages/core/src/services/customers.ts)).

### 2.3 — The upgrade send guard ⚠️

[upgrade-guard.ts](../../packages/core/src/auth/upgrade-guard.ts) is the most
subtle code in the repo. Read it before touching anything nearby.

Two pre-send controls — the **OTP throttle** and **claim reconciliation** — run
as **ONE transaction under one lock scope** (user lock, then destination lock,
held for the duration of both).

**Why merged:** running them as two transactions releases the destination lock
between the throttle's commit and reconcile's re-acquisition. Two sessions
claiming the same destination can interleave into that gap, and _either side's_
claim can be the one reconciled away.

Transaction semantics that are easy to get wrong:

- A **`conflict` result COMMITS the throttle row** — probing a registered number
  still counts against the caps.
- A **thrown reconcile rolls the whole transaction back**, throttle row
  included: the send never happened, so it is not counted.
- What is deliberately **not** serialized: the Supabase send itself
  (`updateUser`) happens _after_ the guard returns, outside the lock. A claimant
  that passed its guard but has not verified can still be reconciled away by a
  later guarded send — **that is designed last-claimant-wins behavior, not a
  race**.

### 2.4 — PII: destinations are hashed, never stored

`otp_send_log.destination_hash` is an HMAC of the phone/email
([hash-destination.ts](../../packages/core/src/auth/hash-destination.ts)),
keyed by `OTP_LOG_HMAC_KEY`. **Plaintext phones and emails are never persisted
in the throttle log.**

The key is validated **at import** whenever `DATABASE_URL` is set (min 32
chars) — see [ENVIRONMENT.md §4.1](../ENVIRONMENT.md#41--otp_log_hmac_key-validated-at-import).
Rotating it resets rate-limit windows, which is harmless.

Collision errors surface as `PHONE_EXISTS` / `EMAIL_EXISTS` rather than leaking
whether a specific destination is registered.

### 2.5 — `AUTH_SCHEMA_AVAILABLE`

Declares whether `DATABASE_URL` points at a database carrying GoTrue's `auth`
schema. `"false"` (bare local Postgres) **skips claim reconciliation** — an
explicit signal, replacing the `42P01` error-code sniffing it superseded.

**Unset counts as available, on purpose:** against a database that unexpectedly
lacks the schema, reconciliation then fails the send **loudly** instead of being
silently skipped. Only an explicit `"false"` opts out.

### 2.6 — Signing in: two channels, one code screen

`/login` takes a phone **or** an email, and both land on the same six-digit
code screen and the same `verifyOtp`.

**Email is a signup channel, not just a lookup.** It calls `sendOtp`'s email
branch with `shouldCreateUser: true`, so an address with no account gets one.
It previously called `sendMagicLink` (`shouldCreateUser: false`), where an
unknown address made Supabase answer `otp_disabled` and the flow dead-ended on
"we couldn't find that email" — no account could ever be created by email.
That matters while phone verification waits on Twilio business approval: there
has to be at least one way in.

An address that already belongs to someone simply signs that person in. The
`PHONE_EXISTS` / `EMAIL_EXISTS` collisions in §2.3 are about **attaching** a
destination to a _different_ account — the funnel's upgrade path — not about
signing in.

**No magic links.** A code works when the inbox is on a different device from
the browser; a link does not.

⚠️ Email OTP is inert without four Supabase dashboard settings, none of them
visible in the codebase: custom SMTP, `{{ .Token }}` in three templates, OTP
length **6** (`verifyOtp` validates `/^\d{6}$/`, so an 8-digit code is
rejected after delivery starts working), and the Site URL. See
[ENVIRONMENT.md §6.6](../ENVIRONMENT.md).

### 2.7 — Customer routes

| Route                  | Role                                                   |
| ---------------------- | ------------------------------------------------------ |
| `/login`               | Phone/email OTP entry                                  |
| `/auth/callback`       | Session exchange                                       |
| `/book/verify`         | The funnel's auth gate                                 |
| `/dashboard/profile`   | Account area — name, contact channels, saved addresses |
| `/dashboard/addresses` | Redirects to `/dashboard/profile` (retired)            |
| `/trips`, `/trips/[id]` | The customer's bookings — verified sessions only      |

### 2.8 — `coming_soon` closes every account surface, at the edge

`proxy.ts` holds two lists, and the order they are checked in is the point:

```
VERIFIED_ONLY        /trips, /dashboard        — needs a verified session
COMING_SOON_CLOSED   /login, /trips, /dashboard — redirected home outright
```

⚠️ **The launch-mode gate is checked BEFORE the Supabase short-circuit**, so it
holds even in an environment with no credentials configured at all. It is also
written as a literal `process.env.NEXT_PUBLIC_LAUNCH_MODE` member expression so
the Next compiler inlines it into the edge bundle — destructuring it would leave
the gate reading `undefined` in production.

Production runs `coming_soon` today, which is why flipping it arms several boot
gates in one deploy ([ENVIRONMENT §4](../ENVIRONMENT.md#4-fail-closed-boot-gates),
[LAUNCH-CHECKLIST.md](../LAUNCH-CHECKLIST.md)). While it is on, account creation
is off and the marketing site plus a browsable funnel are all that is reachable.

---

## 3. Staff auth

**Invite-only email/password. There is no staff self-signup.**

| App          | Routes                                                      |
| ------------ | ----------------------------------------------------------- |
| `apps/agent` | `/login`, `/login/reset`, `/set-password`, `/auth/callback` |
| `apps/admin` | same, plus `/staff` to invite/deactivate                    |

Roles come from `staff_members` via `getActiveStaffRole` /`isStaffRole`
([staff.ts](../../packages/core/src/services/staff.ts)); enforcement is
`requireRole` ([require-role.ts](../../packages/core/src/auth/require-role.ts)).

⚠️ **Invites are issued from admin and must land on the _agent_ app.** That is
what `NEXT_PUBLIC_AGENT_APP_URL` is for — missing, invite links go to the wrong
app, which is why it is in admin's production boot gate.

### 3.1 — The agent app holds no service-role key

Deliberate, and load-bearing. The agent app runs on a shared, frequently-lost
field device. It authenticates as the signed-in agent via the anon key, and
bag-photo uploads are authorized by **Storage RLS** — the only authorization
mechanism available there _precisely because_ there is no service key.

The staff test runs through the SECURITY DEFINER function
`public.is_active_staff(uuid)` (migration `0009`), because granting
`authenticated` a direct `SELECT` on `staff_members` would expose the roster
through PostgREST.

### 3.2 — Authorization is assignment

In the agent app, every function resolves a task by `(id, assignee =
session.userId)`. **Someone else's task 404s** — see
[agent-visit.md](agent-visit.md).

---

## 4. Fail-closed production gate

`assertProductionSecurityConfig()` refuses to boot `apps/web` in production when
any auth control would be **silently off**:

| Missing                          | Silently disables                                                                                                  |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | No widget mounts → CAPTCHA off across the whole funnel                                                             |
| `SUPABASE_SERVICE_ROLE_KEY`      | `deleteAuthUser` becomes a no-op → orphaned GoTrue users → reinstates the `phone_change` collision bug             |
| `DATABASE_URL`                   | `guardUpgradeSend` degrades to allow-all — no throttle, no reconciliation, **while Supabase still sends real SMS** |
| `AUTH_SCHEMA_AVAILABLE="false"`  | Reconciliation explicitly disabled                                                                                 |

🧭 **A failed assertion is the intended outcome of a missing secret.** Do not add
a bypass.

---

## 5. Testing

Auth acceptance runs against the **local Supabase stack** (`pnpm test:env:up`),
which stands up real GoTrue. Covered: the upgrade guard under **real concurrent
locks**, OTP concurrency, and the `phone_change` collision cases.

Mail is captured by **Mailpit** locally, which is how the end-to-end Playwright
pass completes an email OTP. See
[local-test-env.md](../../packages/core/docs/local-test-env.md) and
[SCRIPTS.md](../SCRIPTS.md).
