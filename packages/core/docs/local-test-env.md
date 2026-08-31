# Local test environment

One command up, one command down. Everything runs against the Supabase CLI
stack on `127.0.0.1` — the script refuses any other host, with no bypass flag.

## One-time prerequisites

- **Docker Desktop** — the stack is containers. `open -a Docker` before `up`.
- **Supabase CLI** — `brew install supabase/tap/supabase`.
- **psql** — `brew install libpq && brew link --force libpq` (verify only; no server needed).

## The commands

| Command                        | When to use it                                                                                                                                                                                                          |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm test:env:up`             | Start of a work session. Idempotent — safe to re-run any time; skips whatever is already done and never regenerates `OTP_LOG_HMAC_KEY`.                                                                                 |
| `pnpm test:env:verify`         | Quick "is my environment actually correct?" — eight assertions, PASS/FAIL per line. Seven are read-only (including three that check `koolee_test` exists, carries its marker, and matches the dev schema); the other writes and deletes one throwaway `otp_send_log` row to prove the migrate role can still use the table. |
| `pnpm test:env:reset -- --yes` | Clean slate: wipes local data, re-applies Drizzle migrations, re-verifies. Without `--yes` it asks you to type `RESET`.                                                                                                 |
| `pnpm test:env:down`           | End of session. Data persists across stop/start; only `supabase stop --no-backup` deletes it.                                                                                                                           |
| `pnpm test:env:doctor`         | Something is confusing. Prints Docker/stack health, which env file wins, the resolved DB host (never credentials), and the config.toml values.                                                                          |
| `pnpm test:db:setup`           | Create/migrate/mark the disposable `koolee_test` database and point `.env.test` at it — without touching the dev database. For picking this separation up on a checkout whose stack is already healthy.                 |
| `pnpm test:db:drop`            | Delete `koolee_test`. It holds nothing anyone needs; `test:env:up` rebuilds it.                                                                                                                                          |

After `up`, run the integration tests with:

```sh
pnpm --filter @koolee/core test:integration   # 71 tests, 11 files (+1 opt-in, ALLOW_DEV_DB_WIPE=1)
pnpm --filter @koolee/core test               # 216 unit tests, 13 files, no DB
```

The unit suite excludes `*.integration.test.ts` and needs nothing running. The
integration files skip themselves when `TEST_DATABASE_URL` is unset, which is
what keeps `pnpm test` green on a fresh clone.

`.env.test` (repo root, git-ignored) is written by `up` and loaded by
`packages/core/vitest.config.ts`, so `TEST_DATABASE_URL`,
`AUTH_SCHEMA_AVAILABLE`, `SUPABASE_URL`, the anon/service-role keys, and
`OTP_LOG_HMAC_KEY` all need no manual exporting. Anything already exported in
your shell still wins — dotenv never overrides.

## Two databases: which one the tests touch

One Postgres container, two databases. This is the thing to understand before
running anything, because getting it wrong used to delete real bookings.

| Database      | Who uses it                                                | Safe to wipe? |
| ------------- | ---------------------------------------------------------- | ------------- |
| `postgres`    | The dev servers, GoTrue/Storage, the bookings you make      | **No**        |
| `koolee_test` | Nine of the twelve integration suites                       | Yes — that is its whole purpose |

`koolee_test` is a second database inside the container that is already
running — no extra service and no extra memory. It is built by cloning the dev
database's *structure* with `pg_dump --schema-only` (plus a copy of Drizzle's
migration journal so the migrator knows where it stands) and zero rows. The
clone is necessary because the Drizzle migrations cannot build a database on
their own: they create RLS policies over `storage.objects`, insert the
`bag-photos` row into `storage.buckets`, and call `auth.uid()` — all of which
only exist in the database Supabase's own services provision.

### The guard

`packages/core/vitest.global-setup.ts` refuses to start a run unless
`TEST_DATABASE_URL` names a database carrying the `__koolee_test_database`
marker table, which only `test-env.sh` ever creates. It asks the database what
it is rather than trusting the variable name, the database name, or the
command you typed — so a copied `.env`, a stale shell export, or
`npx vitest run` instead of `pnpm test` all stop with a message instead of
emptying your data. If you ever see:

```
[vitest] REFUSING TO RUN: database "postgres" has no __koolee_test_database marker
```

run `pnpm test:db:setup`. That is the guard working, not a bug.

### The three suites that cannot be isolated

`upgrade-guard`, `staff-auth`, and `booking-ownership` drive the real GoTrue
API *and* read `auth.users` over SQL in the same connection they assert app
tables on. GoTrue only ever serves `postgres`, and Postgres cannot join across
databases, so these three have to run there. They read
`GOTRUE_TEST_DATABASE_URL`, not `TEST_DATABASE_URL`.

- `upgrade-guard` and `staff-auth` **preserve** what is already in the
  database: `snapshotExistingRows` records the primary keys present before the
  suite starts, and cleanup deletes only what appeared since
  (`src/test-utils/preserve-existing-rows.ts`). Ownership cannot be read off a
  column here — `upgrade-guard` signs in anonymous users, which have no email
  — and `created_at` is not reliable either, because `otp_send_log` rows carry
  a caller-supplied timestamp that these suites deliberately set in the past.
  Primary keys are the one thing that always distinguishes a new row.
- `booking-ownership` **wipes**, and is therefore **skipped by default**. It
  seeds its own `airports`, `airline_cutoffs`, and `pricing_rules`, which
  collide with the dev seed, and forcing its values over them would leave your
  reference data quietly rewritten. Run it only when losing local data is
  fine:

  ```sh
  ALLOW_DEV_DB_WIPE=1 pnpm --filter @koolee/core test:integration
  ```

  It prints a message saying exactly this whenever it skips.

Rows are `DELETE`d, never truncated (`custody_events` refuses `TRUNCATE` — the
append-only trigger doing its job), and the deletes run under
`session_replication_role = replica` so FK order does not matter.

`vitest.global-setup.ts` also re-seeds the dev roster on teardown if the admin
account or an active pricing rule has gone missing. Nothing should remove them
any more; it stays as a regression net.

Nothing in the seed goes stale on its own: pickup windows are virtual,
computed per flight, so there is no slot inventory to re-create.

## Required `supabase/config.toml` block

The script checks these four values and fails `up` if any is missing — it
never edits `config.toml` for you:

```toml
[auth]
enable_anonymous_sign_ins = true   # booking funnel starts as an anonymous session

