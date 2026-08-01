# Koolee

Doorstep luggage pickup, delivered to your airline's bag drop. NYC — JFK, LGA, EWR.

A Turborepo monorepo: three Next.js 15 apps over a shared domain package, a
Drizzle schema, and a shadcn/ui component library.

---

## Quickstart

```bash
nvm use                 # Node 22 (see .nvmrc)
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

docker compose up -d           # Postgres 16 on host port 5433
pnpm db:migrate                # applies migrations over the DIRECT connection
pnpm seed                      # airports, airline cutoffs, a pricing rule, 3 days of slots
pnpm dev                       # all three apps
```

In a second terminal, for background jobs:

```bash
pnpm dev:inngest               # Inngest dev server, discovers /api/inngest on :3000
```

| App          | Port | What it is                                                 |
| ------------ | ---- | ---------------------------------------------------------- |
| `apps/web`   | 3000 | Marketing site, booking flow, customer dashboard           |
| `apps/agent` | 3001 | PWA for check-in agents and drivers — ID, seal, photos, QR |
| `apps/admin` | 3002 | Ops console — bookings, exceptions, manual overrides       |

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
  `PaymentProvider` interface.

### Packages

| Package           | Contents                                                                                            |
| ----------------- | --------------------------------------------------------------------------------------------------- |
| `packages/core`   | Booking state machine, cutoff/slot logic, pricing, payments, auth contracts, services, Inngest jobs |
| `packages/db`     | Drizzle schema, migrations, pooled + direct connection factories                                    |
| `packages/ui`     | shadcn/ui components and the shared Tailwind preset                                                 |
| `packages/config` | Shared `tsconfig`, ESLint flat config, Prettier config                                              |

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

`packages/core/src/slots/cutoff.ts` decides which pickup windows are sellable:

```
latest pickup start = departure − airline cutoff − drive time − buffer
```

A window is sellable only when its **end** is at or before that instant — the
pickup must be able to begin at any point in the window. All arithmetic is on
absolute instants (`date-fns` `subMinutes`), so it is DST-correct by
construction; timezones are applied only when formatting for a human. The test
suite covers both 2025 US DST transitions explicitly.

If no cutoff is on record for an airline/airport/scope, the code **refuses to
sell** rather than guessing. A guessed cutoff is how bags miss flights.

---

## Environment

Every variable is optional at boot. This table says what each one unlocks and
what happens without it.

| Variable                             | Where to get it                                                                      | Required when                                | Without it                                                                         |
| ------------------------------------ | ------------------------------------------------------------------------------------ | -------------------------------------------- | ---------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_APP_URL`                | This app's own origin — `3000` / `3001` / `3002` locally                             | Absolute links and Stripe return URLs        | Relative links only                                                                |
| `DATABASE_URL`                       | Supabase → Settings → Database → Connection pooling, **transaction mode**, port 6543 | Any page or action that reads or writes data | Pages render an empty state; mutations return a configuration error                |
| `DIRECT_DATABASE_URL`                | Supabase → Settings → Database → Direct connection, port 5432                        | `pnpm db:migrate`, `pnpm db:studio`          | Migrations fail with a named error. `pnpm db:generate` still works — it is offline |
| `NEXT_PUBLIC_SUPABASE_URL`           | Supabase → Settings → API → Project URL                                              | Browser Realtime / Storage                   | No live timeline updates; no photo upload                                          |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`      | Supabase → Settings → API → anon public                                              | Browser Realtime / Storage                   | As above                                                                           |
| `SUPABASE_SERVICE_ROLE_KEY`          | Supabase → Settings → API → service_role                                             | Server-side Storage writes                   | Bag photos are not uploaded                                                        |
| `STRIPE_SECRET_KEY`                  | Stripe → Developers → API keys                                                       | Real card authorization and capture          | Booking uses `FakePaymentProvider`; no money moves                                 |
| `STRIPE_WEBHOOK_SECRET`              | Stripe → Developers → Webhooks, or `stripe listen`                                   | Verifying `/api/webhooks/stripe`             | The route rejects every webhook rather than trusting it                            |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe → Developers → API keys                                                       | Mounting Stripe Elements                     | Checkout shows the dev payment path                                                |
| `INNGEST_EVENT_KEY`                  | Inngest Cloud → Events → Event keys                                                  | Sending events to Inngest Cloud              | Works against `pnpm dev:inngest`                                                   |
| `INNGEST_SIGNING_KEY`                | Inngest Cloud → Deploy → Signing key                                                 | Serving functions to Inngest Cloud           | Works against `pnpm dev:inngest`                                                   |
| `TWILIO_ACCOUNT_SID`                 | Twilio Console                                                                       | Real SMS                                     | `ConsoleNotifier` logs instead                                                     |
| `TWILIO_AUTH_TOKEN`                  | Twilio Console                                                                       | Real SMS                                     | As above                                                                           |
| `TWILIO_MESSAGING_SERVICE_SID`       | Twilio → Messaging → Services                                                        | Real SMS                                     | As above                                                                           |
| `RESEND_API_KEY`                     | Resend → API Keys                                                                    | Real email                                   | `ConsoleNotifier` logs instead                                                     |
| `AEROAPI_KEY`                        | FlightAware AeroAPI                                                                  | Flight lookup                                | Stubbed — flight details are typed in                                              |
| `GOOGLE_MAPS_API_KEY`                | Google Cloud → Maps Platform                                                         | Real drive-time and address autocomplete     | Fixed drive-time estimate is used                                                  |
| `ANTHROPIC_API_KEY`                  | console.anthropic.com                                                                | Ticket-PDF extraction                        | Out of scope for this scaffold                                                     |
| `SENTRY_DSN`                         | Sentry → Project Settings → Client Keys                                              | Error and ops alerting                       | Alerts go to console                                                               |
| `TEST_DATABASE_URL`                  | Your throwaway Postgres                                                              | Running integration tests                    | They skip, and `pnpm test` stays green                                             |

