# Scripts & Commands

> **Every command in this repo, what it actually does, and when to reach for it.**
> Baseline: `dev` @ `5db21a4`. Related: [ENVIRONMENT.md](ENVIRONMENT.md) ·
> [MIGRATIONS.md](MIGRATIONS.md)

---

## 1. Quick reference

Run everything from the **repo root** unless noted.

### Everyday

| Command                             | Does                                                                 |
| ----------------------------------- | -------------------------------------------------------------------- |
| `pnpm local:dev`                    | **Cold start:** Docker → Supabase → migrate → seed → then `pnpm dev` |
| `pnpm local:status`                 | Read-only status board: infra _and_ app ports                        |
| `pnpm dev`                          | All three apps — web `:3000`, agent `:3001`, admin `:3002`           |
| `pnpm build`                        | Turbo build across the workspace                                     |
| `pnpm lint` / `pnpm typecheck`      | ESLint / `tsc --noEmit` everywhere                                   |
| `pnpm test`                         | Unit tests. **Needs no database**                                    |
| `pnpm format` / `pnpm format:check` | Prettier write / check                                               |
| `pnpm clean:cache`                  | Delete build caches only — **no reinstall after**, just `pnpm dev`   |
| `pnpm clean`                        | Turbo clean + delete `node_modules` (needs `pnpm install` after)     |

### Database

| Command                                    |    Connects?    | Does                                                   |
| ------------------------------------------ | :-------------: | ------------------------------------------------------ |
| `pnpm db:generate`                         |     **no**      | Diff the schema, write a new migration file            |
| `pnpm db:status`                           | yes (read-only) | Drift report. **Safe against production**              |
| `pnpm db:migrate`                          |       yes       | Apply pending migrations over `DIRECT_DATABASE_URL`    |
| `pnpm db:studio`                           |       yes       | drizzle-kit Studio                                     |
| `pnpm seed`                                | **local only**  | Reference data. REFUSES a non-local host — see §3.6    |
| `pnpm seed:local`                          |       yes       | Same seed, **pinned to the local stack**               |
| `pnpm --filter @koolee/db bootstrap:staff` |       yes       | Mint the **first** staff account on a DB that has none |
| `pnpm --filter @koolee/db create:staff`    |       yes       | Create a whole dev staff roster (2 admins + 5 agents)  |

