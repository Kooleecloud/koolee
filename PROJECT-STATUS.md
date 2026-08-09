# Koolee — Project Status & Feature Tracker

> **Purpose:** single place to see where the project is, what shipped, what's
> in flight, and what's next — with a spec stub per feature so nothing lives
> only in someone's head.
>
> **Convention:** update this file in the same branch as the work it
> describes. When a feature ships, move its row to *Shipped* and link the
> commit/PR. When new work is spec'd, add a row + a spec section before
> writing code. Keep detail in the linked docs; this file stays a map.

**Last updated:** 2026-08-09 · **Active branch:** `feat/auth-close-out-parts-def`

---

## 1. What Koolee is

Doorstep luggage pickup delivered to the airline's bag drop. NYC (JFK / LGA /
EWR). Turborepo monorepo: three Next.js apps (`web` customer, `agent` PWA,
`admin` ops) over `packages/core` (all domain logic) and `packages/db`
(Drizzle + Postgres/Supabase). Architecture, copy rules, env matrix:
[README.md](README.md).

## 2. Where the docs live

One living doc at the root — this file. Everything else sits next to the code
it describes:

| Doc | Scope |
|-----|-------|
| [README.md](README.md) | Repo-wide: architecture, env, testing, commands |
| [PROJECT-STATUS.md](PROJECT-STATUS.md) | This tracker — the map |
| [MIGRATION-NOTES.md](MIGRATION-NOTES.md) | Historical record of the 10-phase dependency migration |
| [apps/web/docs/setup-auth.md](apps/web/docs/setup-auth.md) | Customer auth wiring: provider ownership, CAPTCHA, OTP safety |
| [apps/web/docs/pre-launch-security.md](apps/web/docs/pre-launch-security.md) | Auth-funnel hardening items + launch checklist |
| [packages/core/docs/local-test-env.md](packages/core/docs/local-test-env.md) | Local Supabase test stack for the integration suites |
| [packages/db/README.md](packages/db/README.md) | Two-connection rule, RLS stance |
| [brand/BRAND.md](brand/BRAND.md) | Tag-K brand system |

New app-specific docs go in `apps/<app>/docs/`; package-specific docs in
`packages/<pkg>/docs/`. Nothing new accumulates at the root.

---

## 3. Snapshot — where we are right now

- **Scaffold + domain core: done.** Booking state machine (full 10×11
  status/event matrix tested), cutoff/slot logic (DST-correct, refuses to
  sell without a known airline cutoff), pricing engine, FakePaymentProvider →
  Stripe adapter, append-only `custody_events`, 3 Inngest job skeletons.
- **Marketing site + brand: done.** Public web app with Tag-K brand system;
  launch-pricing caveat is pinned copy.
- **Dependency stack: fully modernized.** Next 16 / Tailwind 4 / Stripe 22
  (dahlia pin) / Inngest 4 / zod 4 / ESLint 10 / Drizzle 0.45 / Node 24 —
  all 10 phases green ([MIGRATION-NOTES.md](MIGRATION-NOTES.md)).
- **Customer auth funnel: closed out and hardened.** Hosted Supabase
  phone/email OTP via Twilio Verify, Turnstile pass-through (secrets
  dashboard-only), anonymous drafts with cookie fallback, and the pre-send
  guard: OTP throttle + claim reconciliation in ONE transaction under
  user+destination advisory locks, explicit `AUTH_SCHEMA_AVAILABLE` flag,
  fail-closed production boot assertion. See
  [setup-auth.md](apps/web/docs/setup-auth.md).
- **Verified 2026-08-09:** all integration tiers green (22/22 — acceptance
  15/16, merged-guard overlap, OTP concurrency, Phase 7 booking-transaction
  checks), plus a Playwright end-to-end pass: a real booking placed through
  the full funnel (ZIP → … → email OTP via Mailpit → pay → confirmed → trip
  page) against the `pnpm test:env:up` stack.

---

