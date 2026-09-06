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

| Gate                                | Result                              |
| ----------------------------------- | ----------------------------------- |
| turbo typecheck (db, core, web)     | ✅ 3/3                              |
| turbo lint (db, core, web)          | ✅ 3/3                              |
| core unit tests                     | ✅ 229 passed                       |
| core integration tier (koolee_test) | ✅ 81 passed / 3 skipped (12 files) |
| web production build                | ✅                                  |

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

### Phase 1 — task uniqueness (migration 0019) ✅

Unique indexes on `verification_tasks(booking_id)` + `pickup_tasks(booking_id)`
(names `*_booking_id_key`, replacing the plain `*_idx`). The migration dedups
FIRST, deterministically — keep oldest by (created_at, id), `RAISE NOTICE` the
removals. Local apply: **zero duplicates found**, status 20/20 by hash.
Gates: typecheck+lint ✅ · integration 81 ✅ · db:status in sync.

### Phase 2 — on-paid auto-assign ✅

`autoAssignOnPaid(config, bookingId)` — never throws — fired by every path to
`paid`: webhook `moveBooking`, `/book/return` re-check (only when it performed
the move), and createBooking's inline fake-provider path (dev parity).
`assignAgentToBooking` catches the 23505 from a concurrent insert → reported
as `conflict` → mapped to `not_assignable` ("already assigned"), exactly as
the slice requires. No coverage keeps the booking paid-unassigned (board's
at-risk flag). System actor (`actor_user_id: null`) stamps automatic
assignments. Integration tests: the production race VERBATIM (webhook +
re-check via `Promise.all` → exactly one task pair, one assignment event), a
4-way hook burst (system-actor stamped), no-coverage never touches payment.
Gates: typecheck+lint ✅ · unit 229 ✅ · integration 84 ✅ (3 new).

### Phase 3 — seed integrity (migration 0020) ✅

