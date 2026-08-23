# Background jobs & notifications

> Inngest functions, the cron-protected manual routes, and the notification
> seam. Baseline: `dev` @ `2fe3a2b`. ← [Features index](README.md)

---

## 1. Where jobs live

**Five functions, all served from `apps/web` at `/api/inngest`** — but defined
in two places, and the split is deliberate:

| Defined in                                                                       | Which                                               | Why there                                                                     |
| -------------------------------------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------- |
| [packages/core/src/jobs/functions.ts](../../packages/core/src/jobs/functions.ts) | Pickup reminder, cutoff-risk monitor, agent no-show | Pure domain jobs — no app credentials needed                                  |
| [apps/web/src/lib/inngest.ts](../../apps/web/src/lib/inngest.ts)                 | Capture-due sweep, anonymous/draft GC               | Need **Stripe** and **service-role** credentials, which only `apps/web` holds |

🧭 That split _is_ the credential boundary showing up in the job layer: a job
that needs a secret is defined in the app that owns the secret, not in core.

⚠️ Some source comments (including `api/inngest/route.ts`) still say "all three
functions". There are five.

**Each job is written as a factory taking `() => CoreConfig`, not a config
value** — so the database connection opens when a run actually happens, not when
the module is imported. **Importing this file with no credentials must not
throw.**

⚠️ **Status: skeletons with real querying and logging, stubbed side effects.**
The queries are genuine; the SMS/email sends are not yet wired. Treat these as
correct-shaped, not production-complete.

---

## 2. The jobs

### 2.1 — Pickup reminder

**Trigger:** `booking/confirmed` event. Sleeps until **2 hours before** the
pickup window, then sends the customer an SMS.

`step.sleepUntil` is **durable**: the run is suspended server-side and resumed at
wall-clock time, so it **survives deploys and restarts**. A `setTimeout` would
not.

🧭 That durability is the reason Inngest is here at all. Anything that needs to
happen "later" across a deploy belongs in a job, not in application memory.

### 2.2 — Cutoff-risk monitor

**Trigger:** cron `*/5 * * * *`. Checks in-transit bookings against their
bag-drop cutoff and alerts ops on anything tight.

⚠️ **Driver ETA is stubbed.** The real version compares live vehicle position
against a Maps ETA; until then it assumes the configured default drive time,
which is **optimistic and therefore under-alerts**. Noted deliberately in the
source: _an alert that fires late is worse than one that fires early._

### 2.3 — Agent no-show check

**Trigger:** 15 minutes after a slot starts (`NO_SHOW_GRACE_MINUTES`). Checks
whether the assigned agent actually began the verification task; escalates to
ops if not.

### 2.4 — Payment capture sweep

Every **5 minutes**, `captureDueBookings` captures authorizations whose bags are
already in custody. See [payments.md §4](payments.md#4-capture--deferred-and-off-device).

### 2.5 — Abandoned-draft + anonymous-user GC

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

`RESEND_API_KEY` drives transactional email; absent, the notifier logs to
console. `confirmation-email.ts`
([services/](../../packages/core/src/services/confirmation-email.ts)) builds the
booking confirmation.

Locally, mail is captured by **Mailpit** in the `pnpm test:env:up` stack — which
is how the end-to-end Playwright pass completes an email OTP.

---

## 7. What is genuinely not done

Honest state, so you can plan against it:

- Job **side effects are stubbed** — the queries run, the sends do not.
- **Driver ETA is a fixed estimate**, so the cutoff monitor under-alerts.
- **Custody-event SMS has no provider adapter** yet.
- **AeroAPI flight lookup is stubbed.**

Tracked in [PROJECT-STATUS.md](../../PROJECT-STATUS.md).