[auth.email]
double_confirm_changes = false     # email changes confirm once, matching the funnel's reconcile logic

[auth.sms.test_otp]                # deterministic OTPs: no Twilio, no cost, no real SMS
15555550100 = "123456"

[auth.sms.twilio]                  # dummy creds ONLY to un-gate phone login locally;
enabled = true                     # test_otp intercepts before any real provider call
account_sid = "test"
message_service_sid = "test"
auth_token = "test"
```

`config.toml` carries four `1555555010x` numbers for the integration tests.
They are safe _because_ they are fictional, which also means the web app's
phone-number validation rejects them at the form — so a valid-format number
sits alongside them for manual UI testing. `up` prints the whole list.

## Why plain Postgres is not enough

GoTrue (Supabase Auth) owns the `auth.users` table and implements the
`phone_change` → `phone` resolution flow that acceptance tests 15 and 16
exercise. A hand-created `auth` schema on a bare Postgres has the columns but
none of the behavior, so those tests would pass vacuously or fail confusingly.
Run the real stack.

Also keep `[db] major_version` in `config.toml` equal to the cloud project's
major version (`SHOW server_version;` in the SQL editor) — migrations that
pass locally on a different major version can still fail in the cloud.

## Where migrations live (the classic trap)

Koolee's migrations are Drizzle files in `packages/db/drizzle`, **not**
`supabase/migrations`. `supabase db reset` therefore leaves an **empty**
`public` schema — `test:env:reset` re-applies Drizzle migrations for you, but
if you ever reset by hand, don't forget that step.

## Troubleshooting

| Symptom                                        | Cause and fix                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `no SMS provider is enabled` during start      | Phone login is silently off. Enable `[auth.sms.twilio]` with the dummy credentials above, then `supabase stop && pnpm test:env:up`.                                                                                                                                                                                                                                                                                                                                                                                       |
| `public` schema empty after a reset            | `supabase db reset` only replays `supabase/migrations` (there are none). Re-run Drizzle migrations: `pnpm test:env:up` or `pnpm test:env:reset -- --yes`.                                                                                                                                                                                                                                                                                                                                                                 |
| SSL error connecting locally                   | The client forces TLS at a plaintext local Postgres. `packages/db` picks SSL by host (`127.0.0.1`/`localhost` → off); make sure your URL host is actually local — `pnpm test:env:doctor` shows it.                                                                                                                                                                                                                                                                                                                        |
| Migrations "succeed" but the local DB is empty | They went to a different database. Env precedence: shell `DIRECT_DATABASE_URL` > shell `DATABASE_URL` > `DIRECT_DATABASE_URL` from the first file that sets it > `DATABASE_URL` from the first file that sets it — files searched in the order `packages/db/.env.local`, `packages/db/.env`, root `.env.local`, root `.env`. So a `DIRECT_DATABASE_URL` in _any_ file beats a `DATABASE_URL` in _any_ file. Since 2026-08-22 `packages/db/.env` defaults to the **local** stack, so the usual cause is now a stale shell export or a leftover `.env.local`, not the file itself. Run `pnpm test:env:doctor` to see which source wins. |
