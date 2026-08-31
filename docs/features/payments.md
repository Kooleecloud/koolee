# Payments

> Authorize at booking, capture once bags are in custody, refund on
> cancellation — all through one provider seam. Baseline: `dev` @ `5db21a4`.
> ← [Features index](README.md) ·
> Deeper: [payments-lifecycle.md](../../apps/web/docs/payments-lifecycle.md)

---

## 1. The one-paragraph model

Money is **authorized** when the customer books and **captured** only once the
agent has physically taken the bags. `paid` in the state machine therefore means
_"we hold an authorization"_, **not** _"we have the money"_.

🧭 Any revenue report reading `status = 'paid'` is counting **promises**. Cash
is in `payments`.

---

## 2. The seam

[packages/core/src/payments/](../../packages/core/src/payments/) —
`types.ts` (the `PaymentProvider` interface), `fake.ts`, `stripe/`, and
`factory.ts` choosing between them.

**Absent Stripe credentials select `FakePaymentProvider` rather than failing.**
That is why the whole funnel works end-to-end on a fresh clone with no Stripe
account.

⚠️ Core never talks to Stripe directly. Every payment operation goes through the
interface, which is what makes the lifecycle testable without network calls.

---

## 3. Creating the intent

[payment-intent.ts](../../packages/core/src/services/payment-intent.ts)

- Entering `/book/pay` calls **`ensureBookingPaymentIntent`**.
- Returning from the provider's confirmation flow calls
  **`reconcileBookingPayment`**.

Both read the provider **only** through the seam, and the booking moves **only**
through the state machine. **A client-side success signal is never trusted.**

### 3.1 — Idempotency: one intent per draft

Re-visiting the pay step must not mint a second intent. The caller passes the
booking id its funnel draft remembered (`existingBookingId`); **when the cookie
lost it**, the newest `draft`-status booking whose fields _fingerprint-match_ the
funnel draft is reused instead.

### 3.2 — The amount-changed contract

Two genuinely different cases, handled differently:

| Change                                                                                                                         | Handling                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Pure amount drift** — same window/bags/flight/address/passenger (a promo applied after the intent, or a pricing-rule change) | `PaymentProvider.updateAuthAmount`. Stripe can update a not-yet-confirmed intent's amount natively; the `payments` row and booking price follow **in one transaction**                                                   |
| **Structural draft change** — different window, bag count, flight, address, or passenger                                       | The booking row itself is stale, not just its amount. The stale draft booking is **cancelled** via `cancelBookingWithRefund` (matrix cancel + intent void through the seam) and a **fresh** booking + intent are created |

🧭 This distinction is the reason the pay step can be revisited freely. Get it
wrong and you either strand intents or silently charge for the wrong booking.

### 3.3 — The return route is the authority, not the redirect

Stripe's `return_url` lands on **`GET /book/return`**
([route.ts](../../apps/web/src/app/book/return/route.ts)) after *every*
confirmation attempt — card success, a 3DS challenge outcome, or a failure.

⚠️ Stripe appends `redirect_status` and `payment_intent_client_secret` to that
URL, and **both are deliberately ignored.** The only authority consulted is
`reconcileBookingPayment`, which re-reads the intent through the seam and
advances the booking through the same matrix move the webhook uses. A
client-visible success signal is never trusted — the query string is something a
customer can type.

It is a **route handler rather than a page** because the authorized outcome has
to clear the draft cookie, and only actions and route handlers may write
cookies.

An outcome that is neither settled nor failed — Stripe's `processing`, or a
status that could not be read just now — lands on `/book/processing`, which
makes no claim and offers a "Check again" that re-runs this same re-check. The
draft cookie is left intact so a failure can retry the pay step with everything
still in it.

---

## 4. Capture — deferred, and off-device

[payment-lifecycle.ts](../../packages/core/src/services/payment-lifecycle.ts)

`captureDueBookings` ([:149](../../packages/core/src/services/payment-lifecycle.ts#L149))
sweeps authorizations whose bags are already in Koolee's custody. It runs on an
**Inngest cron every 5 minutes** and is also exposed as a manual route:

```
POST /api/jobs/capture-due     header: x-cron-secret: $CRON_SECRET
```

⚠️ The route **refuses to run without `CRON_SECRET`** (503), so it can never be
triggered anonymously in production
([capture-due/route.ts](../../apps/web/src/app/api/jobs/capture-due/route.ts)).

### 4.1 — Why a sweep, not "capture when the agent taps done"

**The agent app holds no payment credentials.** It _cannot_ take money at the
moment it completes a visit — and that is the design, not a limitation. The
sweep lives in `apps/web` because that is the app that holds Stripe credentials
([agent-visit.ts:275](../../packages/core/src/services/agent-visit.ts#L275)).

### 4.2 — Capture failure is an exception, not a log line

`captureBookingPayment` returns `{ ok: false, reason }` and, on failure, **moves
the booking to `exception` through the state machine** with a custody event
carrying the reason, and alerts ops.

> **Bags must not travel on an unpaid booking without a human deciding so.**

---

## 5. Refunds and cancellation

`cancelBookingWithRefund` — matrix `cancel` plus a void or refund through the
seam, depending on whether the authorization was captured.

⚠️ **`cancel` disappears at `in_transit`.** Once a driver physically has the
bags, cancellation is not a real-world event; that situation is an `exception`
requiring an admin. The path back out runs _through_ `exception`, with a
recorded reason. See [ops-console.md](ops-console.md).

`apps/admin` needs `STRIPE_SECRET_KEY` for exactly this — refunds.

---

## 6. Webhooks

`POST /api/webhooks/stripe` → `handlePaymentEvent`
([webhooks.ts](../../packages/core/src/services/webhooks.ts)).

**The route is pinned:** `runtime = "nodejs"` and the **raw body** — signature
verification needs both. **Both pins are asserted in a test** so a refactor
cannot quietly break them.

### 6.1 — Replay guard

`payment_webhook_events` records processed events; `payments (provider,
provider_ref)` is **unique** and is the idempotency key. A replayed event is a
no-op, not a double-capture.

### 6.2 — Local testing

```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

`STRIPE_WEBHOOK_SECRET` comes from that command's output, or from the Stripe
dashboard in production.

---

## 7. Payment statuses

`payment_status` in [enums.ts](../../packages/db/src/schema/enums.ts):

| Value        | Meaning                                                     |
| ------------ | ----------------------------------------------------------- |
| `pending`    | Intent created, awaiting client confirmation in the browser |
| `authorized` | Funds held. Booking is `paid`                               |
| `captured`   | Money taken. Bags are in custody                            |
| `refunded`   | Returned after capture                                      |
| `cancelled`  | Authorization voided before capture                         |
| `failed`     | Provider rejected                                           |

---

## 8. Production checklist

1. `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`,
   `STRIPE_WEBHOOK_SECRET` set on `apps/web`.
2. `STRIPE_SECRET_KEY` set on `apps/admin` (refunds).
3. Stripe webhook endpoint pointed at the deployed web app.
4. `CRON_SECRET` set, and the Inngest capture cron actually running — **without
   it, authorizations are never captured and expire.**

⚠️ Item 4 is the quiet one. Everything looks healthy: bookings complete, bags
move, customers are happy, and no money arrives.
