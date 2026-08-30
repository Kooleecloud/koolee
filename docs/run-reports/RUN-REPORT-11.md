# Run report 11 — Tier 5: launch readiness

**Branch:** `feat/tier5-launch-readiness`, cut from `origin/dev` @ `728bcea`
with `--no-track`. Verified before any work:

```
$ git config --get branch.feat/tier5-launch-readiness.merge   # empty (exit 1)
$ git status -sb
## feat/tier5-launch-readiness                                # no upstream
```

**One session, one branch. Commits are made here, one per phase**, at TD's
explicit instruction in the slice hand-off — the slice prompt's "no commits"
default is overridden for this run. Nothing is pushed; no PR is opened.

**Databases touched: LOCAL ONLY** (`127.0.0.1:54322`) and the disposable
`koolee_test` for the integration tier. Hosted is never contacted.

**Ground truth:** [REPORT-tier5-preflight.md](REPORT-tier5-preflight.md). Every
claim this report makes about the starting state cites a section of it; where
the slice prompt and the report disagreed, the resolution is recorded in place.

**One extra brief from TD, outside the slice prompt:** _reusability_. Before
any new component, check whether the repo already has one — the driver-tracking
progress strip drew its own dots and rails while the rest of the product used
the shared `CustodyTimeline` motif, and the two did not match. That audit and
its fix are Phase 2.5.

---

## Phase 0 — Seed safety + doc truth

### 0.1 The hosted seed guard

`pnpm seed` now refuses any non-local database.

New: [packages/db/src/seed-guard.ts](../../packages/db/src/seed-guard.ts).
`assertSeedTargetAllowed(connectionString, env)` returns
`{kind: "local"}` / `{kind: "hosted-allowed"}` or throws
`HostedSeedRefusedError`. Local means a fixed list — `127.0.0.1`, `::1`,
`localhost`, `host.docker.internal`, and the two docker-compose names
(`postgres`, `koolee-postgres`) — deliberately **not** a private-range pattern,
because a pattern that admits `10.x` also admits a bastion or an SSH tunnel to
production, which is the case the guard exists to stop. An unparseable
connection string is treated as non-local: an unknown target is not a local
target.

Wired at [seed.ts](../../packages/db/src/seed.ts) `main()`, **after** the
existing `Target host:` print and **before** `createDb` — nothing opens a
socket to a database the run is about to refuse. The refusal is caught at the
bottom of the file and printed as its own message rather than as a stack trace.

Why it matters, restated from report §3.2, §3.3, §6.6: the seed is idempotent
with respect to _itself_, not to a human's work. It resets all 128
`airline_cutoffs` rows to the placeholder 45/60 minutes (overwriting `source`,
where a verified value's provenance lives) and rewrites the active pricing rule
field by field. The cutoff matrix decides whether a pickup can make its flight.

The escape hatch is `SEED_ALLOW_HOSTED=1` — for a brand-new hosted project on
day one. It accepts any truthy value (`1`, `true`, `yes`) and treats
`0`/`false`/blank as unset. It does **not** lift the older, separate refusal on
the staff roster: `seedLocalStaff` still hard-skips any non-local _Supabase_
host, because those passwords are published in the source file.

Demonstrated (no database contacted — the guard throws before `createDb`):

```
$ DATABASE_URL='postgresql://u:p@aws-0-us-east-1.pooler.supabase.com:6543/postgres' pnpm seed
Target host: aws-0-us-east-1.pooler.supabase.com

Seed REFUSED: 'aws-0-us-east-1.pooler.supabase.com' is not a local database.
…
If this really is a brand-new project with nothing to lose, re-run with SEED_ALLOW_HOSTED=1.
[ELIFECYCLE] Command failed with exit code 1.
```

**Tests.** `packages/db` had no test runner at all; it now has one (vitest 4,
matching every other package, `include: src/**/*.test.ts`) and
[seed-guard.test.ts](../../packages/db/src/seed-guard.test.ts) — 8 tests:
local hosts admitted, look-alike hosts refused (`127.0.0.1.evil.example.com`,
`10.0.0.5`, `notlocalhost`), the refusal message names the host and what it
would destroy, the override works for `1`/`true`/`yes` and not for
`0`/`false`/blank, an unparseable URL refuses, and an explicitly-passed env
beats a `SEED_ALLOW_HOSTED` exported in the developer's own shell (so a
refusal test cannot pass for the wrong reason).

