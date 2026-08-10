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
# NOTE: packages/db/.env points at the HOSTED project. A bare `pnpm db:migrate`
# or `pnpm seed` targets production — use `pnpm seed:local`, or override the URL
# inline. `migrate.ts` prints its target host; read that line before confirming.

pnpm test:env:up               # local Supabase stack (Postgres + GoTrue) on 127.0.0.1
pnpm db:migrate                # applies migrations over the DIRECT connection
pnpm seed:local                # reference data + dev staff/customer accounts
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
| `apps/admin` | 3002 | Ops console — bookings, exceptions, blackouts, staff       |

---

## Documentation

This file is the operator's manual: how to run it, what every variable does,
and the rules that are not obvious from the code. Everything else lives next
to what it describes.

| Read this                                                                    | When you want                                                                                                                                                      |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [docs/CODEBASE-MAP.md](docs/CODEBASE-MAP.md)                                 | To understand the system. Thirteen chapters: nouns, boundaries, data model, the domain rules, the seams, each app, testing, deploy. **Start here if you are new.** |
| [PROJECT-STATUS.md](PROJECT-STATUS.md)                                       | What shipped, what is in flight, what is next — with a spec stub per feature                                                                                       |
| [packages/db/README.md](packages/db/README.md)                               | Schema invariants, the two-connection rule, the RLS stance                                                                                                         |
| [packages/core/docs/local-test-env.md](packages/core/docs/local-test-env.md) | To run the integration and auth-acceptance tiers                                                                                                                   |
| [apps/web/docs/](apps/web/docs/)                                             | Auth wiring, payments lifecycle, ticket extraction, the pre-launch checklist                                                                                       |
| [apps/admin/docs/](apps/admin/docs/)                                         | Ops console workflows and staff auth                                                                                                                               |
| [apps/agent/docs/](apps/agent/docs/)                                         | The verification visit, step by step                                                                                                                               |
| [brand/BRAND.md](brand/BRAND.md)                                             | Colour, type, and copy rules before touching UI                                                                                                                    |
| [MIGRATION-NOTES.md](MIGRATION-NOTES.md)                                     | Historical record of the 10-phase dependency migration                                                                                                             |

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
  `PaymentProvider` interface.

### Packages

| Package           | Contents                                                                                              |
| ----------------- | ----------------------------------------------------------------------------------------------------- |
| `packages/core`   | Booking state machine, cutoff/window logic, pricing, payments, auth contracts, services, Inngest jobs |
| `packages/db`     | Drizzle schema, migrations, pooled + direct connection factories                                      |
| `packages/ui`     | shadcn/ui components and the shared Tailwind preset                                                   |
| `packages/config` | Shared `tsconfig`, ESLint flat config, Prettier config                                                |

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

Every variable is optional at boot, with server-side exceptions per app:

- **web** (`apps/web/src/env.ts`): `OTP_LOG_HMAC_KEY` becomes required the
  moment `DATABASE_URL` is set, and a **production** boot with Supabase
  configured refuses to start unless the Turnstile site key, service-role
  key, and `DATABASE_URL` are all present and `AUTH_SCHEMA_AVAILABLE` is not
  `"false"` (`assertProductionSecurityConfig` — each of those, absent,
  silently disables a security control).
- **agent** (`apps/agent/src/env.ts`): a **production** boot refuses to start
  without `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` —
  staff sign-in is the app; missing keys would degrade it silently.
- **admin** (`apps/admin/src/env.ts`): a **production** boot refuses to start
  without the Supabase URL + anon key, `SUPABASE_SERVICE_ROLE_KEY`, and
  `NEXT_PUBLIC_AGENT_APP_URL`.

(`next build` is exempt from all three gates, so a credential-less fresh
clone still builds; the gates fire when a production server boots.)

This table says what each variable unlocks and what happens without it.

