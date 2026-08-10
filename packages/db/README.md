# @koolee/db

Drizzle schema, migrations, and connection factories. This package owns **all**
database access. Apps never import it directly (an ESLint rule enforces that);
they go through a service in `@koolee/core`.

## Connection model

Two connections, and using the wrong one causes failures that will not
reproduce locally.

| Purpose         | Env var               | Port   | Factory                   | Notes                                  |
| --------------- | --------------------- | ------ | ------------------------- | -------------------------------------- |
| App runtime     | `DATABASE_URL`        | `6543` | `createDb()` / `getDb()`  | Supavisor pooler, **transaction mode** |
| Migrations, DDL | `DIRECT_DATABASE_URL` | `5432` | `createMigrationClient()` | Direct connection, `max: 1`            |

### Why `prepare: false` is mandatory

Supavisor in transaction mode hands each transaction a different backend
connection. A prepared statement created on one backend does not exist on the
next, so leaving `prepare` on produces intermittent
`prepared statement "s1" does not exist` errors — under load, in production,
and never against a local direct connection. `createDb()` sets `prepare: false`
and there is no option to turn it back on.

### Why migrations use the direct connection

The migrator takes a Postgres advisory lock and issues DDL. Both need a stable
backend connection for the duration; transaction pooling cannot give one.
`drizzle.config.ts` and `src/migrate.ts` both read `DIRECT_DATABASE_URL` and
never fall back to the pooled URL.

## Authorization model — read this before adding an RLS policy

**Drizzle on the service-role/direct connection is the only read/write path for
application logic, and it BYPASSES RLS. Authorization is enforced in
`packages/core`, not in the database.**

RLS exists here for exactly one reason: to constrain the `anon` and
`authenticated` roles that client-side `supabase-js` uses for **Realtime
subscriptions and Storage**. That is why migration `0001` enables RLS on only
two tables:

- `bookings` — `SELECT` where `auth.uid() = user_id`
- `custody_events` — `SELECT` where the parent booking belongs to `auth.uid()`

Storage is the other half of that same reason. Migrations `0008`/`0009` put
policies on `storage.objects` for the private `bag-photos` bucket, because the
agent app deliberately holds no service-role key and uploads as the signed-in
agent — without a service key, storage RLS is the only authorization mechanism
there is. The staff test runs through the SECURITY DEFINER function
`public.is_active_staff(uuid)`: granting `authenticated` a direct `SELECT` on
`staff_members` would expose the roster through PostgREST.

Every other table has RLS left off deliberately. Turning it on elsewhere would
imply a security guarantee the architecture does not make, and would give a
future reader the false impression that the database is the access-control
boundary. It is not.

Practical consequences:

- A missing RLS policy is **not** a security hole in a server-side code path —
  that path already bypasses RLS. It is a bug only if a browser needs the data.
- Adding an authorization check means adding it to the relevant `@koolee/core`
  service. Adding a policy instead will silently do nothing for server reads.
- The RLS block in `0001` is gated on Supabase being present, so the migration
  still runs against a plain Postgres 16 (docker-compose, CI) where `auth.uid()`
  and the `authenticated` role do not exist.

## `custody_events` is append-only

`custody_events` is the chain-of-custody record: who had which bag, where, when,
and with what photographic evidence. If a bag goes missing this is what we
answer to the customer with, so it must not be rewritable.

Two layers enforce it:

1. **A database trigger** (migration `0001`) raises on `UPDATE`, `DELETE`, and
   `TRUNCATE`. This holds against psql, against a service-role client, and
   against a contributor who has not read this file.
2. **The data-access layer** exposes only `appendCustodyEvent`,
   `appendCustodyEvents`, and `listCustodyEvents`. No update or delete helper
   exists to call.

Corrections are made by **appending a compensating event**, never by editing
history.

## Schema notes

- All PKs are `uuid` defaulted by `gen_random_uuid()`.
- All instants are `timestamptz`. Koolee reasons about airline cutoffs across
  DST boundaries; a naive timestamp anywhere is a bug.
- `airports.code` is the IATA code as a natural PK with a `CHECK`, not a
  `pgEnum` — adding a fourth airport is then ordinary DDL rather than
  `ALTER TYPE ... ADD VALUE`, which cannot run inside a transaction on older
  Postgres.
