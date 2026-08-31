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

---

## Phase 1 — the markdown renderer family

Commit `01f6171`.

### 1.1 The prompt's hypothesis was wrong, and that is the finding

The slice named the `useMemo` client-trap that `markdown.tsx`'s own header
warned about. **The trap never sprang.** The same sweep that wrote the warning
(row 73, the `Avatar` fix) also added the `"use client"` directive that
defused it, so `/trips/[id]/agreement` — a server component — has always
rendered the component correctly. The prophecy was already its own fix.

What actually shipped is a different failure with an identical symptom.
`parseAgreementMarkdown` degrades anything it does not recognise to paragraph
text, and it recognised neither `#`, nor `[label](href)`, nor a table.
Reproduced against the real parser before anything was touched:

```
BLOCK paragraph [{"text":"# Koolee booking agreement"}]
BLOCK paragraph [{"text":"See our [privacy policy](https://koolee.cloud/privacy) …"}]
BLOCK paragraph [{"text":"| Item | Price | | --- | --- | | Base | $68 |"}]
```

Three reported symptoms — the customer page, the console, item #29 — are one
missing `case`.

### 1.2 The exclusions were never enforced, only documented

`agreement-markdown.ts` listed links and tables as deliberately absent with
good reasons, and the admin editor told operators so on screen. But nothing
enforced it: an operator who pasted a link got **gibberish in a legal
document**, not a refusal. "Unsupported" and "rendered as gibberish" are not
the same policy, and only the second was shipping. TD ratified building all
three end to end and rewriting the three documents that said otherwise.

### 1.3 An href is the one place a string becomes behaviour

Everything else in this pipeline is text. `safeLinkHref` — allow-list, not
deny-list: `http`, `https`, `mailto` — lives in the AST, so the markdown
parser, the editor-to-blocks conversion (an href from Tiptap is re-validated,
never trusted) and the toolbar all get the same answer. A refused URL keeps
its words and loses its link; silently deleting a phrase from a legal document
would be worse than showing it unlinked. Seven hostile schemes are tested,
`javascript:`, `data:`, `vbscript:`, `file:` and protocol-relative among them.

The href is stored NORMALISED (`new URL(...).href`), so the first save of a
pasted document may adjust it slightly. Idempotent from the second pass, which
is what keeps the round-trip contract true — asserted.

### 1.4 The admin console gains a read-only version view

Not the "preview tab" the prompt named — there is no tab, and there was no
read-only view of a published version **at all**. The only way to see what v1
said was to open it in `amend`, whose submit button publishes a NEW version.
"Let me check the wording" and "publish v3" were one click apart. TD chose the
version view over an editor preview toggle; Tiptap already shows formatted
text while you type.

### 1.5 Dependency delta

`@tiptap/extension-table@3.30.5` — **+1 package**, pinned to the version every
other Tiptap package already uses. `@tiptap/extension-link@3.30.5` was already
present transitively and is now a direct dependency. No transitive additions.

### 1.6 `packages/ui` can now test a server render

`markdown.test.tsx` runs through `react-dom/server`, which needs no DOM — so
the package keeps `environment: "node"` and the vitest `include` simply widens
to `.tsx`. It asserts the real agreement v2 draft body comes out formatted,
**and** that the component is server-safe at all: a hook anywhere in this tree
throws under `renderToStaticMarkup`, which is precisely the `Avatar` failure,
caught by a test instead of by a customer.

**This is not the DOM harness P20 asks for.** Nothing here clicks, types or
fires a blur, and the date-field regression that motivated P20 would still
pass. P20 stays open.

---

## Phase 2 — agreement absence

Commit `b3a9c95`.

Zero published versions is a **total outage of the pickup flow** — the gate
fails closed for every booking, which is correct — and all three surfaces
described it wrongly. The customer saw "Action needed / 1 thing to do" above
an empty row. The agent, at a doorstep, read "the customer has not accepted
our booking agreement yet"; there is no button for that customer to press. The
console said nothing at all, so the first symptom would have been an agent
unable to seal a bag.

