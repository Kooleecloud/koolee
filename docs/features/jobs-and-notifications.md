# Background jobs & notifications

> Inngest functions, the cron-protected manual routes, and the notification
> seam. Baseline: `dev` @ `ad65272`. ← [Features index](README.md)

---

## 1. Where jobs live

**Eight functions, all served from `apps/web` at `/api/inngest`** — but defined
in two places, and the split is deliberate:

| Defined in                                                                       | Which                                                                                                                  | Why there                                                                     |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| [packages/core/src/jobs/functions.ts](../../packages/core/src/jobs/functions.ts) | Booking confirmation email, pickup reminder, exception ops-alert email, waitlist zone-opened sweep, cutoff-risk monitor, agent no-show | Pure domain jobs — no app credentials needed (email config is injected)       |
| [apps/web/src/lib/inngest.ts](../../apps/web/src/lib/inngest.ts)                 | Capture-due sweep, anonymous/draft GC                                                                                    | Need **Stripe** and **service-role** credentials, which only `apps/web` holds |

🧭 That split _is_ the credential boundary showing up in the job layer: a job
that needs a secret is defined in the app that owns the secret, not in core.
The core-defined functions still receive app-resolved config through
`createKooleeFunctions(inngest, getConfig, { opsAlertEmail, appOrigin })` —
core reads no env, ever.

**Each job is written as a factory taking `() => CoreConfig`, not a config
value** — so the database connection opens when a run actually happens, not when
the module is imported. **Importing this file with no credentials must not
throw.**

**Status (2026-08-23): email side effects are REAL** — Resend when
`RESEND_API_KEY` is present, console otherwise. SMS remains the console
fallback (the Twilio adapter is a later work item), and the driver ETA in the
cutoff monitor is still a fixed estimate.

---

## 2. The jobs

### 2.0 — The events are actually emitted now

`booking/confirmed` and `booking/exception_raised` were catalogued from the
start but **never sent** — every event-triggered function below was dead code
until 2026-08-23. Emission lives in
[apps/web/src/lib/booking-events.ts](../../apps/web/src/lib/booking-events.ts)
(no-throw, deterministic event ids like `booking-confirmed:<bookingId>`):

- `booking/confirmed` fires from **every path to `paid`** — the Stripe
  webhook, the `/book/return` re-check, and the fake-provider inline path —
  each keyed on "THIS call performed the move" (`WebhookOutcome.movedTo`,
  `movedToPaid`), so redeliveries, refreshes, and lost races never re-fire.