### 0.2 The docs that told you to seed hosted

The report named two (§4.1 A6, §3.4). A repo-wide grep found **six** places
that instruct or imply it; all six are corrected, each pointing at the
admin-console path Phase 4 builds:

| File                                                       | Was                                                                       | Now                                                                                                  |
| ---------------------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `docs/MIGRATIONS.md` §9 step 4                             | "Seed reference data if the project is new: `pnpm seed` … Idempotent."    | Refusal explained; `SEED_ALLOW_HOSTED=1` for a brand-new project only; live projects use the console |
| `docs/features/driver-and-pickup-hosted-setup.md` §3       | `DATABASE_URL='<hosted pooled url>' pnpm seed` — "Idempotent, as always." | Same command behind the override, with "idempotent with respect to **itself**, not to ops's work"    |
| `docs/CODEBASE-MAP.md` (deploy order)                      | "`pnpm seed` with the hosted URL"                                         | Brand-new only, names what it overwrites                                                             |
| `docs/ARCHITECTURE.md` (deploy order)                      | "`pnpm seed` if the project is new"                                       | Same                                                                                                 |
| `docs/SCRIPTS.md` §1 table                                 | "`pnpm seed` — yes — Idempotent reference data"                           | "**local only** — REFUSES a non-local host — see §3.6"                                               |
| `docs/features/agreements-and-passport-hosted-setup.md` §4 | "Dev only — run the seed (`pnpm seed` against that project)"              | Names the refusal and the override                                                                   |

New section **`docs/SCRIPTS.md` §3.6 — "Why `pnpm seed` refuses a non-local
database"**: the two independent refusals (staff roster vs whole seed), what
each protects, which has a bypass, and the one-home table for launch data.

### 0.3 The contradictions

| #   | Report finding                                                                                                                                                                                         | Fix                                                                                                                                                                                                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | §4.6(1) — `ENVIRONMENT.md §6.6` still said "Hostname entries already cover subdomains", two sections below its own §5.2 correction. **This is the exact belief behind the Turnstile `110200` outage.** | Rewritten: each widget lists every hostname that mounts it; an entry covers that hostname and its own subdomains only; `dev.admin.koolee.cloud` sits under `admin.koolee.cloud`; never add the apex to the dev widget. Points at §5.2.                                                 |
| 2   | §4.6(2) — `jobs-and-notifications.md` said driver ETA is "a fixed estimate" (false since Tier 4) and that admin-raised exceptions do not emit (false since `apps/admin` injects `inngestEmitter`).     | Both corrected, in all three places they appear in that file (§1 status line, §2.0 bullet, §7 list). The ETA line now states the real property — pessimistic, so the monitor alerts early.                                                                                             |
| 3   | §4.6(3) — `apps/agent/src/env.ts` `fallback: "Route ETA uses a fixed estimate."` and `apps/web/.env.example` "Drive time uses a fixed estimate."                                                       | **Deferred to Phase 1, deliberately.** These are code strings attached to `GOOGLE_MAPS_API_KEY`, and Phase 1 replaces that variable and every hint around it. Fixing them here and again there is churn in the same branch; the resolution is recorded rather than the fix duplicated. |
| 4   | §4.6(4) — `docs/run-reports/README.md` omitted RUN-REPORT-9 and -10.                                                                                                                                   | Index now lists 9, 10, the Tier 5 preflight and this report.                                                                                                                                                                                                                           |

### 0.4 Gates

| Gate | Result |
| --- | --- |
| `turbo typecheck` | 6/6 |
| `turbo lint` | 6/6 |
| `turbo test` (unit) | 6/6 — core 513 passed / 1 skipped, web 134, ui 104, admin 32, agent 24, **db 8 (new)** |
| `pnpm --filter @koolee/core test:integration` (`koolee_test`) | 29 files passed / 1 skipped, 286 passed / 3 skipped |
| `pnpm seed:local` (the guard's happy path, run by the integration script's tail) | seeded 127.0.0.1 — 837 centroids, 128 cutoffs, launch-v1, 198 zones |
| Prod builds | not run — this phase touches no app code |

`packages/db` is a **sixth** task in each turbo run now that it has a `test`
script; the counts above are 6/6, not the 5/5 earlier reports show.
