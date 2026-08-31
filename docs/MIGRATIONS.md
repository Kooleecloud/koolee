# Migrations

> **How schema change works in this repo, and how to not break production.**
> Baseline: `dev` @ `5db21a4`. Related: [ENVIRONMENT.md](ENVIRONMENT.md) ·
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

⚠️ **Steps 4 and 5 read `packages/db/.env`, which points at the LOCAL stack
by default** (changed 2026-08-22 — it used to point at hosted, and a bare
`pnpm db:migrate`/`pnpm seed` silently targeting production is exactly the
accident the flip prevents). Hosted is reached ONLY via an inline override:

```bash
DIRECT_DATABASE_URL='postgresql://postgres.PROJECT_REF:PASSWORD@aws-0-<region>.pooler.supabase.com:5432/postgres' \
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
- `0022`/`0023` — the same for `passport-photos`, and `0023` is `0009` all over
  again: `0022` copied the original inline `EXISTS (… staff_members …)` and had
  to be corrected to `public.is_active_staff`. Second time; check any new
  storage policy against this.
- `0027` — `avatars`, and the **first storage policy here that is not
  staff-only**. Writes are admitted by folder ownership,
  `(storage.foldername(name))[1] = auth.uid()::text`, so any signed-in user —
  a customer included — writes their own folder and no other. Reads add
  `OR public.is_active_staff(auth.uid())`. All three apps upload over the ANON
  key so RLS is genuinely the gate, rather than something only the agent app is
  subject to. Verified against a live database in both directions, including
  the refusals: see
  [storage-and-avatars §2](features/storage-and-avatars.md#2-who-may-read-and-write).
- `0016` — uniform RLS baseline. Hosted had RLS on for 20 policy-less tables
  (applied out-of-band, likely a Supabase security-advisor remediation) while
  local had it **off** — meaning local was the _less_ safe environment and no
  test could catch a client-side read that hosted would refuse. `0016` closes
  that split.
- `0030`/`0031` — `booking_signals`, the realtime doorbell, and the third
  instance of this same bug class. `0030` shipped a correct policy, a correct
  SECURITY DEFINER predicate (`public.can_watch_booking`), `REPLICA IDENTITY
  FULL` and publication membership — and **no browser received a single
  event**, because `authenticated` had never been granted `SELECT` on the
  table. **A policy narrows access; it cannot widen it.** `0031` is the one
  missing `GRANT`. Found by driving two browsers side by side, not by a test:
  the integration tier runs on the direct connection, where RLS _and_ GRANTs
  are equally irrelevant.
- `0032` — `push_subscriptions` deliberately gets **no policy and no grant**.
  `0016`'s `ensure_rls` event trigger switches RLS on for anything created in
  `public`, so the table lands RLS-enabled with zero policies, which denies
  `anon` and `authenticated` outright. That is the correct posture for a
  server-only table: subscribe/unsubscribe go through authenticated Server
  Actions on the pooled connection, and no browser ever queries it.

Practical consequences:

- A missing RLS policy is **not** a security hole in a server-side path — that
  path already bypasses RLS. It is a bug only if a browser needs the data.
- Adding an authorization check means adding it to a `@koolee/core` service.
  Adding a policy instead will silently do nothing for server reads.
- **A policy is not a grant.** If a browser must read a table, the migration
  needs `GRANT SELECT … TO authenticated` _and_ a policy. Supabase's default
  privileges usually supply the grant on hosted (PROJECT-STATUS §3.1 counts 154
  such grants per role) and the local stack does not — exactly the
  local-vs-hosted split `0016` exists to stop repeating — so state the grant
  rather than hoping an environment supplies it.
- **Never grant `anon`.** A signed-out session has no `auth.uid()` and every
  predicate here refuses it anyway, but a grant nobody needs is a grant
  somebody eventually leans on.
- ℹ️ `custody_events` has carried the incomplete shape since `0001`: RLS on,
  two policies, in the publication, **no `SELECT` grant** — so its subscription
  has never been able to deliver either. Nothing subscribes to it (the customer
  timeline is server-rendered), so `0031` deliberately did **not** widen it.
  Recorded so the next person does not rediscover it.

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
- `bags.seal_id` is unique **partially** (`WHERE seal_id IS NOT NULL`), scoped to
  the whole table rather than the booking — a tamper-evident seal is single-use
  stock. Partial because every unsealed bag holds `NULL`.
- `slots` is **legacy** and kept only because pre-cutover bookings point at it.
  `slots.capacity` / `booked_count` are dead weight on a dead table. Do not
  build on it — pickup windows are virtual.
- `push_subscriptions.endpoint` is unique **on its own**, not
  `(user_id, endpoint)`. An endpoint identifies one browser install globally,
  so subscribe is an upsert on `endpoint` that overwrites `user_id`: when a
  device changes hands the row **moves** to the new person instead of
  duplicating. `(user_id, endpoint)` would have permitted exactly the duplicate
  that keeps notifying a previous owner about a booking that is no longer
  theirs.
- `bookings` carries **its own pickup address** (`pickup_line1…pickup_place_id`,
  `0033`). `pickup_address_id` is provenance only — it says which saved address
  the booking was made from and goes `NULL` when the customer deletes it. Every
  reader takes the address off the booking; joining `addresses` is a bug.
- **The nullable → backfill → constrain pattern.** Adding a `NOT NULL` column
  with no default to a populated table fails outright, and a `DEFAULT ''` would
  quietly write empty values onto real rows. Add nullable, `UPDATE` from the
  existing source, then `SET NOT NULL` — all in the one transaction, so a
  backfill that misses a row aborts rather than half-applies. Used by `0014`,
  `0021`, `0028` and `0033`; reach for it every time.

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
| 0017      | `unique_seal_id`         | 2026-08-15 | `bags.seal_id` plain index → **partial `UNIQUE`** (sealed bags only)   |
| 0018–0020 |                          | 2026-08-22 | Dispatch close-out: one task pair per booking (0019), one active pricing rule (0020) |
| 0021      | `big_hobgoblin`          | 2026-08-25 | `bookings.ref` (`KOO-XXXXX`) + backfill — the nullable→backfill→constrain pattern |
| 0022–0025 |                          | 2026-08-28 | Agreements + passport: the tables, the storage-policy fix, version freeze, per-booking pin |
| 0026–0027 |                          | 2026-08-29 | Buckets declared by migration; the private `avatars` bucket           |
| 0028      | `geo_zip_centroids`      | 2026-08-29 | **Koolee's first coordinates**: `zip_centroids` (837 US-Census rows), `airports.lat/lng` NOT NULL, and a backfill of `addresses.lat/lng` |
| 0029      | `driver_fleet_and_shifts`| 2026-08-29 | `trucks`, `driver_shifts`, `driver_positions`, `staff_members.can_drive`, `pickup_tasks.driver_shift_id` — **and DROPs `drivers`, `routes`, `agents`** |
| 0030      | `booking_signals`        | 2026-08-29 | The realtime **doorbell** table + `custody_events` AFTER INSERT trigger, `public.can_watch_booking`, `REPLICA IDENTITY FULL`, publication membership |
| 0031      | `booking_signals_grant`  | 2026-08-30 | The one `GRANT SELECT … TO authenticated` without which `0030`'s policy delivered nothing (§6) |
| 0032      | `push_subscriptions`     | 2026-08-30 | Web Push routing rows — unique on `endpoint` alone; no policy and no grant, by design |
| 0033      | `military_liz_osborn`    | 2026-08-30 | **The booking carries its own doorstep**: eight `pickup_*` columns backfilled from `addresses`, then constrained; `pickup_address_id` demoted to nullable provenance (`ON DELETE set null`). ⚠️ **The CONTRACT rode the same migration as the expand** — the four `SET NOT NULL`s. Not backward-compatible in either direction; see §9.5 |

⚠️ **`0029` can fail on apply, by design — and that is the safe outcome.** It
drops three tables that shipped in `0000_init` and were never used, and it does
not take that on trust: it counts `agents`, `drivers` and `routes` first and
`RAISE EXCEPTION`s, aborting the whole migration, if the total is not zero.

```
Refusing to drop: agents=0, drivers=1, routes=0. …
```

A failure means something started using a table this migration deletes. Find out
what; do not force it through. The drops run in FK order (routes → drivers →
agents) with **no `CASCADE`** — Drizzle generated `CASCADE` and it was removed,
because it would silently take dependents with it and the whole claim is that
there are none.

⚠️ **`0033` rewrites every `bookings` row.** Eight `ADD COLUMN`s (cheap —
nullable, no default, metadata-only since PG 11), then one `UPDATE … FROM
addresses` touching every booking, then four `SET NOT NULL`s that each scan the
table. It holds `ACCESS EXCLUSIVE` on `bookings` for the whole transaction —
milliseconds at present volumes, and the ordinary rule if that ever changes:
backfill in batches out-of-band first, so the in-transaction `UPDATE` finds
nothing to do.

The migration also **changes what reads are correct**. After it, the pickup
address on a booking is `bookings.pickup_*`, and `pickup_address_id` is
provenance that can be `NULL`. Any query that joins `addresses` to render a
booking's doorstep is now wrong and will start returning nothing the first time
a customer deletes a saved address — which is precisely the deletion this
migration exists to permit.

ℹ️ **`0028` reports what it backfilled**, and a gap is not a failure:

```
NOTICE:  addresses: backfilled 8 row(s) from ZIP centroids; 0 row(s) left
         without coordinates (ZIP not in zip_centroids)
