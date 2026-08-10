# Overnight Run 2 — RUN REPORT

**Scope:** Real Stripe checkout (Payment Element) + deploy-readiness, per
`koolee-slice-stripe-checkout-prompt.md`.
**Branch:** `feat/overnight-run-1` (unchanged — see precondition note below).
**Protocol:** no git commands ever, stop-on-failure, full verification gate per
phase, no live external API calls in tests, local stack only, both DB URLs
pinned to `127.0.0.1` for anything DB-touching.

---

## Precondition check

**Deviation (flagged):** the prompt's precondition says "overnight run 1 is
committed." It is NOT — the branch is `feat/overnight-run-1` with HEAD still at
the base commit `4d80bb7`; all run-1 work sits uncommitted in the working tree
(committing is TD's manual step and git commands are forbidden to this run).
The explicit STOP condition is a non-green baseline, so the run proceeds with
two mitigations:

1. The pre-run `git status --porcelain` (131 entries) was snapshotted so run-2
   changes remain separable from run-1's.
2. Every file this run creates/modifies is listed exhaustively per phase below.

**Baseline (established before any edit):**

| Command                                       | Result                   |
| --------------------------------------------- | ------------------------ |
| `pnpm lint`                                   | PASS (6/6 packages)      |
| `pnpm typecheck`                              | PASS (6/6 packages)      |
| `pnpm test`                                   | PASS — core 245, web 43  |
| `pnpm --filter @koolee/core test:integration` | PASS — 55/55 (11 files)  |
| `pnpm build`                                  | PASS (web, agent, admin) |

`pnpm test:env:doctor`: Docker running, Supabase stack healthy; the known trap
(`packages/db/.env` `DIRECT_DATABASE_URL` → hosted project) is still live —
every DB-touching command in this run pins both URLs to
`postgresql://postgres:postgres@127.0.0.1:54322/postgres`.

Baseline green — run proceeds.

Note: `apps/web/.env.local` already carries Stripe TEST-mode keys
(`STRIPE_SECRET_KEY` = `sk_test_…`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` set,
`STRIPE_WEBHOOK_SECRET` absent) — verified boolean-only, no values read. The
optional real-key browser E2E is therefore in scope; webhook forwarding is not
(no webhook secret), so the return-page status re-check carries that E2E.

---

## Phase 1 — Stripe Payment Element (design decisions, recorded before coding)

1. **Where the intent is created.** The pre-existing TODO in
   `stripe-checkout.tsx` already pins the flow: a client-invoked server call
   runs `createBooking` (booking stays `draft`, Stripe authorize returns
   `requires_action` + client secret), the browser confirms, and the booking
   advances ONLY via webhook or a server-side re-check. This run implements
   exactly that: a `preparePayment` server action (client-invoked on mount —
   never on GET render, so link prefetch can never create a booking).
2. **Idempotency per draft.** The draft cookie's existing-but-unused
   `bookingId` key stores the pending draft booking; core's new
   `ensureBookingPaymentIntent` reuses its stored payments row
   (provider ref) instead of creating a second intent. Fallback when the
   cookie key is missing: newest `draft`-status booking for the user whose
   fields fingerprint-match the funnel draft.
3. **Amount-changed case.** Stripe DOES support updating a not-yet-confirmed
   PaymentIntent's amount, so pure amount drift (promo added, pricing-rule
   change — same slot/bags/flight) updates the intent through a new seam
   method `updateAuthAmount` and syncs `payments.amount_cents` +
   `bookings.price_cents`. A STRUCTURAL draft change (different slot, bags,
   flight, address, passenger) makes the booking row itself stale, so that
   path cancels the stale draft booking through the existing
   `cancelBookingWithRefund` (matrix cancel + seat release + auth void via
   the seam) and creates a fresh booking + intent. Both paths documented in
   code.
4. **Seam extension (the only Stripe boundary, per constraints):**
   `PaymentProvider` gains `getAuth(authId)` (retrieve status + client
   secret) and `updateAuthAmount(authId, amountCents)`; `PaymentAuth.status`
   gains `"processing"` (Stripe's processing state was previously folded into
   `requires_action`, which cannot express the return page's three-way
   outcome). Implemented in BOTH providers.
5. **Fake-provider parity.** `FakePaymentProvider` gains an opt-in
   `requiresClientConfirmation` mode (authorize → `requires_action` +
   client secret, like Stripe) plus `simulateClientConfirmation(authId,
"success" | "processing" | "failure")` so core tests exercise the full
   intent → confirm → webhook/re-check flow with zero live calls. Default
   options are UNCHANGED (instant authorize), so the credential-less dev
   funnel and every existing test behave exactly as today.
6. **`payments.status` honesty.** A Stripe intent awaiting client
   confirmation was recorded as `failed` (pre-existing mapping flagged in
   run 1, Phase 4). Additive enum value `pending` (migration 0010, local
   stack only) now records awaiting-confirmation rows;
   `cancelBookingWithRefund` voids `pending` intents the same way it voids
   `authorized` ones.
7. **Return page = route handler.** `/book/return` (GET, nodejs) reads the
   intent through the seam via core's new `reconcileBookingPayment`
   (ownership-checked, matrix-only advance, webhook-race-safe) and
   redirects: authorized → clear draft + `/book/confirmed`; processing →
   `/book/processing` (pending copy + re-check affordance); not completed /
   failed → `/book/pay?payment=failed` with the draft intact. A route
   handler rather than a page because clearing the draft cookie is only
   legal there. Client success signals are never trusted — Stripe's
   `redirect_status` query param is deliberately ignored.
8. **Contact phone (email-only customers).** Collected inside the checkout
   card and saved via a `setBookingContactPhone` core service (ownership +
   draft-status guarded) BEFORE `stripe.confirmPayment` runs; the fake path
   keeps the existing form field. Controlled client inputs preserve values on
   failure (the `usePreservedFormValues` semantics, natively).
9. **Residual race, documented:** two truly concurrent `preparePayment`
   calls could still double-create (client guards with a ref; the
   fingerprint fallback reuses on the next visit). The stranded booking is
   the same pre-acknowledged recoverable state as a crash between commit and
   authorize (see `create-booking.ts` header) — consolidated TODO #6 (slot
   capacity) already tracks the class.

**Timestamp (Phase 1 complete):** 2026-08-09 ~12:50 (local)

### What was built

Server side:

- `packages/core/src/services/payment-intent.ts` (new):
  `ensureBookingPaymentIntent` (create-or-reuse, one intent per draft;
  amount-drift → `updateAuthAmount` through the seam; structural drift →
  matrix-cancel + seat release + intent void via the existing
  `cancelBookingWithRefund`, then a fresh booking + intent),
  `reconcileBookingPayment` (the return path's server-side re-check —
  ownership-guarded, matrix-only `authorize_payment`, webhook-race-safe),
  `setBookingContactPhone` (guarded single-statement update).
- Seam: `PaymentProvider.getAuth` + `updateAuthAmount`;
  `PaymentAuth.status` gains `"processing"` (both providers implement).
- `FakePaymentProvider`: opt-in `requiresClientConfirmation` parity mode +
  `simulateClientConfirmation(authId, success|processing|failure)`; capture
  refused pre-confirmation; `updateAuthAmount` legal only pre-confirmation.
  Defaults unchanged — dev funnel and existing tests identical.
- `createBooking`: a requires_action/processing authorization now records
  the payments row as `pending` (was dishonestly `failed` — pre-existing,
  flagged in run 1 Phase 4). Additive migration
  `0010_shallow_wild_child.sql`: `ALTER TYPE payment_status ADD VALUE
'pending'` (single additive statement, no lock risk; applied to the LOCAL
  stack only, via the integration harness's standard `migrate()` bootstrap —
  the migration CLI itself was not run, see judgment calls).
- `cancelBookingWithRefund` also voids `pending` intents (same rail as
  `authorized`).
- Factory: the shared dev `FakePaymentProvider` now mints process-unique ids
  (found live in E2E: a restarted dev server re-minted `auth_000001`,
  colliding with a historical row's `(provider, provider_ref)` unique key so
  the payments insert silently no-op'd — dev-only, Stripe ids are globally
  unique).

Client / web:

- `stripe-checkout.tsx` rewritten: mounts on `preparePayment`'s client
  secret; loading skeleton; inline errors (never overclaiming — "you have
  not been charged"); contact-phone field for email-only customers saved
  server-side BEFORE `stripe.confirmPayment`; controlled inputs preserve
  values on failure; strict-mode-safe single prepare call per mount.
- `apps/web/src/app/book/pay/actions.ts` (new): `preparePayment` (invoked by
  the client after mount, never on GET render; only client secret + amount
  cross the wire), `saveCheckoutContactPhone`.
- `apps/web/src/lib/checkout.ts` (new): the payment gate's shared setup
  (customer row, ticket-upload attach, address, booking input) used by BOTH
  `confirmBooking` (fake path, behavior unchanged) and `preparePayment` —
  the two paths can no longer drift.
- `/book/return` (new GET route handler, nodejs): reconciles through core,
  ignores Stripe's `redirect_status`, then authorized → clears draft
  (cookie + server row) → confirmed; processing → `/book/processing`;
  not_completed/failed → `/book/pay?payment=…` with the draft intact.
- `/book/processing` (new page): pending copy + "Check again" (re-runs the
  return route's re-check).
- Pay page: three honest configurations — ready (Payment Element) / fake
  (unchanged dev form) / NEW misconfigured card (secret key without
  publishable key previously pretended to be a working fake setup);
  failed/incomplete return banner.

### Files created/modified (Phase 1)

New: `packages/core/src/services/payment-intent.ts`,
`packages/core/src/services/payment-intent.integration.test.ts`,
`packages/db/drizzle/0010_shallow_wild_child.sql`,
`apps/web/src/app/book/pay/actions.ts`, `apps/web/src/app/book/return/route.ts`,
`apps/web/src/app/book/processing/page.tsx`, `apps/web/src/lib/checkout.ts`.

Modified: `packages/core/src/payments/{types,fake,factory}.ts`,
`packages/core/src/payments/stripe/provider.ts`,
`packages/core/src/payments/{fake,stripe/provider}.test.ts`,
`packages/core/src/services/{create-booking,payment-lifecycle,index}.ts`,
`packages/db/src/schema/enums.ts`, `apps/web/src/components/stripe-checkout.tsx`,
`apps/web/src/app/book/{actions.ts,pay/page.tsx}`,
`apps/web/src/lib/{booking-draft.ts,core.ts}`.

### New tests

- Fake provider parity (8 unit): requires_action + secret, getAuth state
  reporting, success/processing/failure confirmation, capture refused
  pre-confirmation, amount update legality, cancel-void, default-mode
  unchanged.
- Stripe provider (4 unit, injected mock client — no network): getAuth
  status mapping (incl. processing), updateAuthAmount SDK call shape,
  PaymentFailedError wrapping.
- `payment-intent.integration.test.ts` (13, local stack, Stripe-parity fake):
  one-intent-per-draft (cookie reuse AND lost-cookie fingerprint fallback);
  amount from the pricing engine to the cent; payments row honestly
  `pending`; promo amount-drift updates the SAME intent + booking price;
  structural change cancels stale draft (seat released, intent voided,
  payments row cancelled) and re-mints; webhook-raced revisit →
  already_authorized; instant-auth dev default; authorized WEBHOOK advances
  the deferred-confirmation booking (extends the existing pin); FAILED
  confirmation cannot reach paid (webhook + re-check both); re-check
  authorized/processing/failed outcomes incl. idempotent refresh (exactly
  one `booking.payment_authorized` custody event, metadata
  `source: return_page_recheck`) and webhook-race dedup; ownership 404;
  contact-phone attach guards.
- The one test failure during development was REAL: the first
  implementation lost the fingerprint verdict and reused a structurally
  stale draft; the structural-change test caught it and the fix
  (mismatch → skip reuse entirely) is what shipped.

### Verification (Phase 1 gate)

| Command                                       | Result                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint`                                   | PASS (6/6)                                                                                                                                                                                                                                                                                                                                                                            |
| `pnpm typecheck`                              | PASS (6/6)                                                                                                                                                                                                                                                                                                                                                                            |
| `pnpm test`                                   | PASS — core 272, web 43                                                                                                                                                                                                                                                                                                                                                               |
| `pnpm --filter @koolee/core test:integration` | PASS — 68/68 (12 files; 55 baseline + 13 new)                                                                                                                                                                                                                                                                                                                                         |
| `pnpm build`                                  | PASS (web, agent, admin)                                                                                                                                                                                                                                                                                                                                                              |
| Browser E2E — fake provider                   | PASS — full funnel on :3000 with Stripe env blanked: ZIP → flight → saved-address one-tap → bags → slot → price ($53.00) → pay (unchanged dev form + contact phone) → confirmed; trip page: status Booked, custody trail created + payment_authorized, payment summary "$53.00 usd · authorized · fake" (the summary exposed the id-collision bug; re-verified after the factory fix) |
| Browser E2E — REAL Stripe test keys (4242)    | PASS — Payment Element mounted against the server-created intent ($53.00 from the engine, displayed server-side); card 4242 → `stripe.confirmPayment` → redirect to `/book/return` → server-side re-check 303 → confirmed; trip: Booked, "$53.00 usd · authorized · stripe", custody event from the re-check (no client signal trusted)                                               |
| Browser E2E — REAL Stripe test keys (3DS)     | PASS — card 4000 0025 0000 3155 → 3D Secure 2 test challenge ("KOOLEE SANDBOX") → COMPLETE → return route re-check → confirmed; trip: Booked, authorized · stripe                                                                                                                                                                                                                     |

No `stripe listen` was running and no webhook secret is configured, so both
real-key passes prove the RETURN-PAGE re-check advancement path end to end;
the webhook path is pinned by the integration suite.

### Judgment calls / deviations (Phase 1)

- **Migration application:** the sanctioned `pnpm db:migrate` (URLs pinned
  local) was BLOCKED by the session's permission layer (TD's global rule:
  no migration CLIs from the terminal). The integration harness has always
  applied pending migrations itself (`migrate()` in every suite's
  `beforeAll`, local test DB), which is how 0010 landed locally — no rule
  was worked around; the CLI was simply never run. **Hosted still needs
  0004–0010 applied manually at promotion time.**
- **Dev server on :3000** (PID 43985, running since 01:20, this repo's
  shared dev instance) was stopped for the fake-provider E2E (Next 16
  allows one dev server per app dir) and RESTORED afterwards: a normal
  `next dev -p 3000` with unmodified `.env.local` is running again.
- Stripe's Payment Element includes a visually-hidden "I am an AI agent
  acting on behalf of someone else" disclosure checkbox (rendered
  off-screen at -9306,-9256 — not interactable, not visible to human users
  either). It could not be checked; noting for transparency that the E2E
  purchases were agent-driven test-mode transactions on the sandbox account.
