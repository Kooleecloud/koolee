# Local test environment

One command up, one command down. Everything runs against the Supabase CLI
stack on `127.0.0.1` — the script refuses any other host, with no bypass flag.

## One-time prerequisites

- **Docker Desktop** — the stack is containers. `open -a Docker` before `up`.
- **Supabase CLI** — `brew install supabase/tap/supabase`.
- **psql** — `brew install libpq && brew link --force libpq` (verify only; no server needed).

## The five commands

| Command | When to use it |
| --- | --- |
| `pnpm test:env:up` | Start of a work session. Idempotent — safe to re-run any time; skips whatever is already done and never regenerates `OTP_LOG_HMAC_KEY`. |
| `pnpm test:env:verify` | Quick "is my environment actually correct?" — five read-only assertions, PASS/FAIL per line. |
| `pnpm test:env:reset -- --yes` | Clean slate: wipes local data, re-applies Drizzle migrations, re-verifies. Without `--yes` it asks you to type `RESET`. |
| `pnpm test:env:down` | End of session. Data persists across stop/start; only `supabase stop --no-backup` deletes it. |
| `pnpm test:env:doctor` | Something is confusing. Prints Docker/stack health, which env file wins, the resolved DB host (never credentials), and the config.toml values. |

After `up`, run the integration tests with:

```sh
pnpm --filter @koolee/core test:integration
```

`.env.test` (repo root, git-ignored) is loaded by `packages/core/vitest.config.ts`,
so `TEST_DATABASE_URL` and `AUTH_SCHEMA_AVAILABLE` need no manual exporting.

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

| Symptom | Cause and fix |
| --- | --- |
| `no SMS provider is enabled` during start | Phone login is silently off. Enable `[auth.sms.twilio]` with the dummy credentials above, then `supabase stop && pnpm test:env:up`. |
| `public` schema empty after a reset | `supabase db reset` only replays `supabase/migrations` (there are none). Re-run Drizzle migrations: `pnpm test:env:up` or `pnpm test:env:reset -- --yes`. |
| SSL error connecting locally | The client forces TLS at a plaintext local Postgres. `packages/db` picks SSL by host (`127.0.0.1`/`localhost` → off); make sure your URL host is actually local — `pnpm test:env:doctor` shows it. |
| Migrations "succeed" but the local DB is empty | They went to a different database. Env precedence: shell `DIRECT_DATABASE_URL` > shell `DATABASE_URL` > `packages/db/.env.local` > `packages/db/.env` > root `.env.local` > root `.env` — and `packages/db/.env` points at the **cloud** project. Run `pnpm test:env:doctor` to see which source wins. |
