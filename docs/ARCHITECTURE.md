# Architecture

> **The system shape, the boundaries that hold it together, and where any given
> change belongs.** Baseline: `dev` @ `2fe3a2b`.
>
> Related: [FEATURES](features/) — end-to-end feature walkthroughs ·
> [ENVIRONMENT.md](ENVIRONMENT.md) · [MIGRATIONS.md](MIGRATIONS.md) ·
> [SCRIPTS.md](SCRIPTS.md) · [CODEBASE-MAP.md](CODEBASE-MAP.md) ·
> [learning/](learning/) — the teaching track

---

## 1. The shape

A pnpm + Turborepo monorepo: **three Next.js apps over two shared packages**,
plus a UI kit and a config package.

```
apps/web      customer   :3000   marketing site + booking funnel + account area
apps/agent    field PWA  :3001   task list, verification visit, bag sealing
apps/admin    ops        :3002   dispatch, exceptions, blackouts, staff, zones

packages/core     ALL domain logic. No Next.js, no env reads, no framework.
packages/db       Drizzle schema, migrations, seed, two connection factories.
packages/ui       Shared components + the Tag-K brand primitives.
packages/config   Shared eslint / tsconfig / tailwind bases.
```

The three apps are **three phases of one booking lifecycle**, not three
audiences that happen to share a database:

| App     | Owns lifecycle phase                                |
| ------- | --------------------------------------------------- |
| `web`   | `draft` → `paid`                                    |
| `agent` | `agent_assigned` → `verified_sealed` → `in_transit` |
| `admin` | assignment, exceptions, force-complete              |

---

## 2. The two boundaries that matter

Everything else in this document is detail. These two rules are the
architecture.

### 2.1 — Apps may not import `@koolee/db`

Enforced by the app ESLint config. Every read and write goes through a
`@koolee/core` service.

