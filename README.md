# Koolee

Doorstep luggage pickup, delivered to your airline's bag drop. NYC — JFK, LGA, EWR.

A Turborepo monorepo: three Next.js 16 apps over a shared domain package, a
Drizzle schema, and a shadcn/ui component library.

---

## Quickstart

```bash
nvm use                 # Node 24 (see .nvmrc)
corepack enable         # pnpm 11
pnpm install

# Everything below works with NO credentials configured:
pnpm build
pnpm lint
pnpm typecheck
pnpm test
```

To actually run it against data:

```bash
# Per-app env files — Next.js reads apps/<app>/.env.local, not the repo root:
for d in apps/web apps/agent apps/admin; do cp $d/.env.example $d/.env.local; done
cp packages/db/.env.example packages/db/.env
# then set DATABASE_URL + DIRECT_DATABASE_URL in each (see Environment below)
# NOTE: since 2026-08-22 packages/db/.env defaults to the LOCAL stack, so a bare
# `pnpm db:migrate` / `pnpm seed` can never silently land on hosted. Targeting
# hosted is an explicit inline override — the shell always beats the file.
# `migrate.ts` prints `Target host:` before doing anything. Read that line.

pnpm local                     # the whole local environment, one command
pnpm dev                       # all three apps
```

`pnpm local` starts Docker Desktop if it is not running, brings up the Supabase
stack (Postgres + GoTrue) on 127.0.0.1, migrates the local database, builds the
disposable `koolee_test` DB, runs eight verify assertions, seeds, and prints a
status board with every URL and the test OTP numbers. It pins the database URL
to localhost itself, so it sidesteps the `packages/db/.env` hazard in the note
above — and it aborts if you have a non-local `DATABASE_URL` exported.

Every step is idempotent, so it is also the right command when you are not sure
what is already running:

| Command             | Does                                                              |
| ------------------- | ----------------------------------------------------------------- |
| `pnpm local`        | Everything above, then stops so you can start the apps yourself   |
| `pnpm local:dev`    | The above, then `pnpm dev`                                        |
| `pnpm local:status` | Read-only: what is running right now, including :3000/:3001/:3002 |
| `pnpm local:down`   | Stop the stack (data volumes persist)                             |
| `pnpm local:reset`  | Wipe + re-migrate the local DB, then force a reseed               |

In a second terminal, for background jobs:

```bash
pnpm dev:inngest               # Inngest dev server, discovers /api/inngest on :3000
```

Locally this needs **no credentials** — the client passes
`isDev: NODE_ENV !== "production"`, so the SDK talks to that dev server and
ignores Inngest Cloud even when keys are present. A local run therefore never
appears in the Cloud dashboard; the dev server's own UI is at
<http://localhost:8288>.

**For production, keys alone are not enough.** All five functions are served
from `apps/web`, so put `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY` in that
app's deployed environment (agent and admin need neither), then **sync the app
to `https://<web-domain>/api/inngest`** in the Inngest dashboard. Crons do not
fire until that sync happens — it is the step that gets missed. Keys are
per-environment, so staging gets its own pair.

| App          | Port | What it is                                                 |
| ------------ | ---- | ---------------------------------------------------------- |
| `apps/web`   | 3000 | Marketing site, booking flow, customer dashboard           |
| `apps/agent` | 3001 | PWA for check-in agents and drivers — ID, seal, photos, QR |
| `apps/admin` | 3002 | Ops console — bookings, exceptions, blackouts, staff       |

---

## Documentation

This file is the entry point: how to run it, and the rules that are not
obvious from the code. **Everything else lives in [docs/](docs/).**

| Read this                                            | When you want                                                                                                          |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **[docs/learning/](docs/learning/)**                 | **To learn the codebase.** Nine numbered chapters, bottom-up, written to be re-entered. **Start here if you are new.** |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)         | The system shape, the boundaries, where a change belongs                                                               |
| [docs/features/](docs/features/)                     | How a capability works end to end — funnel, auth, payments, agent visit, ops, jobs                                     |
| [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md)           | Every env var, the boot gates, secret ownership                                                                        |
| [docs/MIGRATIONS.md](docs/MIGRATIONS.md)             | Schema change, drift detection, the RLS stance                                                                         |
| [docs/SCRIPTS.md](docs/SCRIPTS.md)                   | Every command and when to reach for it                                                                                 |
| [docs/CODEBASE-MAP.md](docs/CODEBASE-MAP.md)         | The dense 13-chapter narrative reference                                                                               |
| [docs/TIME.md](docs/TIME.md)                         | Instants, timezones, DST — four rules, and the lint that enforces them                                                 |
| [docs/LAUNCH-CHECKLIST.md](docs/LAUNCH-CHECKLIST.md) | **Taking Koolee live.** The tracking instrument: what is done, what blocks a launch                                    |
| [docs/runbooks/](docs/runbooks/)                     | The procedures — prod bring-up, the Stripe live flip, the cutover rehearsal                                            |
| [PROJECT-STATUS.md](PROJECT-STATUS.md)               | What shipped, what is in flight, what is next                                                                          |

