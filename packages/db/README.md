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
- `slots.booked_count` is denormalised capacity accounting, only ever
  incremented inside the `createBooking` transaction with a
  `WHERE booked_count < capacity` guard. A `CHECK` backs that up.
- `payments (provider, provider_ref)` is unique — it is the idempotency key for
  webhook processing.

## Commands

Run from the repo root:

```bash
pnpm db:generate   # diff the schema and write a new migration
pnpm db:migrate    # apply pending migrations (DIRECT_DATABASE_URL)
pnpm db:studio     # drizzle-kit studio
pnpm seed          # idempotent reference data: airports, cutoffs, pricing, slots
```

`pnpm db:generate` works offline and needs no credentials. Only `db:migrate`,
`db:studio`, and `seed` connect.

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