Row types are re-exported from
[core's index](../packages/core/src/index.ts) so an app can _name_ a `Booking`
without being able to _query_ one.

**Why this is not ceremony:** it is what makes three apps share one set of
rules. The cutoff maths, the state machine, and the ownership checks live in one
place, and no app can route around them by writing its own SQL.

### 2.2 — `packages/core` reads no environment and imports no framework

No `process.env`, no Next.js. Apps resolve their own credentials in a
zod-validated `env.ts` and hand the results to core as a `CoreConfig`
([config.ts](../packages/core/src/config.ts)).

**Why:** it makes core testable without a process environment, and reusable from
a job runner. It is also why the fail-closed boot gates live in each app's
`env.ts` rather than in core — see
[ENVIRONMENT.md §4](ENVIRONMENT.md#4-fail-closed-boot-gates).

🧭 **Where a feature lands.** A typical change touches three layers in this
order: schema (`packages/db/src/schema/`) → rule + service
(`packages/core/src/`) → a page and a server action in one app.
**If a change needs no core edit, it is usually presentation. If it needs no app
edit, it is usually policy.**

---

## 3. `packages/core` — the domain

The largest and most important package. Everything here is framework-free and
directly unit-testable.

| Directory        | Holds                                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------------- |
| `booking/`       | **`state-machine.ts`** — the 10×11 status/event matrix. The single authority on legal transitions |
| `slots/`         | `cutoff.ts` (airline bag-drop deadlines), `windows.ts` (the 24 virtual pickup windows)            |
| `pricing/`       | `engine.ts` — base + bags + distance + lead-time multiplier − discounts, in integer cents         |
| `services/`      | The app-facing API. One file per concern; everything an app calls lives here                      |
| `auth/`          | OTP throttle, claim reconciliation, upgrade guard, role requirements                              |
| `payments/`      | Provider seam: `fake.ts` and `stripe/`, chosen by `factory.ts`                                    |
| `notifications/` | `NotificationDispatcher` seam — interfaces + console fallback                                     |
| `jobs/`          | Inngest function definitions                                                                      |
| `extraction/`    | Ticket-PDF parsing: `heuristic/`, `claude/`, `fake.ts` behind `factory.ts`                        |
| `coverage/`      | NYC ZIP service area                                                                              |

### 3.1 — The seam pattern

`payments`, `notifications`, and `extraction` all follow the same shape: a
`types.ts` interface, a `fake.ts` implementation, a real implementation, and a
`factory.ts` that picks based on config. **Absent credentials select the fake
rather than failing** — this is why the funnel works end-to-end on a fresh
clone with no Stripe account, using `FakePaymentProvider`.

---

## 4. `packages/db` — data access

Owns **all** database access. Schema is one file per cluster in
`src/schema/`; migrations are Drizzle SQL in `drizzle/`.

**Two connection factories, and using the wrong one causes production-only
failures:**

| Purpose         | Env var               | Port | Factory                                             |
| --------------- | --------------------- | ---- | --------------------------------------------------- |
| App runtime     | `DATABASE_URL`        | 6543 | `createDb()` / `getDb()` — pooler, `prepare: false` |
| Migrations, DDL | `DIRECT_DATABASE_URL` | 5432 | `createMigrationClient()` — `max: 1`                |

Full reasoning in [MIGRATIONS.md §3](MIGRATIONS.md#3-the-two-connection-rule).

### 4.1 — Authorization is in core, not the database

**Drizzle on the direct connection bypasses RLS.** RLS exists here for exactly
one reason: to constrain the `anon` and `authenticated` roles that browser-side
`supabase-js` uses for **Realtime and Storage**.

A missing RLS policy is _not_ a security hole in a server-side path. Adding an
authorization check means adding it to a core service — adding a policy instead
will silently do nothing for server reads.
See [MIGRATIONS.md §6](MIGRATIONS.md#6-the-authorization-model--read-before-adding-an-rls-policy).

### 4.2 — `custody_events` is append-only

Enforced twice: a database trigger raising on `UPDATE`/`DELETE`/`TRUNCATE`, and
a data-access layer that exposes no update or delete helper. Corrections append
a compensating event.

This is the chain-of-custody record — what Koolee answers a customer with when a
bag goes missing — so it must not be rewritable.

---

## 5. Request flow

The apps are Next.js App Router, server-components-first. The dominant pattern
is **server component reads, server action writes**:

```
Browser
  │
  ├─ GET  → Server Component ──→ @koolee/core service ──→ @koolee/db (Drizzle) ──→ Postgres
  │                                     │
  │                                     └─→ state machine / pricing / cutoff rules
  │
  └─ POST → Server Action ─────→ @koolee/core service ──→ transition + custody event
                                        │
                                        └─→ payment provider / notifier seam
```

Two paths deliberately bypass this:

- **Browser `supabase-js`** for Realtime (live custody timeline) and Storage
  (bag-photo upload). This is the _only_ path RLS governs.
- **Webhooks and job routes** (`/api/webhooks/stripe`, `/api/jobs/*`,
  `/api/inngest`) enter as route handlers, not pages.

### 5.1 — The pinned webhook route

`/api/webhooks/stripe` runs the **nodejs** runtime and reads the **raw body** —
signature verification needs both. Both pins are asserted in a test so a
refactor cannot quietly break them.

---

## 6. External services

| Service                    | Used for                                                                     | Absent →                         |
| -------------------------- | ---------------------------------------------------------------------------- | -------------------------------- |
| **Supabase Postgres**      | All persistence, via Drizzle                                                 | Pages render empty states        |
| **Supabase Auth (GoTrue)** | Customer phone/email OTP; staff email/password                               | Sign-in unavailable              |
| **Supabase Realtime**      | Live custody timeline                                                        | Falls back to server-side fetch  |
| **Supabase Storage**       | Private `bag-photos` bucket                                                  | Photo capture stays local        |
| **Stripe**                 | Payment intents, capture, refunds, webhooks                                  | `FakePaymentProvider`            |
| **Inngest**                | Background jobs / crons                                                      | Works against `pnpm dev:inngest` |
| **Twilio Verify**          | OTP SMS delivery — **via Supabase, credentials dashboard-only**              | Supabase-side config             |
| **Cloudflare Turnstile**   | Bot protection — token forwarded to Supabase, **app never calls siteverify** | CAPTCHA silently off             |
| **Resend**                 | Transactional email                                                          | Notifier logs to console         |
| **FlightAware AeroAPI**    | Flight lookup                                                                | **Stubbed**                      |
| **Google Maps**            | Drive time / ETA                                                             | Fixed estimate                   |
| **Anthropic**              | Ticket-PDF extraction                                                        | Heuristic/fake extractor         |
| **Sentry**                 | Error reporting                                                              | Logs to console                  |

🧭 Note how many of these are still **stubbed or seam-only**: AeroAPI, Maps,
custody-event SMS. The seams exist and are typed; the integrations do not. That
is the honest state of the system, tracked in
[PROJECT-STATUS.md](../PROJECT-STATUS.md).

---

## 7. Folder tour

```
koolee/
├── apps/
│   ├── web/
│   │   ├── src/app/
│   │   │   ├── (marketing)/        home, pricing, how-it-works, faq, airports,
│   │   │   │                       about, terms, privacy, waitlist
│   │   │   ├── book/               the funnel — flight, pickup, slot, pay,
│   │   │   │                       verify, processing, confirmed, return
│   │   │   ├── trips/              customer's bookings + detail
│   │   │   ├── dashboard/          profile, saved addresses
│   │   │   ├── login/              customer phone/email OTP entry
│   │   │   └── api/                inngest, jobs/*, webhooks/stripe,
│   │   │                           ticket-uploads, auth/callback
│   │   ├── src/components/         funnel step forms, stepper, custody timeline,
│   │   │                           stripe checkout, cutoff countdown
│   │   ├── src/lib/                booking-draft, booking-steps, checkout,
│   │   │                           core wiring, phone, auth
│   │   ├── src/env.ts              zod env + production security gate
│   │   └── docs/                   setup-auth, pre-launch-security,
│   │                               payments-lifecycle, ticket-extraction
│   ├── agent/
│   │   ├── src/app/                tasks/, tasks/[taskId], scan, login,
│   │   │                           set-password, offline
│   │   └── docs/verification-visit.md
│   └── admin/
│       ├── src/app/                bookings/, bookings/[id], blocks,
│       │                           exceptions, staff, zones, login
│       └── docs/                   ops-console, staff-auth
│
├── packages/
│   ├── core/    booking/ slots/ pricing/ services/ auth/ payments/
│   │            notifications/ jobs/ extraction/ coverage/ test-utils/
│   ├── db/      src/schema/ (21 files) · drizzle/ (26 migrations)
│   │            src/{client,migrate,status,seed,seed-local,custody}.ts
│   ├── ui/      src/components/ · src/lib/ · fonts.ts · DESIGN.md · Storybook
│   └── config/  eslint / tsconfig / tailwind bases
│
├── docs/        ARCHITECTURE · ENVIRONMENT · MIGRATIONS · SCRIPTS ·
│                CODEBASE-MAP · TIME · features/ · learning/ · run-reports/
├── scripts/     local.sh (dev orchestrator) · test-env.sh (local stack)
├── supabase/    config.toml — the LOCAL CLI stack only
└── brand/       BRAND.md — Tag-K
```

⚠️ `supabase/migrations` is **not** Koolee's migration source. The Drizzle files
in `packages/db/drizzle` are.

---

## 8. Cross-cutting invariants

Things that are true everywhere, and expensive to violate:

1. **The state machine is the only authority on transitions.** Postgres
   guarantees only the _set_ of status values.
2. **`custody_events` is append-only.** Every correction is a forward move.
3. **All instants are `timestamptz`.** Koolee reasons across DST boundaries; a
   naive timestamp anywhere is a bug. See [TIME.md](TIME.md).
4. **Money is integer cents.** No floats in pricing.
5. **Pickup windows are computed, never stored as inventory.** No capacity
   exists to decrement.
6. **Order bags by `ordinal`**, never array position or `created_at`.
7. **`apps/agent` holds no service-role key.** A shared, frequently-lost field
   device must not carry one.
8. **Missing credentials degrade to a documented fallback**, except where a
   boot gate fires.

---

## 9. Deployment

Three Next apps deploy independently; **two Supabase projects** (prod and dev,
since 2026-08-23); one Stripe account. Each app validates its own env at boot.

`apps/web` is one Vercel project where the branch picks the environment: `main`
→ Production scope → `koolee.cloud` → the prod project; every other branch →
Preview scope → the dev project, with `dev` pinned to `dev.koolee.cloud`.
Details: [ENVIRONMENT.md §6.5–6.6](ENVIRONMENT.md).

**Production boot assertions fail closed.** A missing secret stops the app
rather than silently disabling a protection. The `next build` phase is exempt so
a fresh clone still builds.
Details: [ENVIRONMENT.md §4](ENVIRONMENT.md#4-fail-closed-boot-gates).

**Deploy order:**

1. `pnpm db:status` against the target — **read the `Target host:` line**.
2. Apply migrations over the **direct** connection.
3. `pnpm seed` if the project is new (airports, cutoffs, pricing rule).
4. Set per-app env, including the Stripe webhook secret.
5. Point the Stripe webhook endpoint at the deployed web app.
6. Verify the boot assertions pass — a failed assertion is the _intended_
   outcome of a missing secret, not a bug to work around.

Open pre-launch items:
[pre-launch-security.md](../apps/web/docs/pre-launch-security.md) and
[PROJECT-STATUS.md](../PROJECT-STATUS.md).