| Variable                             | Where to get it                                                                      | Required when                                                                        | Without it                                                                                                                                               |
| ------------------------------------ | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_APP_URL`                | This app's own origin — `3000` / `3001` / `3002` locally                             | Absolute links and Stripe return URLs                                                | Relative links only                                                                                                                                      |
| `DATABASE_URL`                       | Supabase → Settings → Database → Connection pooling, **transaction mode**, port 6543 | Any page or action that reads or writes data                                         | Pages render an empty state; mutations return a configuration error                                                                                      |
| `DIRECT_DATABASE_URL`                | Supabase → Settings → Database → Direct connection, port 5432                        | `pnpm db:migrate`, `pnpm db:studio`                                                  | Migrations fail with a named error. `pnpm db:generate` still works — it is offline                                                                       |
| `NEXT_PUBLIC_SUPABASE_URL`           | Supabase → Settings → API → Project URL                                              | Browser Realtime / Storage                                                           | No live timeline updates; no photo upload                                                                                                                |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`      | Supabase → Settings → API → anon public                                              | Browser Realtime / Storage                                                           | As above                                                                                                                                                 |
| `SUPABASE_SERVICE_ROLE_KEY`          | Supabase → Settings → API → service_role                                             | Server-side Storage writes; deleting orphaned auth users during claim reconciliation | Bag photos are not uploaded; orphan deletion degrades to a logged no-op (production refuses to boot — see below)                                         |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY`     | Cloudflare → Turnstile → site key. The SECRET key lives in the Supabase dashboard    | Mounting the CAPTCHA widget on auth sends                                            | No widget; auth calls carry no captchaToken — leave Supabase CAPTCHA off (production refuses to boot — see below)                                        |
| `OTP_LOG_HMAC_KEY`                   | `openssl rand -hex 32` (min 32 chars)                                                | Whenever `DATABASE_URL` is set — enforced at boot                                    | With a database configured, boot fails with a named error                                                                                                |
| `AUTH_SCHEMA_AVAILABLE`              | Set `"false"` ONLY for a bare local Postgres with no GoTrue `auth` schema            | Skipping claim reconciliation against local docker                                   | Unset counts as available; a genuinely missing schema fails the send loudly                                                                              |
| `CRON_SECRET`                        | Any random string                                                                    | Manual `/api/jobs/*` triggers                                                        | Those routes refuse to run                                                                                                                               |
| `STRIPE_SECRET_KEY`                  | Stripe → Developers → API keys                                                       | Real card authorization and capture                                                  | Booking uses `FakePaymentProvider`; no money moves                                                                                                       |
| `STRIPE_WEBHOOK_SECRET`              | Stripe → Developers → Webhooks, or `stripe listen`                                   | Verifying `/api/webhooks/stripe`                                                     | The route rejects every webhook rather than trusting it; the return page's server-side status re-check still advances paid bookings                      |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe → Developers → API keys                                                       | Mounting the Stripe Payment Element                                                  | With no secret key either: the dev payment path. With a secret key set: the pay step refuses loudly (misconfiguration — the browser could never confirm) |
| `NEXT_PUBLIC_AGENT_APP_URL`          | The agent app's own origin — `http://localhost:3001` locally                         | Admin console building agent invite links                                            | Invite links default to `http://localhost:3001` (production boot refuses — see above)                                                                    |
| `INNGEST_EVENT_KEY`                  | Inngest Cloud → Events → Event keys                                                  | Sending events to Inngest Cloud                                                      | Works against `pnpm dev:inngest`                                                                                                                         |
| `INNGEST_SIGNING_KEY`                | Inngest Cloud → Deploy → Signing key                                                 | Serving functions to Inngest Cloud                                                   | Works against `pnpm dev:inngest`                                                                                                                         |
| `RESEND_API_KEY`                     | Resend → API Keys                                                                    | Real email                                                                           | `ConsoleNotifier` logs instead                                                                                                                           |
| `AEROAPI_KEY`                        | FlightAware AeroAPI                                                                  | Flight lookup                                                                        | Stubbed — flight details are typed in                                                                                                                    |
| `GOOGLE_MAPS_API_KEY`                | Google Cloud → Maps Platform                                                         | Real drive-time and address autocomplete                                             | Fixed drive-time estimate is used                                                                                                                        |
| `ANTHROPIC_API_KEY`                  | console.anthropic.com                                                                | Claude-powered ticket-PDF extraction                                                 | The free in-process heuristic extractor runs instead — extraction still works                                                                            |
| `SENTRY_DSN`                         | Sentry → Project Settings → Client Keys                                              | Error and ops alerting                                                               | Alerts go to console                                                                                                                                     |
| `TEST_DATABASE_URL`                  | Your throwaway Postgres                                                              | Running integration tests                                                            | They skip, and `pnpm test` stays green                                                                                                                   |

### Runtime env, per app

Which app reads which variable at runtime, and which a **production** boot
demands (the boot assertions described above). ✓ = read when present;
**prod** = production refuses to boot without it; — = the app never reads it.

| Variable                                    | web                                          | agent                                        | admin       |
| ------------------------------------------- | -------------------------------------------- | -------------------------------------------- | ----------- |
| `NEXT_PUBLIC_APP_URL`                       | ✓                                            | ✓                                            | ✓           |
| `DATABASE_URL`                              | ✓ **prod**¹                                  | ✓                                            | ✓           |
| `DIRECT_DATABASE_URL`                       | ✓ (migrations)                               | ✓                                            | ✓           |
| `NEXT_PUBLIC_SUPABASE_URL`                  | ✓                                            | ✓ **prod**                                   | ✓ **prod**  |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`             | ✓                                            | ✓ **prod**                                   | ✓ **prod**  |
| `SUPABASE_SERVICE_ROLE_KEY`                 | ✓ **prod**¹                                  | — (least privilege — must never be set here) | ✓ **prod**  |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY`            | ✓ **prod**¹                                  | —                                            | —           |
| `OTP_LOG_HMAC_KEY`                          | ✓ (required with `DATABASE_URL`)             | —                                            | —           |
| `AUTH_SCHEMA_AVAILABLE`                     | ✓ (must not be `"false"` in prod)            | —                                            | —           |
| `CRON_SECRET`                               | ✓                                            | —                                            | —           |
| `STRIPE_SECRET_KEY`                         | ✓                                            | —                                            | ✓ (refunds) |
| `STRIPE_WEBHOOK_SECRET`                     | ✓                                            | —                                            | —           |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`        | ✓                                            | —                                            | —           |
| `NEXT_PUBLIC_AGENT_APP_URL`                 | —                                            | —                                            | ✓ **prod**  |
| `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY` | ✓                                            | —                                            | —           |
| `RESEND_API_KEY`                            | ✓                                            | —                                            | —           |
| `AEROAPI_KEY`                               | ✓                                            | —                                            | —           |
| `GOOGLE_MAPS_API_KEY`                       | ✓                                            | ✓                                            | —           |
| `ANTHROPIC_API_KEY`                         | ✓ (optional — heuristic extractor otherwise) | —                                            | —           |
| `SENTRY_DSN`                                | ✓                                            | ✓                                            | ✓           |

¹ web's production gate fires only when `NEXT_PUBLIC_SUPABASE_URL` is set
(without Supabase the auth funnel is inert); agent and admin gate every
production boot.

Real card payments in the browser need BOTH `STRIPE_SECRET_KEY` and
`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` on web; `STRIPE_WEBHOOK_SECRET` is
required in production for webhook verification, while local dev without it
still completes bookings via the return page's server-side status re-check.

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
pnpm test:env:up                                    # local Supabase stack
pnpm --filter @koolee/core test:integration         # reads .env.test
```

`docker compose up -d` (Postgres 16 on host port 5433) also works for the
suites that need only a database, but it has no GoTrue `auth` schema, so the
auth-acceptance tier needs the Supabase stack.

They migrate and clear the database they are pointed at. **Point them at a
throwaway instance** — and note that `.env.test` points at the same local
Postgres the dev servers use, so a run wipes your dev rows. The suite re-seeds
the dev roster on the way out; a hand-edited pricing rule is the one thing it
cannot restore. Details in
[packages/core/docs/local-test-env.md](packages/core/docs/local-test-env.md).

What is covered:

- **Booking state machine** — the full 10 × 11 status/event matrix, every legal
  transition and all 88 illegal ones, terminal statuses, the cancel boundary,
  and custody-event emission.
- **Cutoff and window logic** — boundary conditions to the minute, both 2025
  DST transitions, the always-24-windows band invariant, notice/blackout
  fences, and a displayed-implies-accepted property check between the
  enumerator and booking acceptance.
- **Pricing** — additivity, the lead-time multiplier curve (monotonic:
  closer to departure never costs less), discount stacking, integer-cent
  invariants, validation.
- **Payments** — the `FakePaymentProvider` authorize → capture → refund state
  machine and its rejections.
- **Coverage** — ZIP normalisation and the service-area allowlist.
- **Auth upgrade guard** — destination hashing (never plaintext), both OTP
  throttle windows, and the merged throttle + claim-reconciliation
  transaction: lock order, capped-send short-circuit, conflict-still-counted,
  anonymous-claimant removal. Integration tiers add real-lock concurrency
  (per-user and per-destination caps under burst) and, against the
  `pnpm test:env:up` GoTrue stack, acceptance tests 15/16 plus the
  overlapping-guard serialization test (see
  [packages/core/docs/local-test-env.md](packages/core/docs/local-test-env.md)).
- **Integration** — `createBooking` end to end: transactional consistency,
  window validation (band, notice, blackouts), concurrent bookings of the
  same window both succeeding (windows have no capacity), compensation when
  payment authorization fails, and the `custody_events` append-only trigger
  rejecting `UPDATE`/`DELETE`/`TRUNCATE`.

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
3. **`booking/agent_no_show_check`** → waits 15 minutes past the pickup
   window's start and escalates if the assigned agent never began the
   verification task.

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
- **Real AeroAPI, Maps, custody-SMS, Resend integrations.** Interfaces and
  stubs only, so flight details are typed in and drive time is a fixed
  estimate. Auth OTP SMS already works — Supabase Auth owns it end-to-end and
  its provider credentials live in the Supabase dashboard, not app env.
- **The Inngest jobs' side effects.** All three functions query and log for
  real; the messages they would send are stubs, blocked on the line above.
- **Pickup-window capacity.** Windows deliberately accept unlimited bookings.
  Re-introducing seat limits would need both a schema and a concurrency story.
- **Dynamic pricing.** The lead-time curve is a configurable placeholder; the
  seam it will replace is `resolveLeadTimeMultiplier` in the pricing engine.
- **React Native.**
- **Vercel deploy config** beyond the repo being deploy-ready.

Previously listed here and now **shipped**: staff auth (invite-only
agent/admin accounts), the customer session threaded through the booking flow,
and ticket-PDF extraction.