- `bags.seal_id` is an **opaque string**. The seal technology (RFID vs printed
  QR) is undecided; both yield a scannable identifier. Do not parse it or infer
  structure from it.
- `verification_tasks` and `pickup_tasks` are separate tables even though one
  person often does both. They have different SLAs and evidence requirements;
  collapsing them would make "verified but not yet collected" unrepresentable.
  Assigning the same user to both is a dispatch decision, not a schema one.
- `slots` is legacy. Pickup windows are virtual now: `@koolee/core`
  (`src/slots/windows.ts`) enumerates 24 clock-aligned one-hour windows per
  flight, ending in (departure − 30h, departure − 6h]. There is deliberately
  no capacity — every window takes unlimited bookings — so `slots.capacity`
  and `slots.booked_count`, and the CHECKs guarding them, are dead weight on
  a dead table. It stays only because pre-cutover bookings still point at it.
- `slot_blocks` is the live replacement for the ops half of `slots`: a
  blackout over the virtual calendar (`airport_code`, `block_start`,
  `block_end`, `reason`, `created_by`). A block hides every window it
  **overlaps** from customers and never touches an existing booking — it
  stops new sales, it does not cancel anything.
- `bookings.pickup_window_start` / `pickup_window_end` are the window the
  customer bought. Two CHECKs hold the shape: the pair is both-or-neither,
  and end follows start. `slot_id` is NULL on every booking made since the
  cutover.
- `bookings.price_breakdown` is a jsonb snapshot of the pricing engine's
  output at booking time (`PriceBreakdown` in `@koolee/core`). `price_cents`
  stays the authoritative charge; the breakdown is the receipt — which
  lead-time step, distance, and discounts produced it.
- `pricing_rules.lead_time_multipliers` is the step curve the pricing engine
  applies: smallest matching step wins, no match means ×1.
  `slot_tier_multiplier` is **deprecated** and read by nothing — it survives
  so pre-cutover rule rows keep their history.
- `payments (provider, provider_ref)` is unique — it is the idempotency key for
  webhook processing.

## Commands

Run from the repo root:

```bash
pnpm db:generate   # diff the schema and write a new migration
pnpm db:migrate    # apply pending migrations (DIRECT_DATABASE_URL)
pnpm db:studio     # drizzle-kit studio
pnpm seed          # idempotent reference data: airports, cutoffs, pricing rule
pnpm seed:local    # the same seed, pinned to the local Supabase stack
```

`pnpm db:generate` works offline and needs no credentials. Only `db:migrate`,
`db:studio`, `seed`, and `seed:local` connect.

The seed writes reference data only: airports, airline cutoffs, and one active
pricing rule (installing the launch lead-time curve on a pre-cutover rule row
that has none). None of it is time-sensitive — pickup windows are virtual, so
there is no slot inventory to expire and nothing to re-seed after a clock
change.

`pnpm seed` additionally creates the dev staff and customer accounts, but only
when `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` are set **and** the Supabase
host is `127.0.0.1`/`localhost` — seeding known passwords into a hosted project
would be a standing backdoor, so a non-local host is a hard skip, not a
warning. `pnpm seed:local` is the one-command version: it pins both database
URLs at the local stack before anything reads the environment and loads the
`.env.test` that `pnpm test:env:up` wrote.

To write a migration that Drizzle cannot infer (triggers, RLS, publications):

```bash
pnpm --filter @koolee/db exec drizzle-kit generate --custom --name my_change
```

## Local Postgres

```bash
docker compose up -d          # Postgres 16 on host port 5433
```

Then in `.env.local` at the repo root:

```
DATABASE_URL=postgres://koolee:koolee@localhost:5433/koolee
DIRECT_DATABASE_URL=postgres://koolee:koolee@localhost:5433/koolee
```

Both point at the same instance locally — there is no pooler in front of it.
The `prepare: false` setting is harmless against a direct connection, so local
and production behaviour stay consistent.

This bare Postgres has no `auth` schema, so anything that needs GoTrue —
the integration suites, `pnpm seed:local` — wants the Supabase CLI stack on
`127.0.0.1:54322` instead. That one is stood up by `pnpm test:env:up`; see
[../core/docs/local-test-env.md](../core/docs/local-test-env.md). Either way,
Koolee's migrations are the Drizzle files in `packages/db/drizzle`, never
`supabase/migrations` — `supabase db reset` leaves the `public` schema empty
until `pnpm db:migrate` runs.