### Setting up local env files

```bash
for d in apps/web apps/agent apps/admin; do cp $d/.env.example $d/.env.local; done && cp packages/db/.env.example packages/db/.env
```

Each app and package has its own `.env.example` documenting only the subset it
reads, and each is the file that actually takes effect:

- **Next.js reads only `apps/<app>/.env.local`.** It does not traverse up to the
  monorepo root, and Turborepo does not load `.env` files into a task's
  environment either — it only hashes them for caching. A repo-root `.env.local`
  therefore has **no effect on the three apps**.
- **`drizzle-kit` is the exception.** `packages/db/drizzle.config.ts` explicitly
  falls back to the repo root, so `pnpm db:migrate` and `pnpm seed` do pick up a
  root `.env.local`.
- **`packages/db` uses `.env`, not `.env.local`** — the drizzle-kit convention.

The repo-root [`.env.example`](.env.example) is best treated as the canonical
reference for where every key comes from, rather than as a shared runtime file.

Keys in the per-app `.env.example` files are deliberately left **empty**, with a
realistic shape in the comment above each. That keeps `cp .env.example .env.local`
safe: a malformed value is worse than an absent one, because it passes validation
and then fails at connect time instead of degrading to the fallback above.

Least privilege is intentional: `apps/agent` carries no Stripe or messaging
credentials — a shared, frequently-lost device should not hold them — and
`apps/admin` gets a Stripe secret key for refunds but no webhook or publishable
key. Only browser-safe values take the `NEXT_PUBLIC_` prefix, since Next.js
inlines those into the client bundle.

---

## Testing

```bash
pnpm test                                    # unit tests; integration tests skip
pnpm --filter @koolee/core test:watch        # watch mode
```

Integration tests are opt-in and need a real Postgres:

```bash
docker compose up -d
TEST_DATABASE_URL=postgres://koolee:koolee@localhost:5433/koolee \
  pnpm --filter @koolee/core test:integration
```

They migrate and truncate the database they are pointed at. **Point them at a
throwaway instance.**

What is covered:

- **Booking state machine** — the full 10 × 11 status/event matrix, every legal
  transition and all 88 illegal ones, terminal statuses, the cancel boundary,
  and custody-event emission.
- **Cutoff and slot logic** — boundary conditions to the minute, both 2025 DST
  transitions, domestic vs international cutoffs, and a property check that no
  returned slot ever ends after the latest safe pickup start.
- **Pricing** — additivity, tier multipliers, discount stacking, integer-cent
  invariants, validation.
- **Payments** — the `FakePaymentProvider` authorize → capture → refund state
  machine and its rejections.
- **Coverage** — ZIP normalisation and the service-area allowlist.
- **Integration** — `createBooking` end to end: transactional consistency,
  concurrent overselling (three racing bookings against a capacity of two),
  rollback on a full slot, compensation when payment authorization fails, and
  the `custody_events` append-only trigger rejecting `UPDATE`/`DELETE`/`TRUNCATE`.

---

## Commands

| Command            | What it does                                 |
| ------------------ | -------------------------------------------- |
| `pnpm dev`         | All three apps (3000 / 3001 / 3002)          |
| `pnpm build`       | Production build of all three                |
| `pnpm lint`        | ESLint across the workspace                  |
| `pnpm typecheck`   | `tsc --noEmit` across the workspace          |
| `pnpm test`        | Unit tests                                   |
| `pnpm format`      | Prettier write                               |
| `pnpm db:generate` | Diff the schema, write a migration (offline) |
| `pnpm db:migrate`  | Apply migrations (direct connection)         |
| `pnpm db:studio`   | drizzle-kit studio                           |
| `pnpm seed`        | Idempotent reference data                    |
| `pnpm dev:inngest` | Local Inngest dev server                     |

---

## Background jobs

Three Inngest functions, served from `apps/web/app/api/inngest/route.ts`:

1. **`booking/confirmed`** → durably sleeps until two hours before pickup, then
   sends a reminder SMS through the `Notifier` interface.
2. **Cron, every 5 minutes** → scans in-transit bookings, compares a (stubbed)
   driver ETA against the bag-drop cutoff, and alerts ops on anything tight.
3. **`booking/agent_no_show_check`** → waits 15 minutes past slot start and
   escalates if the assigned agent never began the verification task.

All three are skeletons: real querying and logging, stubbed side effects. Run
`pnpm dev:inngest` alongside `pnpm dev` and the dev server discovers them
automatically.

---

## Not built (deliberately)

Listed so nobody goes looking for it:

- **Seal technology.** RFID vs printed QR is undecided. `bags.seal_id` is an
  opaque string and no code parses it — the decision will not require a
  migration.
- **Per-bag tracking hardware.**
- **Rejected-bag and lost-bag exception flows.** The exceptions page lists
  affected bookings; resolution is manual state overrides for now.
- **Real agent and admin auth.** Development stubs that throw outside
  `NODE_ENV=development`. See the `TODO(auth-*)` block in
  `packages/core/src/auth/stubs.ts` for the requirements.
- **Customer session in the booking flow.** Bookings currently attach to a
  placeholder customer. The Supabase phone-OTP verification helper is
  implemented; it is not yet threaded through.
- **Ticket-PDF extraction with Claude.** The upload button is present and
  disabled.
- **Real AeroAPI, Maps, Twilio, Resend integrations.** Interfaces and stubs
  only.
- **React Native.**
- **Vercel deploy config** beyond the repo being deploy-ready.
