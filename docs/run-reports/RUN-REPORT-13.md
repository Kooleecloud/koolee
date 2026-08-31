# Run report 13 — Slice F4: fixes, latent traps, CI, and on-behalf shifts

**Branch:** `fix/f4-fixes-and-ci`, cut from `origin/dev` @ `78d2d5d` with
`--no-track`. Verified before any work:

```
$ git config --get branch.fix/f4-fixes-and-ci.merge   # empty (exit 1)
$ git status -sb
## fix/f4-fixes-and-ci                                # no upstream
```

**One session, one branch. Phase-sized commits are made here** — the policy
codified from runs 10–11. **Nothing is pushed; no PR is opened.** TD reviews,
pushes and merges.

**Databases touched: LOCAL ONLY.** `127.0.0.1` throughout — the local stack,
the disposable `koolee_test`, and throwaway `postgres:16-alpine` containers
created and destroyed inside this session. Hosted is never contacted.

**Not RUN-REPORT-12.** The slice prompt names `RUN-REPORT-12.md`; that file
already exists on `dev` and belongs to the UX pass. Reports are history and are
never overwritten (`docs/run-reports/README.md`), and report 10 was very nearly
lost to exactly this mistake one run ago. TD chose 13.

---

## TD's manual items this slice creates

Read this section first; the rest is the record.

- **30-second dev sanity:** create one booking on dev, which closes the 0033
  deploy-order question for dev.
- **After merge:** watch the first real CI run on the PR itself. Expect the
  formatting commit to dominate the diff stats — 247 files, zero content.
- **Before opening the PR:** run the two integration suites CI cannot
  (`pnpm test:env:up && pnpm --filter @koolee/core test:integration`). CI covers
  311 of 314 non-GoTrue integration tests and none of those two.
- **Ratify:** the commit policy, and the four calls below.

## The calls TD made, and what the evidence said

The slice prompt embedded two defaults (D1, D2) and named symptoms that did not
all match the code. Every divergence was put to TD before any of it was built.

| #   | The prompt said                                                                      | What was actually there                                                                                                                                                                                                      | TD's call                                                                      |
| --- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| D1  | Wire `reserved_spaces` into capacity                                                 | Column exists, four read paths compute `bag_capacity − bagsOnBoard`, nothing subtracts the reserve                                                                                                                           | **Wire it** (as written)                                                       |
| D2  | Grant `authenticated` SELECT on `custody_events`; "verify the two existing policies" | **One** policy, not two (customer-sees-own, from 0001). No staff policy exists. And 0031's own header records that it _deliberately_ did not widen this table, because nothing subscribes to it                              | **Reverse it** — remove from the publication. The prompt's own escape hatch    |
| —   | Add h1, links and tables to the renderer                                             | `agreement-markdown.ts` documents links/tables/images as deliberately absent with reasons; the admin editor tells operators so on screen; the v2 draft body uses none of them, so "sweep the draft" yields zero new branches | **Build all three anyway**, and rewrite the three documents that say otherwise |
| —   | "Admin agreement preview tab renders raw source"                                     | There is no preview tab. There is a live Tiptap WYSIWYG, and no read-only view of a published version at all                                                                                                                 | **Read-only version view**, no editor preview toggle                           |
| —   | Stamp the admin in a "custody-style/audit record" for on-behalf shifts               | `custody_events.booking_id` is NOT NULL and a shift touches no booking; `admin_audit_log` is P19, deferred and unbuilt                                                                                                       | **New `started_by_user_id` column** on `driver_shifts`                         |

Two items arrived from TD mid-session and are **not in the slice prompt**. They
land here as Phase 7: the customer trip map failing to load, and an admin
control to remove a driver assignment rather than only reassign it.

---

## Phase 0 — CI

Two commits: `f9c125a` (formatting baseline) and `8ff41c2` (the workflow).

### 0.1 The formatting baseline came first, not second

