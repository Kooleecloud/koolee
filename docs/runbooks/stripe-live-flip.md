# Runbook — Stripe: test mode → live mode

**When:** Stripe business verification has cleared and Koolee is ready to take
real money. **Not before** — a live secret key on an unverified account fails
at the first charge, in front of a customer.

**Blast radius:** every payment. Reversible in one redeploy (§6).

**Who:** TD. None of this is automated, and none of it should be.

---

## 0. What does NOT change

Nothing in the code, and no migration. Verified by reading the provider: the
Stripe client is constructed lazily from `config.secretKey` with no environment
read anywhere ([payments/stripe/provider.ts](../../packages/core/src/payments/stripe/provider.ts)),
and there is no test-mode branch. `capture_method: "manual"` and
`automatic_payment_methods` are flow constants, not mode constants.

The one pinned constant is the API version, `2026-07-29.dahlia`, which must
match the installed SDK's `Stripe.LatestApiVersion` exactly (`stripe ^22.4.0`).
It is unaffected by the mode.

---

## 1. Before you start

- [ ] Stripe → **Business verification is complete** and the account can accept
      live charges.
- [ ] You are on the **Live** toggle in the Stripe dashboard for every step
      below. Test-mode objects do not carry over — this is the single most
      common way this goes wrong.
- [ ] `docs/runbooks/cutover-rehearsal.md` has been run at least once in test
      mode, end to end.

---

## 2. The four variables

All in Vercel, **Production scope only**. Preview stays on test keys — a
preview deployment that can charge a real card is a preview nobody can use.

| Variable                             | App               | New value                                                                                                   |
| ------------------------------------ | ----------------- | ----------------------------------------------------------------------------------------------------------- |
| `STRIPE_SECRET_KEY`                  | web **and admin** | `sk_live_…`                                                                                                 |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | web               | `pk_live_…`                                                                                                 |
| `STRIPE_WEBHOOK_SECRET`              | web               | the NEW live endpoint's `whsec_…` (§3)                                                                      |
| —                                    | agent             | **nothing.** The agent app holds no Stripe credential by design, and `pnpm env:verify` fails if one appears |

⚠️ **The two web keys move in the SAME deploy.** A live secret with a test
publishable key puts the pay step into `"misconfigured"`: the server would
authorize against real Stripe and the browser could never confirm. Since Tier 5
that is also a **boot gate** — the deploy refuses rather than serving a broken
pay step.

⚠️ **`apps/admin` needs the secret too**, because refunds are issued from the
console. It reads no `STRIPE_WEBHOOK_SECRET` at all, which is correct: only web
receives webhooks.

---

## 3. The live webhook endpoint

Test-mode endpoints do not carry over. Create a new one:

1. Stripe → **Developers → Webhooks → Add endpoint** (Live mode).
2. URL: `https://koolee.cloud/api/webhooks/stripe`
3. Subscribe to **exactly these four**, which are the four the provider
   handles ([provider.ts](../../packages/core/src/payments/stripe/provider.ts)):
   - `payment_intent.amount_capturable_updated`
   - `payment_intent.succeeded`
   - `payment_intent.canceled`
   - `payment_intent.payment_failed`
4. Copy the endpoint's **signing secret** (`whsec_…`) into
   `STRIPE_WEBHOOK_SECRET`, Production scope.

A stale test-mode secret against a live endpoint makes every event a **signed
400**: `verifyWebhook` refuses rather than trusting an unverified payload, so
nothing reaches `paid` and every booking sits unconfirmed while Stripe's
dashboard fills with failures nobody is watching.

---

## 4. Deploy

```bash
pnpm env:verify --app web --live --push          # or --file / --stdin, see §5
```

Then redeploy Production **with the build cache OFF**. Vercel bakes env vars
into a build, server-side ones included, so a cached build keeps the old values
and the flip looks like it did not work.

---

## 5. Verify, in this order

- [ ] The deployment **booted**. With Tier 5's gates, a missing Stripe variable
      refuses the boot rather than serving a broken pay step — a failed deploy
      here is the gate doing its job.
- [ ] `vercel env ls production | pnpm env:verify --stdin --live` — no MISSING
      lines. (It reads names, never values; it cannot tell `sk_test_` from
      `sk_live_`. That is what the next step is for.)
- [ ] Stripe → Developers → **Events** (Live): make one real booking with a
      real card, and watch `payment_intent.amount_capturable_updated` deliver
      **200**.
- [ ] The booking reaches `paid`, the confirmation email arrives, and
      `payments` carries a row with the live `provider_ref`.
- [ ] Complete the visit and confirm the capture lands within ~5 minutes (the
      `capture-due-bookings` cron). **This is the step people skip**, and the
      failure it catches is silent: without `CRON_SECRET` and a running cron,
      authorizations expire and no money ever arrives while every other signal
      stays green.
- [ ] Refund that booking from the admin console. It proves the admin app's own
      live secret works, which nothing else exercises.

---

## 6. Rollback

Put the three test values back — `sk_test_…`, `pk_test_…`, and the TEST
endpoint's `whsec_…` — and redeploy with the cache off. Nothing else to undo:
no migration ran, and live payment objects simply stop being created.

Bookings already authorized against live Stripe stay live objects. Cancel or
refund them in the Stripe dashboard before rolling back, or their
authorizations will expire uncaptured.
