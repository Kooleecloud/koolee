# @koolee/db

Drizzle schema, migrations, and connection factories. This package owns **all**
database access. Apps never import it directly (an ESLint rule enforces that);
they go through a service in `@koolee/core`.

Today: **24 schema files, 29 tables, 34 migrations** (`0000`–`0033`). Baseline:
`dev` @ `5db21a4`. Migration mechanics, the drift report and the full history
table live in [docs/MIGRATIONS.md](../../docs/MIGRATIONS.md).

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
- `bags.ordinal` is the bag's number within its booking (`1..bag_count`),
  assigned once at creation and never reused or reordered, with a
  `UNIQUE (booking_id, ordinal)` index so "two bags called Bag 2" cannot
  exist. **Order by it and label from it — never from array position.** A
  booking's bags are inserted in one statement and therefore share
  `created_at` to the millisecond, so `ORDER BY created_at` is a
  non-deterministic tie that an `UPDATE` can reshuffle: a sealed bag was
  observed moving from "Bag 1" to "Bag 3" between two renders of the same
  page. Ordinals backfilled by migration `0014` for pre-existing rows are
  arbitrary-but-stable (the real order was never recorded); for already
  sealed bags the seal id is the true identity anyway.
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
- **A booking carries its own pickup address** (migration `0033`). Eight
  `pickup_*` columns are snapshotted onto `bookings`; `pickup_address_id` is
  provenance only and goes `NULL` when the customer deletes the saved address.
  ⚠️ Every reader takes the doorstep off the booking — **joining `addresses`
  to render one is a bug** that looks fine until the first deletion. This
  exists so an address CAN be deleted; before it, a saved address was permanent
  because a booking depended on it.
- `booking_signals` is a **doorbell, not data**: one mutable row per booking,
  three columns, and the only table in `public` a browser may read. An
  `AFTER INSERT` trigger on `custody_events` touches it, which is the one write
  path that is not a service call — deliberately, because ~20 services append
  custody events and none of them should have to know a realtime table exists.
  Migration `0031` adds the `GRANT` without which `0030`'s policy delivered
  nothing.
- `push_subscriptions.endpoint` is unique **on its own**, not
  `(user_id, endpoint)`. An endpoint identifies one browser install globally,
  so subscribe is an upsert that overwrites `user_id`: a device that changes
  hands **moves** to its new owner instead of duplicating and notifying the
  previous one.
- `driver_shifts` carries two partial unique indexes (`WHERE ended_at IS NULL`)
  — one open shift per person, one per truck. They are the only thing between
  two taps on "Start shift" and two people dispatched to the same van.
- `driver_positions` is one **mutable** row per driver, overwritten every ~45
  seconds. Explicitly **not** chain of custody: a position is not evidence.
- `agreement_versions` rows are immutable once `effective_from` has passed
  (trigger, `0024`), and "current" is DERIVED — `max(version)` where
  `effective_from <= now()`. **There is no `is_active` column and there must
  not be one.** `agreement_acceptances` holds at most one row per booking
  (`UNIQUE (booking_id)`, `0025`): the version a booking accepts pins for that
  booking's whole life.
- `zip_centroids` (837 US-Census ZCTA rows) covers a **wider** area than
  coverage does, deliberately, so an out-of-zone driver still resolves to a
  position. Runtime reads the table; `src/zip-centroids.ts` is what the seed
  reconciles it to.
- `otp_send_log` keys throttle rows by a **hashed** destination
  (`OTP_LOG_HMAC_KEY`) — the log has to be worthless to anyone who can read
  it.

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

Two staff scripts are not in the root package.json and are run through the
filter:

```bash
pnpm --filter @koolee/db bootstrap:staff   # the first admin, on an empty project
pnpm --filter @koolee/db create:staff      # one more staff member
```

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