Full index, including app- and package-level docs: **[docs/README.md](docs/README.md)**.

New app docs go in `apps/<app>/docs/`, package docs in `packages/<pkg>/docs/`.
Nothing new accumulates at the repo root.

---

## Architecture

```
apps/web  apps/agent  apps/admin      ← thin adapters. No business logic.
        │        │         │
        └────────┴─────────┘
                 ▼
           packages/core               ← all domain logic. No Next.js, no env access.
                 ▼
            packages/db                ← Drizzle schema + the only DB access
                 ▼
              Postgres
```

Two boundaries are enforced by ESLint rather than convention, and both fail the
build when crossed:

- Apps may not import `@koolee/db`. Data access goes through a `@koolee/core`
  service. (Core exposes `createRuntime()` so apps never need the raw handle.)
- The Stripe SDK may only be imported inside
  `packages/core/src/payments/stripe/`. Everywhere else depends on the
  `PaymentProvider` interface. The same boundary holds for the PDF libraries
  (`extraction/heuristic/`) and the Anthropic SDK (`extraction/claude/`).

A third rule is enforced the same way: **no `toLocale*`, no bare
`Intl.DateTimeFormat`, no two-argument date-fns `format()`.** All three fall
back to the system zone — UTC in production — so the bug they cause has no
error attached to it. See [docs/TIME.md](docs/TIME.md).

### Packages

| Package           | Contents                                                                                                                      |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `packages/core`   | Booking state machine, cutoff/window logic, pricing, payments, geo/ETA, notifications, auth contracts, services, Inngest jobs |
| `packages/db`     | Drizzle schema (24 files, 29 tables), 34 migrations, pooled + direct connection factories                                     |
| `packages/ui`     | shadcn/ui components, the design tokens in `styles/theme.css`, the fonts subpath, and Storybook                               |
| `packages/config` | Shared `tsconfig`, ESLint flat config, Prettier config                                                                        |

### `packages/core` reads no environment variables

Everything is injected. Apps resolve credentials through their own
zod-validated `env.ts` and hand plain values to `createRuntime()`. That is what
makes the domain layer testable without a process environment and reusable from
a job runner.

### Boot with zero credentials

Importing a module never throws because a variable is missing. Every external
client — Stripe, Supabase, Postgres, Inngest — is constructed lazily, and a
variable only becomes required when a code path that needs it actually runs. The
error then names the variable and where to get it.

Pages that read data degrade to an empty state rather than 500ing, so a fresh
clone boots and renders. In development each app's home page shows an **Environment**
panel listing which services are configured and what the fallback is for each
that is not.

---

## The rules that are not obvious from the code

### Copy rules

Koolee **delivers bags to the airline's bag drop.** That is the whole claim, and
the copy must not exceed it.

**Say:** "delivered to your airline's bag drop."

**Never say:**

- "we check you in" — we do not; the customer checks in with their airline
- "handed to TSA" — we hand bags to the airline, not to TSA
- "loaded onto your aircraft" — the airline does that

**No fabricated statistics.** No "10,000+ customers", no invented ratings, no
made-up on-time percentages. If a number is not measured, it does not go on the
page.

These apply to marketing copy, product UI, transactional SMS and email, and
anything else a customer reads.

### `custody_events` is append-only

It is the chain-of-custody record — who had which bag, where, when, with what
photographic evidence. Enforced two ways: a database trigger that raises on
`UPDATE`, `DELETE`, and `TRUNCATE`, and a data-access layer that exposes no
update or delete helper. Corrections are made by **appending a compensating
event**.

### Authorization lives in `packages/core`, not in RLS

Server-side queries run on a service-role connection that **bypasses RLS**. RLS
is enabled on exactly two tables (`bookings`, `custody_events`) purely so a
customer's browser can subscribe to its own slice via Realtime. A missing policy
is not a security hole in a server path; a missing check in a core service is.
Full explanation in [packages/db/README.md](packages/db/README.md).