- `booking/exception_raised` fires from the webhook payment-cancelled path.
  ⚠️ Admin-raised exceptions do **not** emit yet — apps/admin has no Inngest
  client (tracked in PROJECT-STATUS #16).

### 2.1 — Booking confirmation email

**Trigger:** `booking/confirmed`. Emails the customer the full confirmation:
flight, pickup window **in the booking airport's zone with abbreviation**
(TIME.md rules), address, bags, the price breakdown **persisted at booking
time** (never recomputed — prices may have changed since), and a trip-page
link when `NEXT_PUBLIC_APP_URL` is set. Skips with a logged reason when the
account has no email — see §6 for the flow that covers that case.

### 2.2 — Pickup reminder

**Trigger:** `booking/confirmed`. Sleeps until **2 hours before** the pickup
window, then sends the customer an SMS (console until Twilio) **and an
email** (real). Both channels sit behind one reminder-worthy guard: only
`paid` / `agent_assigned` bookings get reminded — anything further along is
already being served, and cancelled/exception must stay quiet.

`step.sleepUntil` is **durable**: the run is suspended server-side and resumed at
wall-clock time, so it **survives deploys and restarts**. A `setTimeout` would
not.

🧭 That durability is the reason Inngest is here at all. Anything that needs to
happen "later" across a deploy belongs in a job, not in application memory.

### 2.3 — Exception ops-alert email

**Trigger:** `booking/exception_raised`. Emails the ops inbox
(`OPS_ALERT_EMAIL`, injected via function options); unset → logged skip. The
ConsoleOpsAlerter and the board's exception queue surface it regardless.

### 2.4 — Waitlist zone-opened sweep

**Trigger:** cron, daily 10:00 America/New_York. Coverage lives in code, so
"a zone opened" is a **deploy** — the sweep reconciles instead: scan
`waitlist_signups` where `notified_at IS NULL`, email rows whose ZIP is
covered **now**, stamp on success. Failed sends stay queued for the next
sweep; still-uncovered rows wait untouched. Batch-capped at 200/run.

### 2.5 — Cutoff-risk monitor

**Trigger:** cron `*/5 * * * *`. Checks in-transit bookings against their
bag-drop cutoff and alerts ops on anything tight.

⚠️ **Driver ETA is stubbed.** The real version compares live vehicle position
against a Maps ETA; until then it assumes the configured default drive time,
which is **optimistic and therefore under-alerts**. Noted deliberately in the
source: _an alert that fires late is worse than one that fires early._

### 2.6 — Agent no-show check

**Trigger:** 15 minutes after a slot starts (`NO_SHOW_GRACE_MINUTES`). Checks
whether the assigned agent actually began the verification task; escalates to
ops if not.

### 2.7 — Payment capture sweep

Every **5 minutes**, `captureDueBookings` captures authorizations whose bags are
already in custody. See [payments.md §4](payments.md#4-capture--deferred-and-off-device).

### 2.8 — Abandoned-draft + anonymous-user GC

Daily at **04:00 America/New_York**: `expireBookingDrafts` +
`cleanupAnonymousUsers`.

---

## 3. Manual trigger routes

Two jobs are also exposed as HTTP routes for manual invocation:

```bash
curl -X POST -H "x-cron-secret: $CRON_SECRET" /api/jobs/capture-due
curl -X POST -H "x-cron-secret: $CRON_SECRET" /api/jobs/cleanup-anon
```

⚠️ **Both refuse to run without `CRON_SECRET`** (503) so they can never be
triggered anonymously in production. Both pin `runtime = "nodejs"` and
`dynamic = "force-dynamic"`.

---

## 4. Running jobs locally

```bash
pnpm dev:inngest    # inngest-cli dev -u http://localhost:3000/api/inngest
```

Neither `INNGEST_EVENT_KEY` nor `INNGEST_SIGNING_KEY` is needed against the local
dev server. Both are required in Inngest Cloud.

---

## 5. The notification seam

[packages/core/src/notifications/](../../packages/core/src/notifications/) —
`dispatcher.ts`, `notifier.ts`.

```ts
interface NotificationDispatcher {
  send(input: {
    userId: string;
    template: string;
    data: Record<string, unknown>;
    preferredChannel?: "sms" | "email";
  }): Promise<void>;
}
```

Default implementation is `NoopDispatcher` — **logs and returns**.

The lower-level `Notifier` seam underneath it grew its first real adapter
(2026-08-23): **`ResendNotifier`**
([notifications/resend/](../../packages/core/src/notifications/resend/)) —
the email side via the Resend REST API with an injectable `fetch` (no SDK
dependency; the directory carries the same only-place-that-talks-to-the-
provider boundary as `payments/stripe`). Selection is injected, mirroring
`createPaymentProvider`: `createNotifier({ kind: "resend", apiKey, from })`
or `{ kind: "console" }`, resolved by the app in
[apps/web/src/lib/core.ts](../../apps/web/src/lib/core.ts) and passed
through `createRuntime`'s `notifications` option. `sendSms` on the Resend
adapter deliberately stays the console fallback.

### 5.1 — This is NOT auth OTP delivery

A separate concern, and the separation is load-bearing:

|                                                                              | Owner                     | Credentials                                      |
| ---------------------------------------------------------------------------- | ------------------------- | ------------------------------------------------ |
| **Auth OTP** (sign-in codes)                                                 | Supabase Auth, end-to-end | **Supabase dashboard only**                      |
| **Custody notifications** ("driver 10 min away", "bags sealed", "delivered") | This seam                 | Server-side env, **when the real adapters land** |

**Nothing in the auth flow imports this module.**

### 5.2 — Why the stub exists now

It reserves the boundary. Custody flows call `dispatcher.send(...)` **today**, so
wiring a real adapter later **changes no call sites**.

🧭 Same pattern as `payments` and `extraction`: typed interface + fake + factory.
When you add a capability with an external dependency, this is the shape to
copy.

---

## 6. Email

`RESEND_API_KEY` present → `ResendNotifier`; absent → console (dev is
unchanged by the integration). `RESEND_FROM` sets the sender (sandbox default
documented in env.ts — until the domain is verified at Resend, sends only
reach the Resend account's own address). A **fail-closed production boot
gate** (ENVIRONMENT.md §4.3b) refuses a live prod boot without the key.

Templates are pure builders in
[notifications/emails.ts](../../packages/core/src/notifications/emails.ts) —
plain-text body always, simple HTML on top, and the copy rules are **pinned
by unit tests**: "delivered to your airline's bag drop", never a check-in
claim, Tag Orange on the CTA only.

**Two complementary confirmation paths** — they never double-send:

| Path                                                                                          | When it fires                                                                                          |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `booking-confirmation-email` Inngest fn (§2.1)                                                | Account **has** an email at payment time                                                                |
| `sendBookingConfirmationEmail` ([services/confirmation-email.ts](../../packages/core/src/services/confirmation-email.ts)) | Customer had **no** email (the Inngest fn skipped) and adds one post-booking via `attachEmailPostBooking` |

Locally, **Resend emails print to the dev-server console** (no key = console
notifier). Mailpit in the `pnpm test:env:up` stack captures **Supabase auth
mail only** (email OTPs for the Playwright pass) — transactional email never
goes through it.

---

## 7. What is genuinely not done

Honest state, so you can plan against it:

- **SMS side effects are stubbed** — reminder/custody SMS logs to console;
  no Twilio adapter yet. (Email is real as of 2026-08-23.)
- **Driver ETA is a fixed estimate**, so the cutoff monitor under-alerts.
- **Admin-raised exceptions don't emit** `booking/exception_raised` — only
  the webhook payment-cancelled path does.
- **AeroAPI flight lookup is stubbed.**

Tracked in [PROJECT-STATUS.md](../../PROJECT-STATUS.md).