```

A row without coordinates renders "ETA on the way" rather than a guess. The
NOTICE names the ZIPs so you can decide whether
`packages/db/src/zip-centroids.ts` needs widening.

⚠️ **`0017` can fail on apply, by design.** It drops `bags_seal_id_idx` and
builds a partial unique index in its place, so it **refuses to build if
duplicate seal ids already exist** — which is the whole reason it exists
(duplicates were observed in agent testing). Get the list first; a failed
migration is a worse way to learn it:

```sql
SELECT seal_id, count(*), array_agg(id)
  FROM bags WHERE seal_id IS NOT NULL
 GROUP BY seal_id HAVING count(*) > 1;
```

Clear or correct any rows it returns **before** applying. See
[agent-visit §3.3](features/agent-visit.md#33--a-seal-id-identifies-exactly-one-bag-operation-wide)
for what a duplicate actually means.

⚠️ **Not `CONCURRENTLY`** — drizzle's migrator runs all pending migrations in
one transaction, and `CREATE INDEX CONCURRENTLY` cannot run in a transaction
block. The plain build takes a `SHARE` lock on `bags`, blocking writes to that
table for the duration — milliseconds at present volumes. If `bags` ever grows
past that, build the index out-of-band with `CONCURRENTLY` first; the statement
is then a no-op thanks to `IF NOT EXISTS`.

The commit that introduced `0017` notes it must reach hosted before that code
deploys. Confirm the actual applied state with `pnpm db:status` against the
target — per the note below, don't trust this table for it.

> **Note:** older docs state that `0012` is "applied locally but not yet
> hosted". That predates the hash-based drift check. Verify current state with
> `pnpm db:status` against the hosted URL rather than trusting any written
> claim, including this table.

---

## 9. Deploying a migration

**The normal path is automatic** — see §9.5: merging into `dev` or `main`
applies pending migrations to that branch's database via GitHub Actions. The
manual procedure below remains for first-time project setup, for anything the
ordering caveat in §9.5 rules out, and for recovery.

1. `pnpm db:status` against the target — **confirm the `Target host:` line**.
2. Apply over a **stable-session** connection (`DIRECT_DATABASE_URL`, port 5432) — the session pooler (`aws-0-<region>.pooler.supabase.com:5432`)
   counts; see §3's IPv6 gotcha. Through the **transaction** pooler (6543)
   you get `prepared statement does not exist` errors in production that
   will not reproduce locally.
3. `pnpm db:status` again — expect _"In sync — nothing pending"_.
4. Reference data — **only on a project that has nothing to lose.**
   `pnpm seed` REFUSES a non-local database
   ([seed-guard.ts](../packages/db/src/seed-guard.ts)), because it is not
   additive: it resets all 128 `airline_cutoffs` rows to the placeholder
   45/60 minutes and rewrites the active pricing rule field by field. On a
   project where ops has verified cutoffs or set launch prices, a routine
   re-seed destroys the one data nobody can re-derive from this repository.

   On a **brand-new** hosted project, day one, before anybody has verified
   anything, say so out loud:

   ```bash
   SEED_ALLOW_HOSTED=1 DATABASE_URL='<hosted pooled url>' pnpm seed
   ```

   On any project already carrying real values, enter launch data in the
   **admin console** instead — `/pricing`, `/cutoffs`, `/agreements`,
   `/trucks`, `/shifts`, `/zones`. The ordered version of that is
   [docs/runbooks/prod-bringup.md](runbooks/prod-bringup.md). CI never seeds;
   this step is always yours.

⚠️ `pnpm seed` also creates dev staff/customer accounts — but **only** when the
Supabase host is `127.0.0.1`/`localhost`. A non-local host is a **hard skip, not
a warning**, and `SEED_ALLOW_HOSTED` does not lift it: seeding known passwords
into a hosted project would be a standing backdoor. Use `pnpm bootstrap:staff`.

---

## 9.5 CI: migrations apply automatically on merge

[.github/workflows/migrate.yml](../.github/workflows/migrate.yml) runs on
every push to `dev` or `main` that touches `packages/db/drizzle/**` (or the
migrator/status scripts), and applies pending migrations to **that branch's
database**:

| Branch | Database                    | Secret                     |
| ------ | --------------------------- | -------------------------- |
| `main` | production Supabase project | `PROD_DIRECT_DATABASE_URL` |
| `dev`  | dev/hosted Supabase project | `DEV_DIRECT_DATABASE_URL`  |

After applying, the workflow runs `db:status`: the applied set must match the
checkout **by content hash**, so drift fails the run red instead of hiding.

### The secrets

- **Value:** the project's **session pooler** URL —
  `postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres`.
  Never the transaction pooler (6543 — no DDL, no advisory lock), and never
  the `db.<ref>.supabase.co` direct host — that one is **IPv6-only and GitHub
  runners have no IPv6**, so you get `ENETUNREACH` (learned the hard way,
  first run, 2026-08-23).
- **Where they live:** GitHub **repository** secrets work on every plan.
  **Organization** secrets also work — same `${{ secrets.NAME }}` lookup, a
  repo-level secret of the same name wins — but check two things: the org
  secret's _repository access policy_ must include this repo, and on the
  GitHub **Free** org plan, org secrets are only visible to **public**
  repositories.
- A missing/invisible secret is a **hard failure** ("No DIRECT_DATABASE_URL
  secret configured"), never a silent skip.

### Failure and retry

The migrator's advisory lock plus a per-branch concurrency queue make
overlapping merges safe. A red run is re-runnable from the **Actions** tab
("Re-run jobs") once the cause is fixed — migrations already applied are
skipped, same as always.

### ⚠️ The ordering caveat

The workflow runs **in parallel** with the Vercel deploy of the same push —
neither waits for the other. That is safe exactly as long as migrations stay
**backward-compatible** (expand → deploy → contract, the discipline in §2/§7):
for a moment, old code may run against the new schema or new code against the
old. A migration the currently-deployed code cannot survive (dropping or
renaming something still read) must NOT ride this workflow — do a manual,
sequenced deploy instead (§9), and say so in the PR.

#### `0033` broke this, and rode the workflow anyway

`0033_military_liz_osborn` is **not backward-compatible**, and it merged to
`dev` through this workflow like any other migration. Nothing on this page said
so, which left a reader to assume — reasonably — that every migration in this
repo is expand-safe. It is the one that is not.

**What it did, in one migration:** added eight `pickup_*` columns to `bookings`
(expand), backfilled them from `addresses` (migrate), then set four of them
`NOT NULL` (**contract**). That last step is a contract, and it shipped in the
same step as the expand.

**Neither order is clean**, which is what makes it different from an ordinary
expand:

| Order                                     | What breaks                                                                                                                  |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **Migration first**, old code still serving | Old `createBooking` omits `pickup_line1` and the rest → **`NOT NULL` violation → every new booking fails**                   |
| **Code first**, migration not yet applied   | New code reads and writes columns that do not exist → **booking reads and writes fail**                                      |

So there is a window either way, and it lasts **as long as the Vercel build**.
On `dev` that was harmless — no traffic. On `main` the identical merge is a
**booking-creation outage of the same length**.

The expand-safe version would have been two migrations across two deploys: add
nullable and backfill, deploy code that writes both old and new, then constrain
in a later migration once nothing writes the old shape. That is the discipline;
`0033` skipped the middle step.

🧭 **The rule going forward.** A migration that contracts in the same step as it
expands — `SET NOT NULL`, a new `CHECK` or `UNIQUE` on existing data, a drop, a
rename — **must be called out in the PR and sequenced manually per §9.** It must
not ride the automatic workflow on `main`. Deciding to take the window is
allowed; discovering it afterwards is not.

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
