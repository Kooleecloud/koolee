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

## Capture at pickup — `captureBookingPayment`

Called when the agent completes verification/sealing —
`completeVerificationVisit` (`packages/core/src/services/agent-visit.ts`)
invokes it once every bag carries a seal and the booking has moved through
`complete_verification`. Captures the authorized amount via the seam, sets
`payments.status = captured` + `capture_ref`, and appends a
`booking.payment_captured` custody event with the real staff actor id.

**Capture failure is ops-visible, never a log line:** the booking moves to
the matrix's `exception` state with a custody event carrying the reason,
and `opsAlerter.alert(severity: critical)` fires. A capture that _throws_
(no authorized payment row at all) is caught in `completeVerificationVisit`
and lands in the same exception + alert path, so the agent sees "ops will
follow up" rather than a fake success.

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
