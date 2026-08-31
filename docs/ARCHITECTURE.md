# Architecture

> **The system shape, the boundaries that hold it together, and where any given
> change belongs.** Baseline: `dev` @ `5db21a4`.
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
                                 + live trip tracking
apps/agent    field PWA  :3001   the day as a route — verify & seal at the door,
                                 then collect & deliver to the bag drop
apps/admin    ops        :3002   dispatch, shifts, exceptions + the configuration
                                 surface (pricing, cutoffs, blocks, zones,
                                 agreements, trucks, staff)

packages/core     ALL domain logic. No Next.js, no env reads, no framework.
packages/db       Drizzle schema, migrations, seed, two connection factories.
packages/ui       Shared components + the Tag-K brand primitives.
packages/config   Shared eslint / tsconfig / tailwind bases.
```

The three apps are **three phases of one booking lifecycle**, not three
audiences that happen to share a database:

| App     | Owns lifecycle phase                                                            |
| ------- | ------------------------------------------------------------------------------- |
| `web`   | `draft` → `paid`, then watching: trips, live tracking, the agreement            |
| `agent` | `agent_assigned` → `verified_sealed` → `in_transit` → `delivered_to_bagdrop`   |
| `admin` | assignment, shifts, exceptions, force-complete — and everything configurable    |

⚠️ **`apps/agent` is one app doing two jobs**, and the split is in the data, not
the UI. The database has two task tables — `verification_tasks` and
`pickup_tasks` — and the app groups them **in presentation** into one "job" per
booking, because a driver does not experience two tasks, they experience one
trip to one door with two things to do there
([agent/src/lib/job.ts](../apps/agent/src/lib/job.ts)). The two rows stay
independent underneath, which is what keeps it reversible the day the two
halves go to different people.

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

| Directory        | Holds                                                                                                                                                                                                                                                      |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `booking/`       | **`state-machine.ts`** — the 10×11 status/event matrix. The single authority on legal transitions                                                                                                                                                          |
| `slots/`         | `cutoff.ts` (airline bag-drop deadlines), `windows.ts` (the 24 virtual pickup windows)                                                                                                                                                                     |
| `pricing/`       | `engine.ts` — base + bags + distance + lead-time multiplier − discounts, in integer cents                                                                                                                                                                  |
| `services/`      | The app-facing API. One file per concern; everything an app calls lives here                                                                                                                                                                               |
| `auth/`          | OTP throttle, claim reconciliation, upgrade guard, role requirements                                                                                                                                                                                       |
| `payments/`      | Provider seam: `fake.ts` and `stripe/`, chosen by `factory.ts`                                                                                                                                                                                             |
| `notifications/` | `NotificationDispatcher` seam — interfaces + console fallback                                                                                                                                                                                              |
| `jobs/`          | Inngest function definitions                                                                                                                                                                                                                               |
| `extraction/`    | Ticket-PDF parsing: `heuristic/`, `claude/`, `fake.ts` behind `factory.ts`                                                                                                                                                                                 |
| `coverage/`      | NYC ZIP service area                                                                                                                                                                                                                                       |
| `geo/`           | `coordinates.ts`, `distance.ts` (haversine), `routes.ts` (Google Routes), `places.ts` (autocomplete), behind `factory.ts`. Koolee's only source of distance and ETA                                                                                        |
| `events/`        | `EventEmitter` seam — `booking-events.ts` names every domain event; `emitter.ts` holds the noop and console arms                                                                                                                                           |
| `passport/`      | `PassportValidityChecker` seam. One arm today (`NotCheckedValidityChecker`) — manual staff review is the mechanism                                                                                                                                         |
| `waitlist/`      | Signup capture and the one "you're covered" notify, for ZIPs outside coverage                                                                                                                                                                              |
| `observability/` | `sentry.ts` — the capture seam every app funnels errors and ops alerts through                                                                                                                                                                             |
| `uploads/`       | Every storage bucket's limits and MIME types, declared once, plus the avatar upload pipeline. Imports NOTHING, so client components can read the limits — see [storage-and-avatars §1](features/storage-and-avatars.md#1-buckets-are-declared-not-created) |
| `test-utils/`    | Fixtures shared by the integration tier — airports, bookings, DB error shapes, and the row-preservation guard                                                                                                                                              |

### 3.1 — The seam pattern

`payments`, `notifications`, `extraction`, `geo`, `events` and `passport` all
follow the same shape: a `types.ts` interface, a fallback implementation, a real
implementation, and a `factory.ts` that picks based on config. **Absent
credentials select the fallback rather than failing** — this is why the funnel
works end-to-end on a fresh clone with no Stripe account
(`FakePaymentProvider`), no Google key (haversine ETAs), and no Resend key
(a console notifier).

Two properties hold across every one of them, and both are load-bearing:

1. **The factory takes a config value, never `process.env`.** §2.2 is what
   makes core testable; a factory that read the environment would quietly undo
   it. Apps resolve credentials through their own validated `env.ts` and hand
   the result to `createRuntime`.
2. **Constructing an adapter opens no connection**, so a factory is safe to
   call at module scope.

The one deliberate exception is the Inngest emitter: it needs an event key and
a client, both of which are environment, so it is built app-side and passed to
`createRuntime` as an instance rather than as a `{ kind: … }` arm.

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

Three paths deliberately bypass this:

- **Browser `supabase-js`** for Realtime and Storage. This is the _only_ path
  RLS governs, and the only reason RLS exists here at all.
  - _Realtime_ subscribes to **one** table, `booking_signals` — a doorbell, not
    a data path. The payload is never rendered: a change event only tells the
    client that something moved, and the client then refetches through the
    ordinary server path above. That is what keeps authorization in core rather
    than splitting it across an RLS policy nothing on the direct connection can
    test. See [features/realtime-signals.md](features/realtime-signals.md) and
    `useBookingSignal` in
    [packages/ui/src/lib/booking-signal.ts](../packages/ui/src/lib/booking-signal.ts).
  - _Storage_ uploads go direct to the four private buckets over the **anon**
    key in all three apps, so storage RLS is genuinely the gate.
- **Webhooks and job routes** (`/api/webhooks/stripe`, `/api/jobs/*`,
  `/api/inngest`) enter as route handlers, not pages.
- **Polled `fetch` endpoints**, where a server action would be actively wrong.
  `POST /api/driver-position` is the case that defines the rule: a 45-second
  interval ping from the driver's phone. A server action would revalidate the
  page on every one of them, re-rendering a driver's screen forty times an hour
  for a value that screen does not show
  ([agent/src/app/api/driver-position/route.ts](../apps/agent/src/app/api/driver-position/route.ts)).

### 5.1 — The pinned webhook route

`/api/webhooks/stripe` runs the **nodejs** runtime and reads the **raw body** —
signature verification needs both. Both pins are asserted in a test so a
refactor cannot quietly break them.

---

## 6. External services

| Service                    | Used for                                                                                                                                           | Absent →                         |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| **Supabase Postgres**      | All persistence, via Drizzle                                                                                                                       | Pages render empty states        |
| **Supabase Auth (GoTrue)** | Customer phone/email OTP; staff email/password                                                                                                     | Sign-in unavailable              |
| **Supabase Realtime**      | The `booking_signals` doorbell — one table, signal only, payload never rendered                                                                     | Falls back to interval polling   |
| **Supabase Storage**       | Four PRIVATE buckets — `ticket-uploads`, `bag-photos`, `passport-photos`, `avatars` — created and limited by migration 0026/0027, never at runtime | Photo capture stays local        |
| **Stripe**                 | Payment intents, capture, refunds, webhooks                                                                                                        | `FakePaymentProvider`            |
| **Inngest**                | Background jobs / crons                                                                                                                            | Works against `pnpm dev:inngest` |
| **Twilio Verify**          | OTP SMS delivery — **via Supabase, credentials dashboard-only**                                                                                    | Supabase-side config             |
| **Cloudflare Turnstile**   | Bot protection — token forwarded to Supabase, **app never calls siteverify**                                                                       | CAPTCHA silently off             |
| **Resend**                 | Transactional email                                                                                                                                | Notifier logs to console         |
| **FlightAware AeroAPI**    | Flight lookup                                                                                                                                      | **Stubbed**                      |
| **Google Places (New)**    | Address autocomplete + details, **server-side only** via `/api/places`, session-token billed                                                        | Plain text input, route 204s     |
| **Google Routes**          | Traffic-aware drive time (`computeRouteMatrix`, field-masked, 2.5s timeout)                                                                        | Haversine arithmetic             |
| **MapLibre + OpenFreeMap** | Map rendering, customer trip page. **No key, no account, no per-load billing**                                                                     | List + ETA, map says so          |
| **Anthropic**              | Ticket-PDF extraction                                                                                                                              | Heuristic/fake extractor         |
| **Sentry**                 | Error reporting                                                                                                                                    | Logs to console                  |

🧭 Note how many of these are still **stubbed or seam-only**: AeroAPI,
custody-event SMS. The seams exist and are typed; the integrations do not. That
is the honest state of the system, tracked in
[PROJECT-STATUS.md](../PROJECT-STATUS.md).

### Why Google does two of those three jobs and not the third

The split is deliberate and it is about **which key ships to a browser**.

`GOOGLE_MAPS_SERVER_KEY` is server-restricted and never enters a client bundle —
`/api/places` exists precisely so the funnel's address field can autocomplete
without one. Both Google integrations keep that property: Places is proxied
(with a per-typing-session token, so Google bills one autocomplete plus one
details call rather than one per keystroke) and Routes is called from the server
behind the `EtaEstimator` seam.

Rendering a map is the one job that CANNOT be done server-side. Google's Maps
JavaScript API is a separate SKU from those two — Dynamic Maps bills per map
load past a 10,000/month free tier — and it needs a second, referrer-restricted
key in the client bundle, which anybody can read and spend. So map rendering
goes to **MapLibre GL** over **OpenFreeMap** vector tiles: open source, no key,
no account, no rate limit, attribution added automatically. Google keeps doing
what it is genuinely better at and what we already pay for.

Swapping tile hosts later (MapTiler, Protomaps, self-hosted) is the `styleUrl`
prop on `LiveMap` — one string, not a rewrite.

---

## 7. Folder tour

```
koolee/
├── apps/
│   ├── web/                        customer app — :3000
│   │   ├── src/app/
│   │   │   ├── (marketing)/        home, pricing, how-it-works, faq, airports,
│   │   │   │                       about, terms, privacy, waitlist
│   │   │   ├── book/               the funnel — FOUR live steps (flight,
│   │   │   │                       pickup, slot, pay) + verify, processing,
│   │   │   │                       confirmed, return. zip/address/bags/price
│   │   │   │                       are retired redirect stubs
│   │   │   ├── trips/              bookings list, detail, [id]/agreement
│   │   │   ├── dashboard/          profile, saved addresses
│   │   │   ├── login/              customer phone/email OTP entry
│   │   │   └── api/                inngest, jobs/{capture-due,cleanup-anon},
│   │   │                           webhooks/stripe, ticket-uploads, places,
│   │   │                           avatars, passport-photos, push/*,
│   │   │                           observability/test-error, auth/callback
│   │   ├── src/components/         funnel step forms, stepper, custody timeline,
│   │   │                           stripe checkout, cutoff countdown, trip map,
│   │   │                           trip-driver, address autocomplete
│   │   ├── src/lib/                booking-draft, booking-steps, checkout,
│   │   │                           core wiring, phone, auth, flight-label
│   │   ├── src/env.ts              zod env + production security gate
│   │   ├── src/instrumentation*.ts Sentry init — server, edge, client
│   │   └── docs/                   setup-auth, pre-launch-security,
│   │                               payments-lifecycle, ticket-extraction
│   ├── agent/                      field PWA — :3001
│   │   ├── src/app/                page.tsx (the day), tasks/, tasks/[taskId],
│   │   │                           account, login, login/reset, set-password,
│   │   │                           offline, journey-actions, shift-actions,
│   │   │                           api/{driver-position,push/*,avatars,
│   │   │                           observability}
│   │   ├── src/components/job/     job-card, job-actions, journey-list,
│   │   │                           navigate-action
│   │   └── docs/verification-visit.md
│   └── admin/                      ops console — :3002
│       ├── src/app/                / (overview), bookings/, bookings/[id],
│       │                           shifts, exceptions, pricing, cutoffs,
│       │                           blocks, zones, agreements, trucks, staff,
│       │                           staff/[userId], login, login/reset,
│       │                           set-password
│       ├── src/components/console/ nav.ts (the IA), console-rail
│       └── docs/                   ops-console, staff-auth
│
├── packages/
│   ├── core/    booking/ slots/ pricing/ services/ auth/ payments/ geo/
│   │            notifications/ jobs/ events/ extraction/ coverage/ uploads/
│   │            passport/ waitlist/ observability/ test-utils/
│   ├── db/      src/schema/ (24 files) · drizzle/ (34 migrations)
│   │            src/{client,migrate,status,seed,seed-local,seed-guard,custody,
│   │            bootstrap-staff,create-staff,zip-centroids,coverage-zips}.ts
│   ├── ui/      src/components/ · src/lib/ · fonts.ts · styles/ · DESIGN.md ·
│   │            Storybook (:6006)
│   └── config/  eslint / tsconfig / tailwind bases
│
├── docs/        ARCHITECTURE · ENVIRONMENT · MIGRATIONS · SCRIPTS · TIME ·
│                CODEBASE-MAP · LAUNCH-CHECKLIST · features/ · runbooks/ ·
│                learning/ · launch/ · run-reports/ · fixtures/
├── scripts/     local.sh (dev orchestrator) · test-env.sh (local stack) ·
│                env-verify.mjs + env-manifest.json (the prod env pass) ·
│                check-sw-headers.mjs · clean-cache.sh
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
9. **A booking carries its own pickup address.** Read `bookings.pickup_*`;
   `pickup_address_id` is provenance that goes `NULL` when the customer deletes
   the saved address. Joining `addresses` to render a doorstep is a bug
   ([MIGRATIONS §7](MIGRATIONS.md#7-schema-conventions-worth-knowing-before-you-generate)).
10. **Realtime is a signal, never a data path.** Subscribe to `booking_signals`,
    then refetch through a core service. A rendered payload is a second
    authorization model.
11. **Every human-facing time renders in the booking's airport zone.** Not the
    viewer's, not the server's — enforced by lint. See [TIME.md](TIME.md).

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

**Migrations apply themselves.** A push to `main` or `dev` that touches
`packages/db/drizzle/**` runs
[.github/workflows/migrate.yml](../.github/workflows/migrate.yml) against that
branch's Supabase project, then asserts with `db:status` that the applied set
matches the checkout by content hash — drift fails the workflow loudly. The
manual order below is for first-time project setup and recovery.

⚠️ **The workflow runs in PARALLEL with the Vercel deploy of the same push** —
neither waits for the other. That is only safe while migrations stay backward
compatible (expand → deploy → contract), which is this repo's discipline. A
migration the *old* code cannot run against needs a manual, sequenced deploy.
See [MIGRATIONS.md §9.5](MIGRATIONS.md).

**Deploy order:**

1. `pnpm db:status` against the target — **read the `Target host:` line**.
2. Apply migrations over the **direct** connection.
3. `SEED_ALLOW_HOSTED=1 pnpm seed` if the project is **brand new** (airports,
   cutoffs, pricing rule — all placeholders). The seed refuses a non-local
   host without that variable: it overwrites verified cutoffs and tuned
   prices. On a live project, launch data is entered at the admin console.
4. Set per-app env, including the Stripe webhook secret.
5. Point the Stripe webhook endpoint at the deployed web app.
6. `pnpm env:verify --app <app> --file <env>` — the env pass. It reads NAMES,
   never values, against [scripts/env-manifest.json](../scripts/env-manifest.json),
   which is the one inventory of what each app refuses to boot without.
   See [SCRIPTS.md §8](SCRIPTS.md#8-pnpm-envverify--the-env-pass-before-deploying).
7. Verify the boot assertions pass — a failed assertion is the _intended_
   outcome of a missing secret, not a bug to work around.

Taking Koolee live is tracked step by step in
[LAUNCH-CHECKLIST.md](LAUNCH-CHECKLIST.md), with the procedures in
[runbooks/](runbooks/): [prod-bringup](runbooks/prod-bringup.md),
[stripe-live-flip](runbooks/stripe-live-flip.md),
[cutover-rehearsal](runbooks/cutover-rehearsal.md).

Open pre-launch items:
[pre-launch-security.md](../apps/web/docs/pre-launch-security.md) and
[PROJECT-STATUS.md](../PROJECT-STATUS.md).