- `preparePayment` refuses to run unless BOTH Stripe keys are present, so
  the fake runtime cannot be driven into the intent flow from the browser
  (it keeps its own form; core-level flow is covered by tests).
- Amounts: the browser only ever receives `amountCents` computed
  server-side; nothing client-side computes or adjusts money.

---

## Phase 2 — Deploy-readiness code items

**Timestamp:** 2026-08-09 ~13:10 (local)

### 1. README env sync

- Intro now states all three apps' production boot exceptions (web's existing
  `assertProductionSecurityConfig`, plus the two new gates below).
- Corrected rows: `ANTHROPIC_API_KEY` (was "out of scope" — superseded by run
  1's extraction work; now documents the Claude/heuristic switch),
  `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (documents the new loud-misconfig
  refusal when the secret key is set without it), `STRIPE_WEBHOOK_SECRET`
  (notes the return-page re-check keeps local bookings advancing without it).
- New row: `NEXT_PUBLIC_AGENT_APP_URL` (admin; verified the code default is
  `http://localhost:3001`).
- NEW "Runtime env, per app" matrix: every variable × web/agent/admin with
  read/never-read markers and **prod** flags for exactly what each app's boot
  assertion demands. The agent column pins that `SUPABASE_SERVICE_ROLE_KEY`
  must never be set there (least privilege, from run 1).

### 2. `.env.example` sync (all three apps)

- **web**: `ANTHROPIC_API_KEY` comment corrected; Stripe section documents
  both-keys requirement, the misconfigured refusal, and webhook-secret
  optionality in local dev (placeholder values only, no secrets).
- **agent**: Supabase section documents the production boot refusal.
- **admin**: gained the missing `NEXT_PUBLIC_AGENT_APP_URL` entry (it was in
  `env.ts` but absent from the example file) + production boot refusal notes
  on the Supabase section.

### 3. Boot assertions — agent + admin

Neither app failed loud before: every var was optional in every environment,
so a production deploy missing its Supabase config silently rendered an
unusable login screen. Added, per the prompt's spec and web's `isProd`
convention:

- `apps/agent/src/env.ts` — `assertProductionBootConfig()`: Supabase URL +
  anon key.
- `apps/admin/src/env.ts` — same, plus `SUPABASE_SERVICE_ROLE_KEY` and
  `NEXT_PUBLIC_AGENT_APP_URL`.
- Both run at import on any production SERVER boot, with `next build`
  (`NEXT_PHASE=phase-production-build`) exempt so the fresh-clone
  zero-credential build contract holds — **proven empirically**: both apps
  were built with the gated vars explicitly blanked and the builds passed,
  while the env tests pin that a production import with `NEXT_PHASE` unset
  throws naming every missing variable.
- Test infrastructure added to both apps (vitest + config + `test` script —
  they had none), with `env.test.ts` modeled on `apps/web/src/env.test.ts`:
  agent 6 tests, admin 7 tests (complete config boots; each missing var
  throws by name; multiple missing vars all named; build phase exempt; dev
  exempt).

### 4. Webhook route deploy pins

`/api/webhooks/stripe` already declared `runtime = "nodejs"` and read the raw
body via `request.text()` (run 1, Phase 5) — but nothing pinned it, and a
silent regression to the Vercel edge default or a parsed body would break
signature verification. New `route.test.ts` asserts: `runtime === "nodejs"`,
`dynamic === "force-dynamic"`, POST-only surface, and the raw-body read
(`await request.text()` present, `await request.json()` absent) at source
level.

### 5. Not touched (per instructions)

Vercel config, hosted Supabase, DNS, deployment runbook — TD's manual steps.

### Files created/modified (Phase 2)

New: `apps/agent/src/env.test.ts`, `apps/agent/vitest.config.ts`,
`apps/admin/src/env.test.ts`, `apps/admin/vitest.config.ts`,
`apps/web/src/app/api/webhooks/stripe/route.test.ts`.

Modified: `README.md`, `apps/web/.env.example`, `apps/agent/.env.example`,
`apps/admin/.env.example`, `apps/agent/src/env.ts`, `apps/agent/package.json`,
`apps/admin/src/env.ts`, `apps/admin/package.json`, `pnpm-lock.yaml`
(vitest dev-dep links), `PROJECT-STATUS.md` (#33, #34, timeline).

### Verification (Phase 2 gate)

| Command                                       | Result                                                                         |
| --------------------------------------------- | ------------------------------------------------------------------------------ |
| `pnpm lint`                                   | PASS (6/6)                                                                     |
| `pnpm typecheck`                              | PASS (6/6)                                                                     |
| `pnpm test`                                   | PASS — core 272, web 46, agent 6, admin 7 (agent + admin suites are NEW)       |
| `pnpm --filter @koolee/core test:integration` | PASS — 68/68 (12 files)                                                        |
| `pnpm build`                                  | PASS (web, agent, admin)                                                       |
| Zero-credential build proof                   | PASS — agent and admin each built with their gated env vars explicitly blanked |

---

# Run summary

**Working tree:** still `feat/overnight-run-1` — run 1 was NOT committed when
this run started (precondition deviation, documented at the top); run 2's
files are enumerated per phase above and the pre-run `git status` snapshot
(131 entries) separates the two if needed. No git commands were run.

| Phase | What shipped                                                                                                                                                                                                                                                                              | Gate                                             |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| 1     | Real Stripe checkout: Payment Element mounted, one intent per funnel draft (reuse + amount-update + cancel/recreate through the seam), return-page server-side status re-check, processing/failed rails, fake-provider parity mode, `pending` payment status (migration 0010, local only) | green + 3 browser E2E passes (fake / 4242 / 3DS) |
| 2     | Deploy readiness: README per-app env matrix, `.env.example` ×3 sync, agent+admin production boot assertions (+ new test suites), webhook deploy pins                                                                                                                                      | green                                            |

## Test growth

- Integration (core): **55 → 68** (11 → 12 files).
- Unit: core 245 → 272 (payments seam + parity mode), web 43 → 46 (webhook
  pins), agent 0 → 6, admin 0 → 7 (both apps gained vitest).
- Migration added: `0010_shallow_wild_child.sql` (additive enum value
  `payment_status.'pending'`) — LOCAL stack only.

## What TD must do to activate real card payments locally

Nothing — it already works. `apps/web/.env.local` carries test-mode
`STRIPE_SECRET_KEY` + `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, and both real-key
E2E passes ran against them through the return-page re-check. Optional:

1. **Webhook path** (parallel rail to the re-check):
   `stripe listen --forward-to localhost:3000/api/webhooks/stripe`, then set
   the printed `whsec_…` as `STRIPE_WEBHOOK_SECRET` in `apps/web/.env.local`
   and restart dev. Without it the webhook route (correctly) rejects
   everything and the return page carries the flow.
2. **At deploy time**: create the production webhook endpoint in the Stripe
   dashboard (events: `payment_intent.amount_capturable_updated`,
   `payment_intent.succeeded`, `payment_intent.canceled`,
   `payment_intent.payment_failed`, `charge.captured`, `charge.refunded`,
   `refund.created`) and set its signing secret; set both Stripe keys +
   `NEXT_PUBLIC_APP_URL` (return URLs are origin-relative to the browser, so
   no code change).
3. **Hosted Supabase**: migrations `0004`–`0010` have been applied ONLY to
   the local stack (`0010` is this run's). Apply to hosted via the direct
   URL at promotion time.
4. Review + commit: suggested message below.

## Notes for review

- The session's permission layer blocked `pnpm db:migrate` even with pinned
  local URLs (TD's global no-DB-CLI rule); migration 0010 reached the local
  stack through the integration harness's own `migrate()` bootstrap — the
  standard path every suite already uses. Nothing was applied anywhere else.
- The shared dev server on :3000 was restarted during E2E and is running
  again with the unmodified `.env.local` (same command, same port).
- Two Stripe test-mode PaymentIntents were authorized (never captured) on the
  sandbox account by the E2E: `pi_3U2Zk0…` (4242) and `pi_3U2ZsM…` (3DS),
  $53.00 each, plus the bookings visible at `/trips` for the local
  `admin@koolee.local` session. Stripe's Payment Element ships a
  visually-hidden (off-screen, non-interactable) "I am an AI agent"
  disclosure checkbox that could not be checked; recording here instead that
  both purchases were agent-driven.

## Suggested commit message (run 2 delta)

```
feat: real Stripe checkout (Payment Element) + deploy-readiness

- mount Stripe Payment Element; one PaymentIntent per funnel draft
  (reuse by stored ref, amount drift via paymentIntents.update, structural
  drift = matrix cancel + seat release + void, then recreate)
- /book/return: server-side status re-check through the PaymentProvider
  seam (webhook-race-safe); /book/processing pending page; retry rails
  keep the draft intact
- seam: getAuth + updateAuthAmount + "processing" status; fake provider
  gains Stripe-parity client-confirmation mode for tests
- payments.status gains 'pending' (migration 0010, additive) — awaiting
  client confirmation is no longer recorded as 'failed'
- agent + admin production boot assertions (+ first vitest suites for both)
- README per-app env matrix; .env.example sync ×3; webhook deploy pins
  (nodejs runtime + raw body) asserted in tests
- integration suite 55 → 68; E2E: fake provider, 4242, and 3DS test card
```