### Two database connections

Runtime queries use the Supavisor pooler in **transaction mode** (`DATABASE_URL`,
port 6543) with `prepare: false`. Migrations use the **direct** connection
(`DIRECT_DATABASE_URL`, port 5432). Mixing them produces intermittent
`prepared statement does not exist` errors in production that will not reproduce
locally. Details in [packages/db/README.md](packages/db/README.md).

### The cutoff logic is the highest-liability code here

Pickup windows are **virtual**: every flight sees the same 24 clock-aligned
one-hour windows, ending between 30 and 6 hours before departure
(`packages/core/src/slots/windows.ts`), with no capacity — what varies per
window is the price (lead-time curve on the pricing rule). The deadlines the
band is built on come from `packages/core/src/slots/cutoff.ts`:

```
latest pickup start = departure − airline cutoff − drive time − buffer
deadline            = min(that, departure − 6 h operations reserve)
```

A window is bookable only when its **end** is at or before that deadline, it
starts at least 2 hours after the moment of booking, and it overlaps no ops
blackout (`slot_blocks`, managed in the admin app). All arithmetic is on
absolute instants (`date-fns` `subMinutes`), so it is DST-correct by
construction; timezones are applied only when formatting for a human. The test
suites cover both 2025 US DST transitions explicitly.

If no cutoff is on record for an airline/airport/scope, the code **refuses to
sell** rather than guessing. A guessed cutoff is how bags miss flights.

---

## Environment

**Canonical reference: [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md)** — every
variable, which app reads it, where to obtain it, what silently breaks without
it, and the full boot-gate rules.

The three things worth knowing here:

1. **Every variable is optional at boot.** A fresh clone builds, lints,
   typechecks and tests green with no credentials. A missing credential
   degrades to a documented fallback — so **a missing secret looks like a
   working app with a protection switched off**, not like a failure.
2. **Production boot gates fail closed.** Each app asserts the config whose
   absence would silently disable a control, and refuses to start without it.
   A failed assertion is the intended outcome of a missing secret, not a bug to
   work around. `next build` is exempt.
3. **Next.js reads `apps/<app>/.env.local`, never the repo root.** Copy each
   app's own `.env.example`; the root one is reference material.

---

## Testing

**Full detail: [docs/SCRIPTS.md](docs/SCRIPTS.md)** ·
[packages/core/docs/local-test-env.md](packages/core/docs/local-test-env.md)

| Tier            | Command                                       | Needs                                  |
| --------------- | --------------------------------------------- | -------------------------------------- |
| Unit            | `pnpm test`                                   | Nothing                                |
| Integration     | `pnpm --filter @koolee/core test:integration` | Postgres via `TEST_DATABASE_URL`       |
| Auth acceptance | same, with the local stack                    | Supabase GoTrue via `pnpm test:env:up` |

Integration suites are **opt-in**: without `TEST_DATABASE_URL` they skip rather
than fail, so a fresh clone's `pnpm test` is green.

Two databases live in the local container: `postgres` (your dev data) and the
disposable `koolee_test` (the only one the suites may wipe). A marker table
makes that enforceable — the suites **refuse to run** without it, so a
mispointed `TEST_DATABASE_URL` fails closed instead of emptying your dev
database.

---

## Commands

**Full reference: [docs/SCRIPTS.md](docs/SCRIPTS.md).** The ones you need daily:

| Command                        | What it does                                                        |
| ------------------------------ | ------------------------------------------------------------------- |
| `pnpm local:dev`               | Cold start: Docker → Supabase → migrate → seed → run all three apps |
| `pnpm local:status`            | What is running right now                                           |
| `pnpm dev`                     | All three apps (3000 / 3001 / 3002)                                 |
| `pnpm test`                    | Unit tests                                                          |
| `pnpm lint` / `pnpm typecheck` | Across the workspace                                                |
| `pnpm db:generate`             | Diff the schema, write a migration (offline, no credentials)        |
| `pnpm db:status`               | Migration drift report (read-only, safe against production)         |
| `pnpm db:migrate`              | Apply migrations (direct connection)                                |

⚠️ `db:migrate`, `db:status`, `seed` and `db:studio` read `packages/db/.env`,
which points at the **hosted** project. Both `migrate` and `status` print
`Target host:` first — read that line. Use `pnpm seed:local` or override the URL
inline for local work.