The prompt orders the workflow before the baseline. Reversed deliberately:
`format:check` was red on **247 files** when this branch was cut, so a workflow
committed first would have been born failing over work nobody in this slice
touched. One formatting-only commit, then a pipeline that lands green.

**Verified formatting-only two ways.** A whitespace-and-comma-insensitive hash
of every changed file against `HEAD` left 62 files still differing; diff
spot-checks over those found only prettier's own normalisations — single to
double quotes in `postcss.config.mjs`, a JSX ternary collapsed onto one line in
`step-form.tsx`, a leading `|` dropped from a union type short enough to fit in
`nav.ts`, markdown table padding realigned. The gates agree: typecheck 6/6,
lint 6/6, **907 unit tests** green after the rewrite.

### 0.2 The finding: the migrations do not run on a plain Postgres

`packages/db/README.md` says they do — "the migration still runs against a
plain Postgres 16 (docker-compose, CI)". That is true of 0001's RLS block,
which is guarded, and of 0022/0023/0026/0027, which all test
`to_regclass('storage.buckets')` first. It is **not** true of 0008 and 0009,
which write `storage.buckets`, create policies on `storage.objects` and call
`auth.uid()` with no guard whatsoever.

Measured, not reasoned about. Against a throwaway `postgres:16-alpine`:

```
PostgresError: relation "storage.buckets" does not exist
  code: '42P01'  ← migration 0008
```

**The migrations cannot be fixed.** `db:status` compares the applied set to the
checkout **by content hash**; editing an applied migration is permanent drift
against hosted dev and, later, prod. So the environment moves to meet the
migrations: `scripts/ci-postgres-bootstrap.sql` creates three roles,
`auth.uid()`, `storage.buckets` / `storage.objects`, `storage.foldername()`,
the `supabase_realtime` publication, and the `__koolee_test_database` marker
the vitest guard fails closed without. The objects are the smallest shapes the
DDL touches and are explicitly **not** faithful to Supabase's own.

Rehearsed end to end locally before it was written down:

```
BOOTSTRAP OK
Migrations applied.
Applied:  34 of 34 (matched by content hash)
Test Files  29 passed | 1 skipped (30)
     Tests  311 passed | 3 skipped (314)     22.72s
```

### 0.3 The build step is given no environment, and that is the test

`apps/*/src/env.ts` promises importing it never throws and that every
production gate is exempt during `phase-production-build`. CI supplies nothing,
which turns that promise into an assertion. Proven before writing it down by
building this branch in a clean `git worktree` — which carries no `.env.local`
— with a completely empty environment: **3/3 apps, exit 0.**

### 0.4 What CI deliberately does not do

- **It cannot reach a hosted database.** No secret exists for it and none can
  be obtained. `migrate.yml` is untouched and remains the only workflow that
  connects to one.
- **It does not run two integration suites.** `upgrade-guard` and `staff-auth`
  need a real GoTrue and **throw rather than skip** without one — correct, since
  silently skipping is how that coverage rots. Eleven Supabase containers per
  run for two files is not a trade this pipeline makes.
  `test:integration:ci` excludes them by name and `docs/SCRIPTS.md` §9.4 puts
  them in the local pre-PR gate instead. **This is the one place CI is weaker
  than the prompt asked for; it is recorded rather than hidden.**
- **It does not persist Turbo's cache.** `.next/dev` once put 616 GB into it;
  an Actions cache has a 10 GB budget for the whole repository. The pnpm store
  is cached.

### 0.5 Concurrency

A second push to a PR cancels the run it superseded. Runs on `dev` and `main`
are never cancelled — a merged commit with no verdict against it is worse than
a duplicate run.

### 0.6 Gate

`format:check` clean · typecheck 6/6 · lint 6/6 · 907 unit tests · builds 3/3
(clean worktree, no env) · 311 integration tests on an ephemeral Postgres ·
`db:status` 34 of 34 by content hash.