⚠️ Everything above except `db:generate` reads `packages/db/.env`, which points
at the **hosted** project. See [ENVIRONMENT.md §6](ENVIRONMENT.md#6-packagesdbenv-points-at-local--hosted-only-by-explicit-override).

### Test environment

| Command                | Does                                                                       |
| ---------------------- | -------------------------------------------------------------------------- |
| `pnpm test:env:up`     | Stand up local Supabase + migrate + verify. Idempotent. Writes `.env.test` |
| `pnpm test:env:verify` | Read-only assertions against the local DB                                  |
| `pnpm test:env:doctor` | Diagnose without changing anything                                         |
| `pnpm test:env:reset`  | Wipe local DB, re-apply migrations                                         |
| `pnpm test:env:down`   | Stop the stack (**data volumes persist**)                                  |
| `pnpm test:db:setup`   | Create/migrate/mark the disposable `koolee_test` DB only                   |
| `pnpm test:db:drop`    | Delete `koolee_test`                                                       |

### Other

| Command                                       | Does                                                                                                                                                                                                                                                           |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev:inngest`                            | Inngest dev server against `localhost:3000/api/inngest`                                                                                                                                                                                                        |
| `pnpm --filter @koolee/ui storybook`          | Storybook on `:6006`                                                                                                                                                                                                                                           |
| `pnpm --filter @koolee/core test:integration` | Integration suites (see §4)                                                                                                                                                                                                                                    |
| `pnpm env:verify`                             | Does an environment have the variables its apps refuse to boot without? Reads NAMES, never values — see §8                                                                                                                                                     |
| `pnpm check:sw-headers`                       | Asserts `/sw.js` still gets `no-cache` + `Service-Worker-Allowed` after `withSentryConfig` composes the Next config. Both failure modes are silent                                                                                                             |
| `node scripts/copy-maplibre-worker.mjs <dir>` | Copies MapLibre's tile-parsing worker into an app's `public/maplibre/`. **Not run by hand** — it is the first half of `apps/web`'s `dev` and `build`, and of `packages/ui`'s `storybook`. See below                                                            |
| `pnpm push:vapid`                             | Generate the VAPID keypair for Web Push. Prints four values; paste **the same four into all three apps**. Regenerating invalidates every stored subscription — see [ENVIRONMENT §4.5](ENVIRONMENT.md#45--web-push-all-four-vapid-vars-or-none--all-three-apps) |

### `pnpm clean:cache` — the one to run periodically

Removes `apps/*/.next` (output **and** both caches), `.turbo/cache`, and every
`*.tsbuildinfo`. All of it is regenerated by the next `dev` or `build`.

**`node_modules` is deliberately untouched, so there is no `pnpm install`
afterwards** — start the dev server and carry on. That is the whole difference
between this and `pnpm clean`.

Why it earns a script: `apps/*/.next/dev` is Next 16's turbopack DEV cache. It
grows with every dev session and never self-trims — measured at **39 GB for
`apps/web` alone**, ~49 GB across the three apps. It is by a wide margin the
largest reclaimable thing in the repo; everything else put together is under a
gigabyte.

```bash
pnpm clean:cache --dry     # list what would go, delete nothing
pnpm clean:cache           # delete
pnpm clean:cache --force   # delete with a dev server running (see below)
```

**It refuses while `next dev` is running, on purpose.** A live dev server
recreates files as fast as `rm` removes them, so the delete fails half-done
with `Directory not empty` and leaves the server serving a tree that no longer
matches what it compiled — observed, the first time this ran. Stop the dev
servers, then clean.

---

## 2. Local development from cold

### 2.1 — The one-command path (preferred)

| Command             | Does                                                  |
| ------------------- | ----------------------------------------------------- |
| `pnpm local`        | Docker → Supabase → migrate → test DB → verify → seed |
| `pnpm local:dev`    | All of the above, then hands off to `pnpm dev`        |
| `pnpm local:status` | Read-only: what is actually running right now         |
| `pnpm local:down`   | Stop the stack (**data volumes persist**)             |
| `pnpm local:reset`  | Wipe + re-migrate the local DB, then reseed           |

```bash
pnpm install
pnpm local:dev          # cold machine → three running apps
```

[`scripts/local.sh`](../scripts/local.sh) is an **orchestrator, not a second
implementation**. Everything involving a database is delegated to
`test-env.sh`, which owns the preflight, migrations, the disposable
`koolee_test` database, the `assert_local` guard, and the verify assertions.
What `local.sh` adds is the steps that sat outside it and had to be run by hand:
**starting Docker Desktop** (waits up to 120s), **seeding**, and a **single
status board covering infra _and_ app ports**.

**Local only.** Every database URL in it is hardcoded to `127.0.0.1`, and
`test-env.sh` refuses any non-local host. **There is no flag that points this at
staging or production, by design.**

### 2.2 — The equivalent long-hand

```bash
pnpm test:env:up        # local Supabase + Postgres, migrated, verified
pnpm seed:local         # reference data + dev staff/customer accounts
pnpm dev                # three apps
```

`test:env:up` writes `.env.test` and is **idempotent** — safe to re-run any
time. It is also the only supported way to get a database with GoTrue's `auth`
schema locally; `docker compose up -d` gives you a bare Postgres 16 on port
`5433` **with no auth schema**, which the integration suites and `seed:local`
cannot use.

---

## 3. `scripts/test-env.sh` — the local stack

The database authority. `local.sh` delegates to it; the most important thing in
it is the safety model.

```
./scripts/test-env.sh up             stand up + migrate + verify (idempotent)
                      verify         read-only assertions
                      reset          wipe local DB, re-apply migrations
                      down           stop the stack (volumes persist)
                      doctor         diagnose, change nothing
                      setup-test-db  create/migrate/mark koolee_test only
                      drop-test-db   delete koolee_test
```

### 3.1 — Two databases, one container

| Database      | URL                           | Who uses it                               |
| ------------- | ----------------------------- | ----------------------------------------- |
| `postgres`    | `127.0.0.1:54322/postgres`    | Dev servers. **Your real local bookings** |
| `koolee_test` | `127.0.0.1:54322/koolee_test` | Integration suites. **Disposable**        |

The suites delete rows between tests, so they get their own database rather than
the one your dev work lives in. It is a second database inside the _already
running_ container — no extra service, no extra memory. Drop it any time;
`test-env.sh up` rebuilds it.

### 3.2 — The marker table makes it enforceable

`__koolee_test_database` is a marker table in `koolee_test`.
`packages/core/vitest.global-setup.ts` **refuses to run** unless it finds that
table — so a mispointed `TEST_DATABASE_URL` fails closed instead of emptying
your dev database.

### 3.3 — The local-host assertion

Every subcommand that touches a database refuses to run unless the resolved
`DATABASE_URL` host is `127.0.0.1` or `localhost`. **There is no bypass flag,
by design** — seeding known passwords into a hosted project would be a standing
backdoor.

Detail: [packages/core/docs/local-test-env.md](../packages/core/docs/local-test-env.md).

### 3.4 — Bootstrapping staff on a hosted database

The same refusal makes a fresh hosted project unbootstrappable: `pnpm seed`
skips the staff roster on any non-local Supabase host, and the admin console's
invite flow needs an admin session to reach. `bootstrap:staff` is the one-time
escape hatch, and it is safe on hosted because it carries **no credentials of
its own** — you supply the email and password at the call site, so nothing
about the account is knowable from this repository (it rejects a password
shorter than 12 characters or one matching the seeded `koolee-*-dev-N` shape).

```bash
SUPABASE_URL='https://<ref>.supabase.co' \
SUPABASE_SERVICE_ROLE_KEY='<service_role key>' \
DATABASE_URL='postgresql://postgres.<ref>:<pw>@...pooler.supabase.com:6543/postgres' \
BOOTSTRAP_EMAIL='you@example.com' \
BOOTSTRAP_PASSWORD='<something you choose>' \
pnpm --filter @koolee/db bootstrap:staff
```

It creates the GoTrue user with `email_confirm` already set, then upserts
`public.users` and `staff_members` **against the same auth id** — that id
equality is the entire join. Invite everyone else from `/staff` afterwards.

### 3.5 — Creating a whole dev roster

`create:staff` is the bulk sibling: one positional argument (the database
URL) and it stands up 2 admins + 5 agents, printing the generated passwords
once at the end. Generated — not published in the source like `seed.ts`'s
roster — is what makes it safe to point at a hosted dev project.

```bash
SUPABASE_SERVICE_ROLE_KEY='<service_role key>' \
pnpm --filter @koolee/db create:staff -- \
  'postgresql://postgres.<ref>:<pw>@...pooler.supabase.com:6543/postgres'
```

The Supabase project is **derived** from the connection string — a Supavisor
URL carries the project ref in its username — so the auth users and the
`public.users` rows pointing at them cannot end up in different projects.
Only the service-role key has to be supplied, and for a local target it is
read out of the `.env.test` that `pnpm test:env:up` writes.

| Flag                    | Default        | Does                                                     |
| ----------------------- | -------------- | -------------------------------------------------------- |
| `--admins <n>`          | `2`            | How many admin accounts                                  |
| `--agents <n>`          | `5`            | How many agent accounts (all get `can_drive`)            |
| `--domain <d>`          | `koolee.local` | Email domain for the generated addresses                 |
| `--password <pw>`       | generated      | One shared password for every account (min 8 chars)      |
| `--password-prefix <p>` | generated      | Predictable passwords: `<p>-admin-1`, `<p>-agent-3`      |
| `--reset-existing`      | off            | Reset an existing account's password instead of skipping |
| `--zones`               | off            | Round-robin every covered ZIP across the created agents  |

`--password-prefix dev` gives you `dev-admin-1` … `dev-agent-5` — memorable
for a roster you sign into all day. A predictable password is only as private
as its pattern and the pattern is in the source, so the prefix is yours to
choose rather than hardcoded; against a non-local database the script prints a
warning rather than refusing.

Idempotent, and it does not touch an account that already exists unless you
pass `--reset-existing` — so running it against local will not clobber the
seeded `koolee-*-dev-N` passwords. Without `--zones` the agents have no
coverage, which means auto-assign will not pick them.

Each account's `users` + `staff_members` rows go in **one transaction**, and
the run ends by reading `staff_members` back and printing it. Both exist
because `users.role` is not the authorization boundary — `requireStaffRole`
consults `staff_members` and nothing else, so an account with only a `users`
row signs in successfully and is then refused by every page. A per-account
failure (most often a leftover `public.users` row holding the same email under
a different id) is reported and skipped rather than aborting the roster.

**Passwords live in `auth.users`, not in `public.users`.** Copying
`public.users` + `staff_members` between databases moves role assignments and
nothing else: the rows point at auth ids that do not exist on the target, so
GoTrue reports "invalid login credentials" for every one of them.

### 3.6 — Why `pnpm seed` refuses a non-local database

Two independent refusals live in the seed, and they protect different things.

| Refusal                                                                                                      | Protects                                         | Bypass                                         |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ | ---------------------------------------------- |
| The **staff/customer roster** skips any non-local _Supabase_ host (§3.3)                                     | Known passwords becoming a standing backdoor     | **None.** Use `bootstrap:staff` (§3.4)         |
| The **whole seed** refuses any non-local _database_ host ([seed-guard.ts](../packages/db/src/seed-guard.ts)) | Verified airline cutoffs and tuned launch prices | `SEED_ALLOW_HOSTED=1`, brand-new projects only |

The second one is newer and less obvious. `pnpm seed` is idempotent with
respect to **itself**, not with respect to a human's work: it resets all 128
`airline_cutoffs` rows to the placeholder 45/60 minutes (overwriting `source`,
which is where the provenance of a verified value lives) and rewrites the
active `pricing_rules` row field by field to the hardcoded `launch-v1`
numbers. Both are exactly what ops replaces by hand before real sales, and the
cutoff matrix decides whether a pickup can make its flight — so the failure is
silent, undiffable and safety-critical.

Launch data therefore has one home, and it is not this script:

| Data                             | Where it is entered                                    |
| -------------------------------- | ------------------------------------------------------ |
| Airline cutoffs                  | admin `/cutoffs`                                       |
| Pricing rule                     | admin `/pricing`                                       |
| Booking agreement                | admin `/agreements`                                    |
| Fleet, staff, zones, `can_drive` | admin `/trucks`, `/staff`, `/zones`, `/shifts`         |
| Coverage ZIPs                    | `packages/db/src/coverage-zips.ts` — code, so a deploy |

The refusal names the host it refused and what it would have destroyed. If the
target really is a project with nothing to lose, say so out loud:

```bash
SEED_ALLOW_HOSTED=1 DATABASE_URL='<hosted pooled url>' pnpm seed
```

---

## 4. Testing tiers

| Tier            | Command                                          | Needs                                     |
| --------------- | ------------------------------------------------ | ----------------------------------------- |
| Unit            | `pnpm test`                                      | Nothing. Pure logic, fakes for every seam |
| Integration     | `pnpm --filter @koolee/core test:integration`    | A Postgres via `TEST_DATABASE_URL`        |
| Auth acceptance | same, with the local stack                       | Supabase GoTrue via `pnpm test:env:up`    |
| Integration, CI | `pnpm --filter @koolee/core test:integration:ci` | A Postgres, and nothing else — see §9     |

Integration suites are **opt-in**: without `TEST_DATABASE_URL` they
`describe.skip` rather than fail, so a fresh clone's `pnpm test` is green.

Note the integration script re-seeds afterwards regardless of outcome:

```
vitest run integration.test; rc=$?; pnpm --filter @koolee/db seed:local; exit $rc
```

⚠️ **Two sharp edges here.**

1. **Never run bare `npx vitest run` inside `packages/core`.** The package's own
   `test` script excludes `**/*.integration.test.ts`; bypassing it pulls the
   integration suites into a run that was not set up for them.
2. `.env.test` may point `TEST_DATABASE_URL` at the same local Postgres the dev
   servers use. The teardown re-seeds the dev roster automatically, but it
   **cannot restore a manually edited pricing rule** — after an integration run
   the active rule is the test fixture.

---

### `copy-maplibre-worker.mjs`, and why a map needs a build step

`node scripts/copy-maplibre-worker.mjs apps/web` copies two files —
`maplibre-gl-worker.mjs` **and** the `maplibre-gl-shared.mjs` it imports — out
of `node_modules` into `apps/web/public/maplibre/`. It runs automatically as
the first half of that app's `dev` and `build`, and of `packages/ui`'s
`storybook` and `build-storybook`. The output is gitignored and regenerated
every time, so it cannot go stale against the installed version.

**Why it has to exist.** maplibre-gl 6 works out where its worker lives from
`import.meta.url`, and returns the EMPTY STRING when that is not an `http(s):`
URL — which under Turbopack, Vite, or any other bundler it is not. It then
calls `new Worker("")`, which resolves against the document, so the browser
fetches the current PAGE and tries to run the HTML as a module. MapLibre never
re-raises the Worker's error as a map error.

What that looks like: the style JSON, the TileJSON and the sprites all fetch
and return 200, the canvas mounts at the right size, the zoom buttons work, and
**not one tile is ever requested**. No error appears anywhere. Only `LiveMap`'s
ten-second deadline catches it, as an apology to the customer.

**If a fourth app ever mounts `LiveMap`, add this step to its scripts.**
Forgetting it produces exactly the silent failure above. `setWorkerUrl` in
`packages/ui/src/components/live-map.tsx` is the other half.

## 5. Per-package scripts

| Package           | Scripts                                                                                                                                              |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web`        | `dev` (`:3000`), `build`, `start`, `lint`, `typecheck`, `test`, `clean`                                                                              |
| `apps/agent`      | same, `:3001`                                                                                                                                        |
| `apps/admin`      | same, `:3002`                                                                                                                                        |
| `packages/core`   | `lint`, `typecheck`, `test` (excludes integration), `test:watch`, `test:integration`, `test:integration:ci`, `push:vapid`, `clean`                   |
| `packages/db`     | `db:generate`, `db:migrate`, `db:status`, `db:studio`, `seed`, `seed:local`, `bootstrap:staff`, `create:staff`, `test`, `lint`, `typecheck`, `clean` |
| `packages/ui`     | `lint`, `typecheck`, `test`, `storybook` (`:6006`), `build-storybook`, `clean`                                                                       |
| `packages/config` | none — config-only package                                                                                                                           |

Target one with `pnpm --filter <name> <script>`, e.g.
`pnpm --filter @koolee/core test:watch`.

---

## 6. Ports

| Port    | Service                                                    |
| ------- | ---------------------------------------------------------- |
| `3000`  | `apps/web` (customer)                                      |
| `3001`  | `apps/agent` (field PWA)                                   |
| `3002`  | `apps/admin` (ops console)                                 |
| `5433`  | Bare Postgres 16 via `docker compose` — **no auth schema** |
| `6006`  | Storybook                                                  |
| `54321` | Local Supabase API                                         |
| `54322` | Local Supabase Postgres — **this is the one you want**     |

---

## 7. Choosing a command

| I want to…                   | Run                                                               |
| ---------------------------- | ----------------------------------------------------------------- |
| Start working (cold machine) | `pnpm local:dev`                                                  |
| Know what's running          | `pnpm local:status`, or `pnpm test:env:doctor` for DB-only detail |
| Change the schema            | `pnpm db:generate` → review SQL → `pnpm db:migrate`               |
| Check prod's migration state | `pnpm db:status` (read-only, safe)                                |
| Recover a broken local DB    | `pnpm test:env:reset` then `pnpm seed:local`                      |
| Run the fast tests           | `pnpm test`                                                       |
| Run the real ones            | `pnpm --filter @koolee/core test:integration`                     |
| Work on a shared component   | `pnpm --filter @koolee/ui storybook`                              |
| Test webhooks locally        | `stripe listen --forward-to localhost:3000/api/webhooks/stripe`   |
| Run background jobs locally  | `pnpm dev:inngest`                                                |

---

## 8. `pnpm env:verify` — the env pass, before deploying

Production runs `NEXT_PUBLIC_LAUNCH_MODE=coming_soon`, which **exempts
`apps/web` from most of its boot gates**. Flipping to `live` arms them all in
one redeploy, so launch day would otherwise be the first time several of them
ever fired — and a gate that fires is a deploy that does not serve. This asks
the same question the boot does, without deploying.

```bash
pnpm env:verify --file apps/web/.env.local          # a dotenv-style file
vercel env ls production | pnpm env:verify --stdin  # a Vercel scope
pnpm env:verify                                     # the current process env
```

| Flag                           | Does                                                               |
| ------------------------------ | ------------------------------------------------------------------ |
| `--app web\|admin\|agent\|all` | Which app's requirements. Default `all`                            |
| `--live`                       | Arm the launch-mode gates — **rehearse the flip before making it** |
| `--push`                       | Arm the VAPID requirements                                         |
| `--strict`                     | Fail on `recommended` too, not just required                       |

**It reads NAMES, never values.** Nothing is printed but a variable name and
why it matters, so the output is safe to paste anywhere — and it proves a row
EXISTS for a scope, not that the row holds the right value. That second
question belongs to a deploy and to
[cutover-rehearsal.md](runbooks/cutover-rehearsal.md).

`--live` and `--push` are flags rather than inferences for the same reason: it
cannot read `NEXT_PUBLIC_LAUNCH_MODE`'s value, only its presence.

The inventory is [`scripts/env-manifest.json`](../scripts/env-manifest.json) —
names and reasons, derived from the boot gates in `apps/*/src/env.ts`. **It is
the prod env pass checklist**, and it is the file to update when a gate is
added. It also carries a `forbidden` list: `apps/agent` must never hold
`SUPABASE_SERVICE_ROLE_KEY` or `STRIPE_SECRET_KEY`, and a run that finds one
exits non-zero.

A worked example lives at
[`docs/launch/env-sample-production.env`](launch/env-sample-production.env) —
every value is the literal word `set`, which is all the checker needs:

```bash
pnpm env:verify --app web --file docs/launch/env-sample-production.env --live --push
# ✓ apps/web: 17 required variables present
```

---

## 9. Continuous integration

Two workflows, and **only one of them has ever held a database credential.**

| Workflow                        | Trigger                                                     | Touches a hosted database              |
| ------------------------------- | ----------------------------------------------------------- | -------------------------------------- |
| `.github/workflows/ci.yml`      | every PR to `dev`/`main`, every push to them                | **No.** Never. No secret exists for it |
| `.github/workflows/migrate.yml` | pushes to `dev`/`main` that change `packages/db/drizzle/**` | Yes — this is its whole job            |

### 9.1 — What CI runs, and the local equivalent of each step

Every step is a command you can run yourself. There is nothing in the
pipeline that only exists inside GitHub.

| CI step             | Run it locally                                   |
| ------------------- | ------------------------------------------------ |
| Format              | `pnpm format:check` (`pnpm format` to fix)       |
| Typecheck           | `pnpm typecheck`                                 |
| Lint                | `pnpm lint`                                      |
| Unit tests          | `pnpm test`                                      |
| Build (3 apps)      | `pnpm build`                                     |
| Bootstrap + migrate | see 9.3                                          |
| Integration tests   | `pnpm --filter @koolee/core test:integration:ci` |

### 9.2 — The build step supplies no environment, deliberately

`apps/*/src/env.ts` promises two things: importing it never throws, and every
production gate is exempt during `phase-production-build`. A build on a
machine with no credentials is that promise being kept. Verified by building
this branch in a clean `git worktree`, which carries no `.env.local` —
3/3 apps, green.

If a build ever needs a variable to _compile_, that is a regression in the
zero-config-boot rule, not a reason to add a secret to this workflow.

### 9.3 — The integration job's database

An ephemeral `postgres:16-alpine` service container, created and destroyed
with the job, on `127.0.0.1`. To stand up the same thing locally:

```bash
docker run -d --name koolee-ci-probe \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=koolee_test -p 55432:5432 postgres:16-alpine

URL='postgresql://postgres:postgres@127.0.0.1:55432/koolee_test'
psql "$URL" -v ON_ERROR_STOP=1 -f scripts/ci-postgres-bootstrap.sql
DIRECT_DATABASE_URL="$URL" pnpm --filter @koolee/db db:migrate
DIRECT_DATABASE_URL="$URL" pnpm --filter @koolee/db db:status   # 34 of 34, by hash
TEST_DATABASE_URL="$URL" AUTH_SCHEMA_AVAILABLE=false \
  pnpm --filter @koolee/core test:integration:ci

docker rm -f koolee-ci-probe
```

**Why the bootstrap script.** `packages/db/README.md` says the migrations run
against a plain Postgres. They do not: `0008` writes `storage.buckets` with no
guard and the run dies there. The migrations cannot be corrected — `db:status`
compares the applied set to the checkout **by content hash**, so editing an
applied migration is permanent drift against every hosted database — so
[`scripts/ci-postgres-bootstrap.sql`](../scripts/ci-postgres-bootstrap.sql)
creates the small Supabase surface they reach for instead: three roles,
`auth.uid()`, `storage.buckets`/`storage.objects`,
`storage.foldername()`, the `supabase_realtime` publication, and the
`__koolee_test_database` marker the vitest guard demands.

Those objects are **not faithful reproductions of Supabase's**. They are the
smallest shapes that let the DDL apply. Nothing may come to depend on them.

### 9.4 — The two suites CI does not run

`upgrade-guard.integration.test.ts` and `staff-auth.integration.test.ts`
exercise real GoTrue phone/email resolution and the invite + reset mail flow.
Both **throw rather than skip** when `AUTH_SCHEMA_AVAILABLE` is not `"true"`,
on purpose — silently skipping is how that coverage would rot. A Postgres
container cannot satisfy them, and running eleven Supabase containers per CI
run for two files is not a trade this pipeline makes.

They are part of the local gate instead:

```bash
pnpm test:env:up
pnpm --filter @koolee/core test:integration    # all 321, GoTrue included
```

**Run them before opening a PR.** CI covers 311 of the 314 non-GoTrue
integration tests; it does not cover these.

### 9.5 — What is deliberately not cached

The pnpm store is cached (`actions/setup-node` with `cache: pnpm`). Turbo's
build cache is **not**. `.next/dev` once put 616 GB into `.turbo/cache` on one
machine — the exclusion in `turbo.json` fixes the cause, but an Actions cache
has a 10 GB budget for the entire repository and a poisoned build cache costs
more to diagnose than the minutes it saves.

### 9.6 — Concurrency

A second push to a pull request cancels the run it superseded. Runs on `dev`
and `main` themselves are **never** cancelled: a merged commit with no verdict
against it is worse than a duplicate run.
