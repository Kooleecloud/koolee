# Payment lifecycle — webhook, capture at pickup, refund on cancellation

Shipped 2026-08-09 (overnight run 1, Phase 5). Closes the deferred Stripe
loop. Everything goes through the `PaymentProvider` seam — nothing outside
`packages/core/src/payments/stripe/` imports the Stripe SDK.

## Webhook (`/api/webhooks/stripe`, nodejs runtime)

Raw body → `PaymentProvider.verifyWebhook` (signature) → normalised
`PaymentEvent` → `handlePaymentEvent` in core. Handled event classes:
authorization succeeded/failed, capture succeeded/failed, refund
succeeded, auth expired/canceled (Stripe's `payment_intent.canceled`
covers expiry).

**Idempotent, two layers:** processed event ids are recorded in
`payment_webhook_events` (migration `0007`) and a replayed id no-ops before
any work; underneath, every update is status-guarded so even a concurrent
duplicate cannot double-apply. The id is recorded only after successful
handling, so a crash mid-event lets the provider's redelivery finish the
job.

**State machine only:** payment events drive bookings exclusively through
the transition matrix. A failed authorization can never reach `paid` (only
`payment.authorized` triggers that move). An auth cancellation lands as
`cancel` pre-transit; once bags are moving — where the matrix forbids
cancel — it lands as `raise_exception`, because "the money vanished while
bags are in transit" is an ops problem, not a cancellation.

## Capture after pickup — `captureDueBookings` (swept, not inline)

**Changed 2026-08-10.** Capture used to run inline in the agent's
"complete visit" request. It now runs from apps/web on a sweep, and the
agent app is out of the payment path entirely.

`captureDueBookings(config)` selects bookings already in Koolee's custody
(`verified_sealed` … `delivered_to_bagdrop`) whose payment row is
`authorized` **for that config's own provider**, and captures each through
`captureBookingPayment`. Two properties fall out of that selection:

- **idempotent** — a captured row stops matching, so overlapping or repeated
  runs are harmless;
- **provider-scoped** — a row written by a different provider is invisible
  to the sweep rather than mis-captured.

Triggered two ways, both from apps/web because that is the app holding
Stripe credentials:

| trigger                     | when                                       |
| --------------------------- | ------------------------------------------ |
| `POST /api/jobs/capture-due` | manual / any external scheduler; `CRON_SECRET` required |
| Inngest `capture-due-bookings` | `cron("*/5 * * * *")`                   |

The actor on the resulting `booking.payment_captured` event is **NULL** — a
sweep is the system's act, and attributing the charge to whichever agent
happened to be at the door would be a lie in an append-only custody log.

### Why it moved

The agent app deliberately holds no payment credentials (a field device's
server should not be able to move money). With capture inline, it silently
wired the FAKE provider, `captureBookingPayment`'s provider check then found
no matching authorized row, and **every** pickup ended in `exception` with
the bags already sealed and collected. The provider check was doing its job
— without it the fake provider would have "captured" and marked the booking
paid while no money moved, which is strictly worse.

Splitting custody from money makes that class of bug structurally
impossible: the agent app cannot capture wrongly because it cannot capture.

**Trade-off accepted:** capture now lags pickup by up to the cron interval
(5 minutes). Card authorizations last days, so nothing is at risk; the
customer's trip page shows `authorized` slightly longer before `captured`.

**Capture failure is still ops-visible, never a log line:** the booking
moves to the matrix's `exception` state with a custody event carrying the
reason, and `opsAlerter.alert(severity: critical)` fires. Per-booking
failures are collected by the sweep rather than aborting the pass — one
stuck booking must not stop the rest from being charged.

## Refund on cancellation — `cancelBookingWithRefund`

Cancels through the state machine (the matrix is the authority — nothing
from `in_transit` onward), then unwinds the money via the seam:

- captured payment → **full refund** (`refund`), `booking.payment_refunded`
  custody event. TODO(fee-policy): no cancellation-fee rule exists in
  `pricing_rules` or core, so refunds are always full until a commercial
  policy lands — never invent fees ad hoc.
- un-captured authorization → void (`cancelAuth`),
  `booking.payment_auth_cancelled` custody event. A `pending` intent — one
  created but never confirmed in the browser — is voided the same way, so a
  superseded checkout draft can never leave a confirmable intent behind
  that could still place a hold. That is exactly why
  `payment-intent.ts`'s `cancelStaleDraft` routes through this function
  rather than cancelling by hand.
- a failed unwind appends `booking.payment_unwind_failed` and pages ops.

**There is no seat to release.** Pickup windows are virtual and uncapped
(`packages/core/src/slots/windows.ts`), so cancelling a windowed booking
frees nothing. The `slots.booked_count` decrement survives only for
pre-cutover rows that still carry a `slot_id`; every booking created since
migration `0012` has `slot_id = NULL` and skips it. `createBooking`'s
authorization-failure compensation no longer touches `slots` at all.

## FakePaymentProvider parity

`provider.simulateWebhook({type, providerRef, ...})` returns the exact
`{payload, signature}` pair the webhook path accepts, so integration tests
run the full verify → normalise → handle pipeline without Stripe.

## Exercising the real webhook locally (doc only — tests don't need it)

```sh
stripe listen --forward-to localhost:3000/api/webhooks/stripe
# copy the whsec_… it prints into apps/web/.env.local as STRIPE_WEBHOOK_SECRET
stripe trigger payment_intent.succeeded   # or any event class above
```

## Tests

`packages/core/src/services/payment-lifecycle.integration.test.ts` — webhook
valid-signature domain update / duplicate-event-id no-op / invalid-signature
rejection; pre-transit auth-cancel → cancelled vs in-transit → exception;
capture success (row + custody event + provider state) and capture failure
(exception + critical ops alert); cancellation voiding an auth on a windowed
booking (nothing to release) and, via a direct-insert fixture, a legacy
slot-backed booking still releasing exactly one seat; refunding a capture in
full; matrix refusal once in transit. The 10×11 matrix itself needed no new
transitions — its existing exhaustive tests stand unchanged.

Two sweep tests added 2026-08-10:

- the sweep captures a booking **in custody** and leaves a merely `paid` one
  alone, and a second pass is a no-op (idempotence);
- **a provider that did not write the payment can never mark it captured.**
  This is the blind spot that let the outage ship: the tier wires
  `FakePaymentProvider` on both sides, so a provider mismatch was previously
  invisible to every test. The new one relabels the row's provider and
  asserts the sweep cannot see it.
