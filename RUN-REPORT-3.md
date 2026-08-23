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

Stacked on Unit 1's tip. Phases per SLICE-PROMPT-tier1-tier2.md, plus Vercel
Analytics as Phase 0 item 7.

### Phase 0 — small fixes batch ✅

1. **migrate.ts** — `client.end()` moved into `finally`; a failed migration
   now exits non-zero instead of hanging on the open connection (#48).
2. **Agent weight input** — `step="0.01"` (0.1 rejected real scale readings).
3. **Admin /exceptions airport-local times** — **already fixed upstream**:
   the page renders every row via `formatInstantInAirportTz` +
   per-airport `getDisplayZones`. Verified, no change needed.
4. **Customer trip page `<title>`** — `generateMetadata` returns
   `"<flight> · <airport> pickup"`; the detail fetch is wrapped in React
   `cache()` so metadata + page share ONE query, and auth is inside the
   loader (no identifying title for someone else's booking).
5. **Copy fixes** — "Leo· confirmed": real text space replaces the `ml-2`
   margin (accessible text was missing the space). "3/3bags sealed":
   **already fixed upstream** in visit-flow (the `{" "}` fix, with comment).
6. **packages/db/.env → LOCAL default** — machine-local `.env` flipped to
   127.0.0.1:54322; hosted now requires an inline URL override (shell beats
   dotenv). Committed counterparts updated: `.env.example` (local-first with
   hosted override recipe) and `docs/MIGRATIONS.md` (warning block rewritten).
7. **Vercel Analytics** — `@vercel/analytics@^2.0.1` added to apps/web,
   `<Analytics />` next to `<SpeedInsights />` in the root layout.

Gates: turbo typecheck+lint 12/12 · unit tests 4/4 packages · core
integration 81 passed/3 skipped · web+agent prod builds ✅.

## Unit 3 — waitlist zone-opened notification

_Not started yet — stacks on Unit 2 (needs `waitlist_signups` + ResendNotifier)._
