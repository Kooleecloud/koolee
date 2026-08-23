# Run report 3 — waitlist persistence + dispatch close-out + email (three units)

Autonomous run, 2026-08-22. Commit-per-phase (project-scoped permission);
nothing pushed — TD reviews, pushes, and opens all PRs manually.

**Branch topology** (stacked so migration numbering stays sequential):

```
origin/dev ── feat/waitlist-persistence (Unit 1, migration 0018)
                 └── feat/dispatch-close-out-and-email (Unit 2, migration 0019+)
                        └── (Unit 3: waitlist zone-opened notify, stacked)
```

PR order on return: Unit 1 → dev, merge; Unit 2 → dev, merge; Unit 3 → dev.

---

## Unit 1 — waitlist persistence (`feat/waitlist-persistence`)

**Status: complete, all gates green.**

What shipped:

- **Migration 0018** (`0018_vengeful_odin.sql`, house-style header added):
  `waitlist_source` enum + `waitlist_signups` table — unique `(email, zip)`
  pair, `zip` NOT NULL, nullable `notified_at`, `created_at`. RLS auto-enabled
  by 0016's `ensure_rls` event trigger; no policies needed (server-only access
  via core). **Applied LOCAL only** (via `test:env:up`'s idempotent migrate).
- **Core**: `recordWaitlistSignup(db, {email, zip, source})` in
  `packages/core/src/waitlist/` — lowercases email, validates defensively
  (new `InvalidInputError` + `INVALID_INPUT` code in `errors.ts`), idempotent
  `ON CONFLICT (email, zip) DO NOTHING`; returns `{created}`. Exported through
  core's index (apps never import @koolee/db).
- **Web**: `/waitlist` `joinWaitlist` — ZIP now **required** (zod + form
  `required` + page copy updated); covered-ZIP → /book redirect unchanged;
  real persist with `source: "waitlist_page"`; DB-down or insert failure →
  honest error state (the old stub returned fake success).
  `captureOutOfAreaEmail` — gains ZIP validation, persists with
  `source: "booking_out_of_area"`. Remaining TODO narrowed to notify-only.
- **Design decisions** (agreed with TD): no `zip_under_coverage` /
  `email_exists` columns — live questions answered at read time; snapshots go
  stale exactly when the notify flow would trust them.
- **Tests**: 5 integration tests (`record-signup.integration.test.ts`) —
  create, idempotent duplicate pair, case-insensitive email, same-email
  second-zip, invalid input rejected before insert.
- **Docs**: PROJECT-STATUS row 56 + "Last updated"; booking-funnel feature doc.

Gates:

| Gate | Result |
| --- | --- |
| turbo typecheck (db, core, web) | ✅ 3/3 |
| turbo lint (db, core, web) | ✅ 3/3 |
| core unit tests | ✅ 229 passed |
| core integration tier (koolee_test) | ✅ 81 passed / 3 skipped (12 files) |
| web production build | ✅ |

Notes / deferred:

- First integration run right after cold `test:env:up` exited 1; clean rerun
  was fully green — cold-stack warm-up, not a code failure. Watch on next run.
- **TD manual step: hosted migration.** `waitlist_signups` does not exist on
  hosted until you run the migrate against it (blast radius: one new empty
  table + one enum, no locks on existing tables, reversible with
  `DROP TABLE waitlist_signups; DROP TYPE waitlist_source;`).
- Docker Desktop + Supabase local stack were started as part of this run.
- The pre-existing CODEBASE-MAP.md edit stays stashed
  (`stash: codebase-map edit (pre-waitlist-branch)`), untouched by this run.

---

## Unit 2 — dispatch close-out + email slice (`feat/dispatch-close-out-and-email`)

_Not started yet — begins after Unit 1's commit, stacked on its tip.
Phases 0–6 per SLICE-PROMPT-tier1-tier2.md, plus Vercel Analytics as
Phase 0 item 7._

## Unit 3 — waitlist zone-opened notification

_Not started yet — stacks on Unit 2 (needs `waitlist_signups` + ResendNotifier)._