`no_agreement_published` is now its own gate blocker. The gate still refuses —
that half must never change — and only the sentence differs. The customer gets
a calm holding state, **and the passport step opens**: it has no dependency on
an agreement, so holding the one thing a customer can get ahead on behind a
gate nobody can open was the worst of both. The console gets a banner naming
the consequence rather than the condition.

**A failed count reads `-1`, never `0`.** A database blip must not be able to
put "customers cannot complete check-in" on the Overview page; an alarm that
cries wolf is worse than none.

### Where the test lives, and why it is not in the integration tier

The obvious home for "an absent agreement is its own blocker" is the
integration tier, and it cannot go there. Every agent-visit suite seeds a
version (the gate needs a current to resolve against) and migration 0024
freezes a version once it is in effect:

```
PostgresError: agreement version 1 is in effect and cannot be deleted.
  code: 23001, where: agreement_versions_freeze_once_effective()
```

That is the guard working exactly as designed. `buildIdentityGate` is pure, so
it is exported and tested as one.

### Deviation: L4 was rewritten, not added beside

The prompt asked to ADD a launch-blocking line. L4 already was that item, and
the file's own rule is that nothing is owned by two people, so L4 now states
the outage and the deliberate absence of a boot gate — day-zero production has
to come up before v1 can be written in it.

---

## Phase 3 — the funnel, and cancelled bookings

Commits `1949aa4` and `7e96801`.

### 3.1 A refused ZIP cost the customer their whole form

Reproduced by reading the code path end to end. Three things had to be true at
once, and all three were:

1. `submitFlight` returned every rejection BEFORE `writeDraft`;
2. `usePreservedFormValues` covers the action round trip inside one mount, and
   the out-of-area card does not stay mounted — its retry is a real LINK;
3. `flightEntryMode` chooses between the door and the form on
   `draftHasFlight`, which is false precisely because the step never
   committed. **Being refused made you look like a first-time visitor.**

`rejectedEntrySchema` is a quarantined draft key per step, holding what was
typed including what was typed wrong — loosely typed on purpose, because a
strict schema would drop exactly the value the customer needs in order to
correct it. Quarantined for the same reason `ticketPrefill` is: a refused ZIP
in `draft.zip` would make `stepCompletion` read step one as complete.

Two existing tests asserted `writeDraft` was NOT called on a rejection. The
intent — no booking field is written until the customer chooses — is still
right and still tested; "nothing is written" was simply the wrong way to say
it. They now assert the **quarantine boundary** by enumerating the keys of the
write, which is a strictly stronger claim. The F1 ZIP reconcile flow is
otherwise untouched and green.

Places precision is deliberately NOT restored from a rejection: it belongs to
an address the customer is about to change, and stale coordinates point a
driver at the previous door while looking exactly as confident.

### 3.2 A cancelled stop was still a stop

Cancelling a booking **touches no task** — `applyTransition` writes one row and
one custody event. Every derivation in the agent's day model reads task
status, so a cancelled booking rendered as an ordinary upcoming stop with a
working "Start & navigate" button. Core refuses the action and always did
(`actionability.ts:144-147`, `:206-212`), so nothing could happen — except an
agent driving to a door for a pickup that is not coming.

**The stop stays.** Dropping it would leave an agent who remembers being sent
to that address with no trace of it. `StageDot` gains a struck-through
`cancelled` state — a muted hollow dot alone is indistinguishable from an
upcoming one — and `ProgressTrack` a `cancelled` prop, distinct from
`currentIndex: -1`: that means "nothing is happening now", this means "nothing
is going to".

`pickupStepIndexFor` returned 0 for a cancelled booking, which put the pulsing
seal-orange "you are here" marker on "Driver booked". `ProgressTrack` has
documented `-1` as the cancelled rendering since it was written; it was never
passed one.

**The admin booking view already satisfied this and is unchanged** — the
status badge and the append-only custody trail carrying `booking.cancelled`
(`state-machine.ts:176`) are exactly "the stop stays visible with a cancelled
status". Recorded rather than rebuilt.

An exception still returns 0. Paused is not abandoned, and changing it is not
this slice's call.