---

## Background jobs

**Sixteen** Inngest functions, all served from
`apps/web/src/app/api/inngest/route.ts`. Thirteen are domain functions defined
in `packages/core/src/jobs/functions.ts` and built by `createKooleeFunctions`;
three more are defined in `apps/web/src/lib/inngest.ts`, because they need
credentials only that app holds.

Domain functions (`packages/core`) — the email and push side of every moment
that is worth telling somebody about, plus the sweeps:

| id                            | Trigger                                       |
| ----------------------------- | --------------------------------------------- |
| `booking-confirmation-email`  | `booking/confirmed`                           |
| `booking-pickup-reminder`     | `booking/confirmed`, sleeps until T−2h        |
| `agent-assigned-email`        | agent assigned                                |
| `bags-sealed-email`           | `verified_sealed` — seals + "choose a driver" |
| `driver-selected-email`       | a driver is chosen                            |
| `bagdrop-delivered-email`     | delivered to the bag drop                     |
| `exception-customer-email`    | exception raised — deliberately generic       |
| `exception-ops-alert-email`   | exception raised — the full reason            |
| `driver-pool-empty-ops-alert` | nobody could be offered                       |
| `cutoff-risk-monitor`         | cron, every 5 minutes                         |
| `agent-no-show-check`         | 15 min past the window start                  |
| `assignment-horizon-sweep`    | cron — reaches `ASSIGNMENT_HORIZON_HOURS` out |
| `waitlist-zone-opened-sweep`  | daily — the one "you're covered" email        |

App-held functions (`apps/web`, because they need Stripe or the service role):

- **Cron, every 5 minutes** → `captureDueBookings`: captures authorizations
  whose bags are already in custody. Also at `POST /api/jobs/capture-due`.
- **Cron, daily** → expires abandoned drafts and deletes orphaned anonymous
  users. Also at `POST /api/jobs/cleanup-anon`.
- **Terminal failure capture** → reports a job that has exhausted its retries,
  so a permanently dead step is not something you find out about from a missing
  email.

⚠️ Push deep links need `NEXT_PUBLIC_AGENT_APP_URL` and
`NEXT_PUBLIC_ADMIN_APP_URL`. Absent, the notification still goes — without a
link.

Both manual routes require `CRON_SECRET` and refuse to run without one.

Run `pnpm dev:inngest` alongside `pnpm dev` and the dev server discovers them
automatically.

Full detail: [docs/features/jobs-and-notifications.md](docs/features/jobs-and-notifications.md).

---

## Not built (deliberately)

Listed so nobody goes looking for it:

- **Seal technology.** RFID vs printed QR is undecided. `bags.seal_id` is an
  opaque string and no code parses it — the decision will not require a
  migration.
- **Per-bag tracking hardware.**
- **Rejected-bag and lost-bag exception flows.** The exceptions page lists
  affected bookings; resolution is manual state overrides for now.
- **AeroAPI (flight lookup).** Interface and stub only — flight details are
  typed in or read off an uploaded ticket.
- **Custody-event SMS.** The `Notifier` seam has the column; there is no
  provider behind it. Auth OTP SMS is a different thing and already works —
  Supabase Auth owns it end-to-end and its Twilio credentials live in the
  Supabase dashboard, never in app env.
- **Pickup-window capacity.** Windows deliberately accept unlimited bookings.
  Re-introducing seat limits would need both a schema and a concurrency story.
  `trucks.reserved_spaces` is editable and **enforced** — held back from booking capacity.
- **Dynamic pricing.** The lead-time curve is a configurable placeholder; the
  seam it will replace is `resolveLeadTimeMultiplier` in the pricing engine.
- **Route optimisation.** The agent's day is ordered by scheduled time, never
  by geography — a route optimiser that reorders stops to save a mile would
  break the promise the customer's window is.
- **React Native.**

Previously listed here and now **shipped**: staff auth (invite-only
agent/admin accounts), the customer session threaded through the booking flow,
ticket-PDF extraction, **Resend email** (ten templates), **Google Places and
Routes** (address autocomplete and traffic-aware ETAs, both server-side),
**map rendering** (MapLibre over OpenFreeMap — no key, no vendor), **Web
Push**, **Sentry**, the **realtime signal layer**, the driver/pickup half of
the lifecycle, and the **Vercel prod/dev split**. The Inngest functions all do
real work — sixteen of them, listed above.