## 4. Feature tracker

Status legend: ✅ shipped · 🔨 in flight · 📋 spec'd (ready to build) ·
💤 deferred (deliberate) · ⬜ not started

| # | Feature | Status | Where / spec |
|---|---------|--------|--------------|
| 1 | Repo scaffold, schema, seed, booking flow, agent + ops consoles | ✅ | scaffold phases 1–6 (`b177475`…`c71299d`) |
| 2 | Marketing site + brand system | ✅ | `8029a4d`; [brand/BRAND.md](brand/BRAND.md) |
| 3 | Booking state machine + cutoff/slot + pricing + coverage | ✅ | `packages/core`; tested per [README §Testing](README.md#testing) |
| 4 | Payments seam (FakeProvider + Stripe adapter, webhook verify) | ✅ | `packages/core/src/payments/` |
| 5 | Dependency migration (10 phases) | ✅ | `15288e4`, `95c1507`; [MIGRATION-NOTES.md](MIGRATION-NOTES.md) |
| 6 | Customer auth funnel (phone/email OTP, drafts, shell UI) | ✅ | `cb24a24`; [setup-auth.md](apps/web/docs/setup-auth.md) |
| 7 | Auth hardening: captcha pass-through, throttle, reconcile, PII pass | ✅ | `5876402` |
| 8 | Local test env (GoTrue-backed integration tier) | ✅ | `1924259`; [local-test-env.md](packages/core/docs/local-test-env.md) |
| 9 | Auth close-out: role-guard seam + upgrade-guard acceptance test | ✅ | `feat/auth-close-out-parts-def` (2026-08-09); acceptance 16/16 green |
| 10 | OTP throttle per-user lock (SMS-pumping vector) | ✅ | `feat/auth-close-out-parts-def` (2026-08-09): `acquireOtpSendLocks`, user → destination order; concurrency suite green |
| 11 | Throttle→reconcile in one transaction (lock-gap fix) | ✅ | `feat/auth-close-out-parts-def` (2026-08-09): `guardUpgradeOtpSend` in `packages/core/src/auth/upgrade-guard.ts` |
| 12 | Thread customer session through booking flow (replace placeholder customer) | ⬜ | verification helper exists; wiring pending |
| 13 | Real agent/admin staff auth (replace dev stubs) | ⬜ | requirements in `TODO(auth-*)`, `packages/core/src/auth/stubs.ts`; `assertRole` seam lands with #9 |
| 14 | Ticket-PDF extraction (Claude) | ⬜ | upload button present, disabled; needs a zod schema + tests (flagged in Phase 5 notes) |
| 15 | Real integrations: AeroAPI, Maps, Resend, custody/notification SMS | ⬜ | interfaces + stubs exist; `NotificationDispatcher` is the SMS seam |
| 16 | Inngest jobs: real side effects (reminder SMS, ops alerts, no-show escalation) | ⬜ | skeletons live; blocked on #15 |
| 17 | Rejected-bag / lost-bag exception flows | 💤 | manual overrides via admin exceptions page for now |
| 18 | Seal technology decision (RFID vs printed QR) | 💤 | `bags.seal_id` opaque by design — no migration needed either way |
| 19 | Vercel deploy config / launch checklist | ⬜ | repo is deploy-ready; note proxy runs nodejs runtime (Next 16 change) |
| 20 | React Native app | 💤 | out of scope |
| 21 | `assertProductionSecurityConfig()` — fail-closed boot assertion | ✅ | `feat/auth-close-out-parts-def` (2026-08-09) in `apps/web/src/env.ts` |
| 22 | Explicit `AUTH_SCHEMA_AVAILABLE` app env (replaces 42P01 sniffing) | ✅ | `feat/auth-close-out-parts-def` (2026-08-09); unknown guard errors fail closed |
| 23 | Narrowed Twilio acceptance grep | ✅ | `feat/auth-close-out-parts-def` (2026-08-09) in [setup-auth.md](apps/web/docs/setup-auth.md) |
| 24 | Launch checklist: verify Turnstile Managed mode is non-interactive on flight-review | 📋 | [pre-launch-security.md §5](apps/web/docs/pre-launch-security.md) — dashboard verification, not code |
| 25 | Launch checklist: strip/isolate `[auth.sms.test_otp]` test phone numbers from prod project | 📋 | [pre-launch-security.md §6](apps/web/docs/pre-launch-security.md) — config verification, not code |
| 26 | Run integration tiers: Phase 7 checks + acceptance 15/16 + OTP concurrency suite | ✅ | run 2026-08-09 against `pnpm test:env:up` stack — 22/22 passed (4 files) |

---

## 5. Timeline (condensed)

| When | What landed |
|------|-------------|
| scaffold | Phases 1–6: repo skeleton → schema/seed → domain logic → booking/agent/ops flows → Inngest jobs → docs/env (`b177475`…`c71299d`) |
| PR #1 `adjustments` | Public marketing site + phone-OTP customer auth entry (`8029a4d`) |
| PR #2 `chore/dependency-migrations` | Full 10-phase dependency modernization (`15288e4`) |
| 2026-08 (dev) | Auth funnel + Tag-K brand + shared UI shell (`cb24a24`); captcha-to-Supabase move, OTP throttle + reconcile (`5876402`); local test env (`1924259`) |
| 2026-08-09 | Auth hardening batch on `feat/auth-close-out-parts-def`: per-user throttle lock, merged guard transaction, `AUTH_SCHEMA_AVAILABLE`, production boot assertion, grep fix; docs restructured (root map + app/package-level docs); Playwright E2E pass: full funnel booked against the local stack (email OTP via Mailpit), slot-page raw-SQL leak fixed, local email templates now carry the 6-digit code |

---

## 6. Spec stubs for the next items

### #12 — Customer session in the booking flow
Replace the placeholder customer attached at `createBooking` time with the
verified Supabase session user; migrate any anonymous-draft bookings on
upgrade (reconciliation semantics already exist for claims — reuse the
pattern). Acceptance: booking rows carry the real `customer_id`; `/trips`
shows the booking made pre-verification.

### #13 — Staff auth (agent/admin)
Dev stubs throw outside development. Requirements enumerated in
`TODO(auth-*)` in `packages/core/src/auth/stubs.ts`. The `assertRole` seam
(#9) is the authorization primitive; remember authz lives in core, not RLS
(see [README](README.md)). Least-privilege env stance already set: agent app
holds no Stripe/messaging creds.

### #14 — Ticket-PDF extraction
Anthropic API extraction behind the existing disabled upload button. Needs:
zod schema for the review-form input (does not exist yet — Phase 5 flag),
tests for it, `ANTHROPIC_API_KEY` env wiring per the lazy-construction rule
(module import must not throw).

---

## 7. Standing constraints (do not relearn these)

- Copy rules: "delivered to your airline's bag drop" — never overclaim, no
  fabricated numbers ([README](README.md)).
- `custody_events` is append-only (trigger + no update/delete helpers);
  corrections are compensating events.
- Authorization in `packages/core`, not RLS; RLS exists only for Realtime on
  `bookings`/`custody_events`.
- Two DB connections: pooled 6543 for runtime (`prepare: false`), direct 5432
  for migrations. Never mix.
- Unknown airline cutoff ⇒ refuse to sell.
- All auth secrets (Twilio Verify, Turnstile secret) live in the Supabase
  dashboard only; the app forwards `captchaToken` and never calls siteverify.
- Upgrade sends go through ONE guard (`guardUpgradeOtpSend`): throttle +
  reconciliation in a single transaction, user lock before destination lock.
  Never split them back into separate transactions.
- `packages/core` reads no env; everything injected via `createRuntime()`.
- Never revert a migration-journal entry on an assumption about DB state —
  verify against the DB or write a corrective migration.