1. `agent_zones` seeded: all **198** covered ZIPs round-robined (sorted ZIPs ×
   roster order) across the five dev agents — deterministic, re-runs converge
   (dev agents' zones replaced wholesale, others untouched). To make the ZIP
   list reachable from the seed WITHOUT a db→core cycle, the data moved to
   `@koolee/db/coverage-zips` (pure-data subpath — no Postgres driver in
   client bundles); core keeps all coverage logic, public API unchanged.
2. ONE active pricing rule: migration **0020** partial unique index
   (`active WHERE active`, dedup-first keep-newest); the seed's `limit(1)`
   heal replaced by convergence — deactivate all, upsert canonical
   `launch-v1` (lead-time curve + family discount). Local run verified:
   "launch-v1 inserted — the single active rule". History never deleted.
3. `dispatch.a/b@koolee-test.example`: verified they exist ONLY in the
   disposable `koolee_test` fixtures (wiped per run) — marked with a comment;
   nothing to remove from any seed.
   Gates: full turbo 16/16 ✅ · integration 84 ✅ · all three app builds ✅.

### Phase 4 — ResendNotifier ✅

`ResendNotifier` in `packages/core/src/notifications/resend/` (REST via
injectable fetch — no SDK dep, so no new ESLint carve-out is needed; the
directory carries the same only-place boundary as payments/stripe).
`createNotifier(NotifierConfig)` mirrors the Stripe factory; injected through
`createRuntime`'s new `notifications` option. apps/web: key present → Resend,
absent → console (dev unchanged); `RESEND_FROM` (sandbox-sender default,
documented); fail-closed prod boot gate (build-phase exempt — first attempt
broke credential-less builds, fixed to match the 4.2/4.4 gate pattern).
SMS deliberately untouched. Unit tests: payload shape, html omission, typed
error with status on non-2xx, network errors propagate, SMS never hits the
API. Gates: typecheck+lint ✅ · unit 235 ✅ · web build ✅.

### Phase 5 — email side effects (Inngest) ✅

Discovery that shaped the phase: `booking/confirmed` and
`booking/exception_raised` were catalogued but NEVER EMITTED — the existing
pickup-reminder function was dead code. Now:

- Emission (apps/web `lib/booking-events.ts`, no-throw, deterministic ids):
  `booking/confirmed` from all three paid paths, keyed on
  "this call performed the move" (`WebhookOutcome.movedTo` /
  `movedToPaid` on the reconcile result — both added) so redeliveries,
  refreshes, and lost races never re-fire; `booking/exception_raised` from
  the webhook payment-cancelled path.
- `booking-confirmation-email`: airport-tz window with abbreviation
  (docs/TIME.md formatters), address, bags, the breakdown PERSISTED at
  booking time (never recomputed), trip link (NEXT_PUBLIC_APP_URL).
- Pickup reminder: email channel added; both channels behind a shared
  reminder-worthy guard (`paid`/`agent_assigned` only).
- `exception-ops-alert-email` → OPS_ALERT_EMAIL (new env, injected via
  `createKooleeFunctions` options; unset = log+skip).
- Send failures inside functions: log + ops-alert, never thrown.
- Templates: pure builders, text always + simple HTML; copy rules PINNED by
  tests — "airline's bag drop", no check-in claims, Tag Orange #FF6B35 only
  on the CTA, html-escaped interpolation.
  Deferred, explicitly: admin-raised exception emission (apps/admin has no
  Inngest client today); real SMS (#15).
  Dev visibility: with no RESEND_API_KEY emails print via ConsoleNotifier to
  the dev-server console (Mailpit at :54324 carries only Supabase AUTH mail —
  not these). Live registration check (`pnpm dev:inngest`) left to TD's next
  dev session; the functions array now exports 7 functions (5 core + 2 crons),
  crons untouched.
  Gates: typecheck+lint ✅ · unit 243 ✅ · integration 84 ✅ · web build ✅.

### Phase 6 — docs + close-out ✅

ENVIRONMENT.md: §6 rewritten (LOCAL default, hosted-by-override), matrix rows
for RESEND_FROM/OPS_ALERT_EMAIL, new boot-gate §4.3b. PROJECT-STATUS: rows
15 → 🔨 (email shipped; SMS/AeroAPI/Maps open), 16 → 🔨 (email side effects
shipped; SMS + admin-exception emission open), 47 → ✅ (closed by 0019 +
on-paid trigger), snapshot updated.

Two failures surfaced in the first full-gate run, both fixed:

- `env.test.ts` "complete prod config" predated the new Resend gate — the
  gate working as designed. Stub now includes the key, and the gate itself is
  pinned by two new tests (missing key refuses a live prod boot; coming-soon
  boots without it).
- A PRE-EXISTING flake in `create-booking.integration.test.ts` (reproduced
  1-in-~5): the custody-trail assertion read event ORDER from an unordered
  SELECT — heap order, not insertion order. Fixed with an explicit
  `ORDER BY created_at` (the two events come from separate transactions).

**Final full gate: turbo 19/19 (typecheck+lint+test+build, every package and
all three apps) · web unit 59 · core unit 243 · integration 84 passed /
3 skipped, green on three consecutive runs.**

---

## PR texts (open in this order; each into `dev`)

### PR 1 — `feat/waitlist-persistence`

**Title:** `feat(waitlist): persist signups to a waitlist_signups table`

Both email-capture surfaces (the /waitlist page and the booking funnel's
out-of-area fork) were deliberate stubs — validated, logged, dropped. Now:
migration 0018 (`waitlist_signups`, unique (email, zip) pair — one row per
person-per-zone so demand counts stay honest; nullable `notified_at` as the
notify landing pad), a core idempotent-upsert seam, both actions wired, ZIP
now required on the waitlist form, honest error states replace fake success.
5 integration tests. Hosted owes `db:migrate` (see RUN-REPORT-3).

### PR 2 — `feat/dispatch-close-out-and-email` (after PR 1 merges)

**Title:** `feat: dispatch debt close-out + real email notifications (Tier 1+2 slice)`

Phases 0–6 of SLICE-PROMPT-tier1-tier2, 7 commits reviewable phase by phase:
small fixes + Vercel Analytics · migration 0019 one-task-per-booking
(dedup-first) · on-paid auto-assign from every payment path with the
webhook/re-check race integration-tested · migration 0020 one-active pricing
rule + seed convergence on canonical launch-v1 + agent zones for all 198
covered ZIPs (ZIP data moved to `@koolee/db/coverage-zips`, core API
unchanged) · ResendNotifier behind the seam with prod boot gate ·
booking/confirmed + exception events now actually emitted, confirmation/
reminder/exception emails with pinned copy rules · docs + close-out
(`packages/db/.env` LOCAL-default flip documented). Final gate: turbo 19/19,
243 unit / 84 integration, three consecutive green integration runs.
TD manual steps in RUN-REPORT-3 (hosted migrations, seed, Resend DNS + env).

### PR 3 — `feat/waitlist-zone-notify` (after PR 2 merges)

**Title:** `feat(waitlist): daily zone-opened sweep sends the promised "you're covered" email`

Closes the waitlist loop: a daily cron reconciles `notified_at IS NULL`
against live coverage (coverage is code, so "a zone opened" is a deploy),
emails newly covered signups exactly once, stamps on success, retries
failures next sweep. 3 integration tests + copy-rule tests.

---

## TD manual steps (in order, after review + push + merges)

> **Status 2026-08-23 (final): ALL DONE.** All three PRs merged (#8/#9/#10);
> `web/v0.2.0` released `dev → main` onto the **dedicated prod environment**
> (new Supabase project, us-east-2 — the old hosted project is dev-only
> now; see ENVIRONMENT §6.5). Prod migrated 21/21 by content hash + seeded;
> CI migration lanes proven green on both branches; Resend `koolee.cloud`
> domain **verified**; live smoke test passed — a real `/waitlist` signup
> persisted to prod `waitlist_signups`. Inngest Cloud app synced against
> `https://www.koolee.cloud/api/inngest` — **8 functions registered** on the
> production environment, crons armed. `bookings@koolee.cloud` alias created
> (replies to the transactional From land in the real inbox). The steps
> below are kept as the historical procedure.

1. ✅ **Hosted migrations** (one command, applies 0018 + 0019 + 0020):
   ```bash
   DIRECT_DATABASE_URL='postgresql://postgres.jpvlzoikcivxepgyrkho:<PASSWORD>@aws-0-ca-central-1.pooler.supabase.com:5432/postgres' \
     pnpm db:migrate
   ```
   Read the `Target host:` line. Blast radius: waitlist_signups table + enum
   (new, empty); task unique indexes (dedups duplicates keep-oldest — hosted
   likely has none, the NOTICE will say); pricing one-active index (dedups
   keep-newest). All additive; reversible by dropping the indexes/table.
2. ✅ **Hosted seed re-run** (converges pricing on canonical launch-v1; staff/
   zone seeding self-skips on non-local hosts):
   ```bash
   DATABASE_URL='<hosted pooler 6543 url>' pnpm --filter @koolee/db seed
   ```
3. 🔄 **Resend: verify the `koolee.cloud` domain** (BLOCKS real recipients —
   verified live 2026-08-23: the sandbox From only delivers to the Resend
   account's own address, `info@koolee.cloud`; anyone else gets a 403).
   resend.com/domains → add domain → publish the DKIM/SPF records → after
   verification set `RESEND_FROM=Koolee <notify@koolee.cloud>`.
4. ✅ **Vercel env vars (web project)**: Production — `RESEND_API_KEY`,
   `RESEND_FROM` (verified-domain From), `OPS_ALERT_EMAIL`, and
   `NEXT_PUBLIC_APP_URL` (absolute prod origin — without it emails ship with
   no "Track your trip" CTA; also set it in local `.env.local` to see the
   button in dev). Preview — optional; without a key previews log emails to
   console. Note: the prod boot gate only fires on live-mode deploys with
   Supabase configured; the current coming-soon deploy boots fine without
   the key.
5. **Local dev check** (optional): `pnpm dev:inngest` + a fake-provider
   booking → confirmation email prints on the dev-server console; the
   Inngest dev UI lists 8 registered functions. (Corrected 2026-08-28 from
   "7" — six come from `createKooleeFunctions`, plus `cleanup-anonymous-users`
   and `capture-due-bookings` defined in `apps/web/src/lib/inngest.ts`. Unit
   3's own section in this file already said 8.)

## Unit 3 — waitlist zone-opened notification (`feat/waitlist-zone-notify`)

**Status: complete, all gates green.** Stacked on Unit 2 — this is where
Units 1 and 2 meet: the table + `notified_at` column from Unit 1, the
notifier + template + jobs machinery from Unit 2.

Design decision (spec'd before code): coverage lives in CODE
(`@koolee/db/coverage-zips`), so "a zone opened" is a **deploy**, not a
database event. A daily reconciling sweep beats a trigger: nothing has to
remember to fire it, and it converges within a day of any coverage expansion.

- `notifyNewlyCoveredWaitlist` (core/waitlist): scan `notified_at IS NULL`
  (batch 200), skip still-uncovered ZIPs untouched, email covered ones via
  the notifier, stamp `notified_at` AFTER a successful send (crash between
  send and stamp = at-most-one duplicate next sweep — the right side of the
  trade against silently never sending). Failed sends stay queued; per-row
  isolation. One email per (email, zip) row on purpose.
- `buildZoneOpenedEmail`: "Koolee now covers <zip>", bag-drop wording,
  "this is the only waitlist email we send", orange only on the Book CTA —
  all pinned in the copy-rule tests.
- `waitlist-zone-opened-sweep` cron (10:00 ET daily) added to
  `createKooleeFunctions` — 8 registered functions now; the stub comment in
  `captureOutOfAreaEmail` updated to point at the sweep.
- Tests: 3 integration (stamp + skip-uncovered + failed-send-stays-queued /
  next-sweep-retries, via a per-recipient FlakyNotifier), 1 new copy test.

Gates: typecheck+lint ✅ · core unit 244 ✅ · integration 87 passed /
3 skipped ✅ · web prod build ✅.
