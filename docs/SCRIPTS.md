# Scripts & Commands

> **Every command in this repo, what it actually does, and when to reach for it.**
> Baseline: `origin/dev` @ `b17a7de`. Related: [ENVIRONMENT.md](ENVIRONMENT.md) ·
> [MIGRATIONS.md](MIGRATIONS.md)

---

## 1. Quick reference

Run everything from the **repo root** unless noted.

### Everyday

| Command | Does |
| --- | --- |
| `pnpm dev` | All three apps — web `:3000`, agent `:3001`, admin `:3002` |
| `pnpm build` | Turbo build across the workspace |
| `pnpm lint` / `pnpm typecheck` | ESLint / `tsc --noEmit` everywhere |
| `pnpm test` | Unit tests. **Needs no database** |
| `pnpm format` / `pnpm format:check` | Prettier write / check |
| `pnpm clean` | Turbo clean + delete `node_modules` |

### Database

| Command | Connects? | Does |
| --- | :-: | --- |
| `pnpm db:generate` | **no** | Diff the schema, write a new migration file |
| `pnpm db:status` | yes (read-only) | Drift report. **Safe against production** |
| `pnpm db:migrate` | yes | Apply pending migrations over `DIRECT_DATABASE_URL` |
| `pnpm db:studio` | yes | drizzle-kit Studio |
| `pnpm seed` | yes | Idempotent reference data: airports, cutoffs, pricing rule |
| `pnpm seed:local` | yes | Same seed, **pinned to the local stack** |

⚠️ Everything above except `db:generate` reads `packages/db/.env`, which points
at the **hosted** project. See [ENVIRONMENT.md §6](ENVIRONMENT.md#6--the-sharpest-edge-packagesdbenv-points-at-hosted).

### Test environment

| Command | Does |
| --- | --- |
| `pnpm test:env:up` | Stand up local Supabase + migrate + verify. Idempotent. Writes `.env.test` |
| `pnpm test:env:verify` | Read-only assertions against the local DB |
| `pnpm test:env:doctor` | Diagnose without changing anything |
| `pnpm test:env:reset` | Wipe local DB, re-apply migrations |
| `pnpm test:env:down` | Stop the stack (**data volumes persist**) |
| `pnpm test:db:setup` | Create/migrate/mark the disposable `koolee_test` DB only |
| `pnpm test:db:drop` | Delete `koolee_test` |

### Other

| Command | Does |
| --- | --- |
| `pnpm dev:inngest` | Inngest dev server against `localhost:3000/api/inngest` |
| `pnpm --filter @koolee/ui storybook` | Storybook on `:6006` |
| `pnpm --filter @koolee/core test:integration` | Integration suites (see §4) |

---

## 2. Local development from cold

The full path from a fresh machine to a working stack:

```bash
pnpm install
pnpm test:env:up        # local Supabase + Postgres, migrated, verified
pnpm seed:local         # reference data + dev staff/customer accounts
pnpm dev                # three apps
```

`test:env:up` writes `.env.test` and is **idempotent** — safe to re-run any
time. It is also the only supported way to get a database with GoTrue's `auth`
schema locally; `docker compose up -d` gives you a bare Postgres 16 on port
`5433` with no auth schema, which the integration suites and `seed:local`
cannot use.

> 📌 **Uncommitted on your machine, not on `origin/dev`:** a
> `scripts/local.sh` orchestrator plus `pnpm local` / `local:dev` /
> `local:status` / `local:down` / `local:reset` wiring in `package.json`. It
> collapses the above into one command and adds Docker Desktop startup and a
> status board covering infra *and* app ports. It delegates every
> database step to `test-env.sh` rather than reimplementing it. **It is not
> committed** — treat this section as the committed path until it lands.

---

## 3. `scripts/test-env.sh` — the local stack

11KB+30KB of bash, and the most important thing in it is the safety model.

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

| Database | URL | Who uses it |
| --- | --- | --- |
| `postgres` | `127.0.0.1:54322/postgres` | Dev servers. **Your real local bookings** |
| `koolee_test` | `127.0.0.1:54322/koolee_test` | Integration suites. **Disposable** |

The suites delete rows between tests, so they get their own database rather than
the one your dev work lives in. It is a second database inside the *already
running* container — no extra service, no extra memory. Drop it any time;
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

---

## 4. Testing tiers

| Tier | Command | Needs |
| --- | --- | --- |
| Unit | `pnpm test` | Nothing. Pure logic, fakes for every seam |
| Integration | `pnpm --filter @koolee/core test:integration` | A Postgres via `TEST_DATABASE_URL` |
| Auth acceptance | same, with the local stack | Supabase GoTrue via `pnpm test:env:up` |

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

## 5. Per-package scripts

| Package | Scripts |
| --- | --- |
| `apps/web` | `dev` (`:3000`), `build`, `start`, `lint`, `typecheck`, `test`, `clean` |
| `apps/agent` | same, `:3001` |
| `apps/admin` | same, `:3002` |
| `packages/core` | `lint`, `typecheck`, `test` (excludes integration), `test:watch`, `test:integration`, `clean` |
| `packages/db` | `db:generate`, `db:migrate`, `db:status`, `db:studio`, `seed`, `seed:local`, `lint`, `typecheck`, `clean` |
| `packages/ui` | `lint`, `typecheck`, `storybook` (`:6006`), `build-storybook`, `clean` |
| `packages/config` | none — config-only package |

Target one with `pnpm --filter <name> <script>`, e.g.
`pnpm --filter @koolee/core test:watch`.

---

## 6. Ports

| Port | Service |
| --- | --- |
| `3000` | `apps/web` (customer) |
| `3001` | `apps/agent` (field PWA) |
| `3002` | `apps/admin` (ops console) |
| `5433` | Bare Postgres 16 via `docker compose` — **no auth schema** |
| `6006` | Storybook |
| `54321` | Local Supabase API |
| `54322` | Local Supabase Postgres — **this is the one you want** |

---

## 7. Choosing a command

| I want to… | Run |
| --- | --- |
| Start working | `pnpm test:env:up && pnpm seed:local && pnpm dev` |
| Know what's running | `./scripts/test-env.sh doctor` |
| Change the schema | `pnpm db:generate` → review SQL → `pnpm db:migrate` |
| Check prod's migration state | `pnpm db:status` (read-only, safe) |
| Recover a broken local DB | `pnpm test:env:reset` then `pnpm seed:local` |
| Run the fast tests | `pnpm test` |
| Run the real ones | `pnpm --filter @koolee/core test:integration` |
| Work on a shared component | `pnpm --filter @koolee/ui storybook` |
| Test webhooks locally | `stripe listen --forward-to localhost:3000/api/webhooks/stripe` |
| Run background jobs locally | `pnpm dev:inngest` |
