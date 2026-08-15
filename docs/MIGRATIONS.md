# Migrations

> **How schema change works in this repo, and how to not break production.**
> Baseline: `dev` @ `5973047`. Related: [ENVIRONMENT.md](ENVIRONMENT.md) ·
> [SCRIPTS.md](SCRIPTS.md) · [packages/db/README.md](../packages/db/README.md)

---

## 1. The model in one paragraph

Migrations are **Drizzle SQL files** in
[`packages/db/drizzle/`](../packages/db/drizzle/), ordered by a journal at
`drizzle/meta/_journal.json`. You edit the TypeScript schema in
[`packages/db/src/schema/`](../packages/db/src/schema/), run `db:generate` to
diff it into a new `.sql` file, review that SQL, and `db:migrate` to apply it
over the **direct** connection. Applied migrations are recorded by **content
hash** in `drizzle.__drizzle_migrations`.

⚠️ **Koolee's migrations are the Drizzle files, never `supabase/migrations`.**
`supabase db reset` leaves the `public` schema empty until `pnpm db:migrate`
runs.

---

## 2. When you need a migration

| Change                                                     | Migration?                                                                                                                                                       |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New table / column / index / constraint                    | ✅ `db:generate` infers it                                                                                                                                       |
| Changing a column type or nullability                      | ✅ `db:generate` — **review the SQL**, it may drop data                                                                                                          |
| New value in a `pgEnum` (e.g. a booking status)            | ✅ generated, but see §7 on enums                                                                                                                                |
| Trigger, RLS policy, function, publication, storage bucket | ✅ **`--custom`**, Drizzle cannot infer these                                                                                                                    |
| New _transition_ in the booking state machine              | ❌ Core-only. Transitions live in `packages/core`, not the DB ([Learning Ch 1.5](learning/01-product-and-nouns.md#15--the-lifecycle-ten-statuses-one-authority)) |
| New pricing rule, airport, airline cutoff                  | ❌ That's **seed/reference data**, not schema                                                                                                                    |
| Adding an authorization check                              | ❌ Goes in a `@koolee/core` service. An RLS policy will silently do nothing for server reads (§6)                                                                |

---

## 3. The two-connection rule

**This is the rule that causes production-only failures.**

| Purpose         | Env var               | Port   | Factory                                                       |
| --------------- | --------------------- | ------ | ------------------------------------------------------------- |
| App runtime     | `DATABASE_URL`        | `6543` | `createDb()` / `getDb()` — Supavisor pooler, transaction mode |
| Migrations, DDL | `DIRECT_DATABASE_URL` | `5432` | `createMigrationClient()` — `max: 1`                          |

**Why migrations need the direct connection:** the migrator takes a Postgres
advisory lock and issues DDL. Both need a _stable backend connection_ for their
duration. Supavisor transaction mode hands out a different backend per
statement, which breaks both.

**Why runtime needs `prepare: false`:** same mechanism, opposite direction. A
prepared statement created on one backend does not exist on the next, producing
intermittent `prepared statement "s1" does not exist` — under load, in
production, and **never** locally against a direct connection. `createDb()` sets
it and offers no way to turn it back on.

💡 **IPv6 gotcha.** Supabase's true direct host (`db.<ref>.supabase.co`) is
IPv6-only. On an IPv4 network use the **session pooler** — same project, port
5432, host `aws-0-<region>.pooler.supabase.com`. `db:status` detects `ENOTFOUND`
and tells you this ([status.ts:245](../packages/db/src/status.ts#L245)).

---

## 4. The workflow

```bash
# 1. Edit the schema
$EDITOR packages/db/src/schema/bookings.ts

# 2. Generate. Works OFFLINE — no credentials, no connection.
pnpm db:generate

# 3. READ THE GENERATED SQL. This is the review step, not a formality.
$EDITOR packages/db/drizzle/00NN_*.sql

# 4. Check what the target database actually has (read-only, safe on prod)
pnpm db:status

# 5. Apply
pnpm db:migrate
```

⚠️ **Steps 4 and 5 read `packages/db/.env`, which points at the HOSTED
project.** Pin the URL for anything local:

```bash
DIRECT_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
  pnpm db:migrate
```

Shell env always beats dotenv — `migrate.ts`, `status.ts` and
`drizzle.config.ts` each capture `process.env` _before_ loading dotenv
([migrate.ts:15-21](../packages/db/src/migrate.ts#L15-L21)). Both tools print
`Target host:` first. **Read that line every time.**

### Custom migrations

For anything Drizzle cannot infer — triggers, RLS, functions, storage buckets:

```bash
pnpm --filter @koolee/db exec drizzle-kit generate --custom --name my_change
```

---

## 5. `pnpm db:status` — the drift report

Read-only. Writes nothing, takes no locks, runs no DDL. **Safe against
production, which is the entire point** — a check you hesitate to run is a check
you will not run. Exits non-zero so CI can gate a deploy on it.

It reports four distinct things:

**5.1 — Pending.** Migrations in the journal whose content hash is absent from
the database.

**5.2 — Orphans.** Rows in `__drizzle_migrations` matching no file in this
checkout. **Not an error** — a regenerated migration leaves one behind forever.
Do not "clean them up"; deleting one is a write to production migration history
for no functional gain.

**5.3 — STRANDED (the dangerous one).** Drizzle applies a file only when its
`folderMillis` is **greater than** the newest `created_at` already recorded — it
reads exactly one row, `order by created_at desc limit 1`. So a migration whose
timestamp lands at or below that watermark is **skipped forever, with no error
and no output**. This is precisely how the `0003` rework went wrong.

> **Fix a stranded migration by regenerating it with a newer timestamp — never
> by editing the database's journal rows.**

**5.4 — RLS baseline.** Migration `0016` promises RLS is on for every `public`
table. `db:status` asserts it, and warns if the `ensure_rls` event trigger is
absent (it needs superuser, which Supabase's `postgres` role lacks).

### Why it compares hashes, not counts

The first version compared `count(*)` to the number of journal files. On
2026-08-10 that produced a confidently wrong answer about hosted: _"Applied: 17
of 16 — this database is 1 migration AHEAD."_ Hosted was in fact **in sync**;
the extra row was an orphan from the rewritten `0003`.

The dangerous direction is the quiet one: **one orphan row plus one genuinely
missing migration nets to "in sync — nothing pending"** — the exact false clean
bill the tool exists to prevent. Hence content hashes, and missing vs orphaned
reported as the different things they are
([status.ts:26-41](../packages/db/src/status.ts#L26-L41)).

🧭 **Decision hook.** Never revert or hand-edit a journal entry based on an
assumption about database state. Verify with `db:status` against that database,
or write a corrective migration.

---

## 6. The authorization model — read before adding an RLS policy

**Drizzle on the direct/service-role connection is the only read/write path for
application logic, and it BYPASSES RLS. Authorization is enforced in
`packages/core`, not in the database.**

RLS exists for exactly one reason: to constrain the `anon` and `authenticated`
roles that browser-side `supabase-js` uses for **Realtime and Storage**.

- `0001` — RLS + policies on `bookings` (`auth.uid() = user_id`) and
  `custody_events` (via parent booking).
- `0008`/`0009` — `storage.objects` policies for the private `bag-photos`
  bucket. The agent app holds no service key, so **storage RLS is the only
  authorization mechanism there is**. The staff test runs through the
  SECURITY DEFINER function `public.is_active_staff(uuid)`, because granting
  `authenticated` a direct `SELECT` on `staff_members` would expose the roster
  through PostgREST.
- `0016` — uniform RLS baseline. Hosted had RLS on for 20 policy-less tables
  (applied out-of-band, likely a Supabase security-advisor remediation) while
  local had it **off** — meaning local was the _less_ safe environment and no
  test could catch a client-side read that hosted would refuse. `0016` closes
  that split.

Practical consequences:

- A missing RLS policy is **not** a security hole in a server-side path — that
  path already bypasses RLS. It is a bug only if a browser needs the data.
- Adding an authorization check means adding it to a `@koolee/core` service.
  Adding a policy instead will silently do nothing for server reads.

---

## 7. Schema conventions worth knowing before you generate

- All PKs are `uuid` defaulted by `gen_random_uuid()`.
- **All instants are `timestamptz`.** Koolee reasons about airline cutoffs
  across DST boundaries; a naive timestamp anywhere is a bug.
- `airports.code` is a natural PK with a `CHECK`, **not** a `pgEnum` — adding a
  fourth airport is then ordinary DDL rather than `ALTER TYPE … ADD VALUE`,
  which cannot run inside a transaction on older Postgres. Consider the same
  trade-off before adding a new enum.
- `custody_events` is **append-only**, enforced by a trigger (`0001`) that
  raises on `UPDATE`/`DELETE`/`TRUNCATE` _and_ by a data-access layer exposing
  no update or delete helper. Corrections append a compensating event.
- `payments (provider, provider_ref)` is unique — the webhook idempotency key.
- `bags (booking_id, ordinal)` is unique — see
  [Learning §1.4](learning/01-product-and-nouns.md#14--why-bagsordinal-exists).
- `slots` is **legacy** and kept only because pre-cutover bookings point at it.
  `slots.capacity` / `booked_count` are dead weight on a dead table. Do not
  build on it — pickup windows are virtual.

---

## 8. Migration history

| #         | Tag                      | Date       | What it did                                                            |
| --------- | ------------------------ | ---------- | ---------------------------------------------------------------------- |
| 0000      | `init`                   | 2026-07-31 | Initial schema                                                         |
| 0001      | `custody_guard_and_rls`  | 2026-07-31 | Append-only trigger + the two RLS policies                             |
| 0002      | `auth_profile_fields`    | 2026-08-02 | Auth profile columns                                                   |
| 0003      | `glamorous_krista_starr` | 2026-08-03 | Regenerated after being applied — source of the surviving orphan row   |
| 0004–0007 |                          | 2026-08-09 | Auth funnel / drafts work                                              |
| 0008      | `bag_photos_bucket`      | 2026-08-09 | Private storage bucket + policies                                      |
| 0009      | `staff_check_function`   | 2026-08-09 | `public.is_active_staff()` SECURITY DEFINER                            |
| 0010–0011 |                          | 2026-08-09 | Staff / ops tables                                                     |
| 0012      | `yummy_micromacro`       | 2026-08-10 | **Virtual windows** — slot inventory retired                           |
| 0013      | `curved_adam_destine`    | 2026-08-10 |                                                                        |
| 0014      | `milky_bug`              | 2026-08-10 | `bags.ordinal` + backfill (arbitrary-but-stable for pre-existing rows) |
| 0015      | `colossal_sue_storm`     | 2026-08-10 |                                                                        |
| 0016      | `uniform_rls_baseline`   | 2026-08-11 | RLS on for every `public` table + `ensure_rls` event trigger           |

> **Note:** older docs state that `0012` is "applied locally but not yet
> hosted". That predates the hash-based drift check. Verify current state with
> `pnpm db:status` against the hosted URL rather than trusting any written
> claim, including this table.

---

## 9. Deploying a migration

1. `pnpm db:status` against the target — **confirm the `Target host:` line**.
2. Apply over the **direct** connection (`DIRECT_DATABASE_URL`, port 5432).
   Through the pooler you get `prepared statement does not exist` errors in
   production that will not reproduce locally.
3. `pnpm db:status` again — expect _"In sync — nothing pending"_.
4. Seed reference data if the project is new: `pnpm seed` (airports, airline
   cutoffs, one active pricing rule). Idempotent.

⚠️ `pnpm seed` also creates dev staff/customer accounts — but **only** when the
Supabase host is `127.0.0.1`/`localhost`. A non-local host is a **hard skip, not
a warning**: seeding known passwords into a hosted project would be a standing
backdoor.

---

## 10. Recovery playbook

| Situation                                        | Do this                                                                    |
| ------------------------------------------------ | -------------------------------------------------------------------------- |
| `db:status` says **STRANDED**                    | Regenerate the migration with a newer timestamp. Never edit journal rows   |
| `db:status` shows **orphans**                    | Nothing. Expected after a regenerated migration; harmless                  |
| Migration applied to the wrong database          | Write a corrective forward migration. Do not hand-delete rows              |
| `prepared statement "s1" does not exist` in prod | Migrations ran through the pooler. Re-run over `DIRECT_DATABASE_URL`       |
| `ENOTFOUND` on the direct host                   | IPv6-only. Use the session pooler on port 5432 (§3)                        |
| Local DB in an unknown state                     | `pnpm test:env:reset` — wipes and re-applies. See [SCRIPTS.md](SCRIPTS.md) |
| Generated SQL looks destructive                  | Do not apply. Hand-write a `--custom` migration that preserves data        |
