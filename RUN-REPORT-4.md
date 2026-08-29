# Run report 4 — validation close-out

**Branch:** `fix/validation-close-out` (cut from `origin/dev` @ `e1c70f5`, `--no-track`,
`branch.merge` verified empty). **No commits made** — every phase is checkpointed here.

**Closes:** B2, N1, N5, N6, N7, D1 from `VALIDATION-REPORT-tier1-2.md`.
**Explicitly out of scope:** N2 (local probe residue — TD runs `local:reset`),
N3 (ESLint boundary for the Resend adapter — hardening backlog), N4 beyond the
comment correction in Phase 1. B1 remains TD's manual hosted check.

---

## Phase 1 — B2: core-level exception event emitter ✅

### The gap, restated

`booking/exception_raised` had exactly one emitter in the repo: the Stripe webhook
route. `reportVisitException` — an agent flagging a problem at the customer's door,
which is the path the feature exists for — moved the booking to `exception`, wrote a
custody event, and told nobody.

### What was built

A `EventEmitter` seam in core, mirroring the `Notifier`/`createNotifier` pattern:

| File | What |
|---|---|
| `packages/core/src/events/emitter.ts` | `DomainEvent` / `EventEmitter` + `NoopEmitter` (default), `ConsoleEmitter`, `RecordingEmitter` (test double, same place as `RecordingNotifier`) |
| `packages/core/src/events/factory.ts` | `createEventEmitter` — the two credential-free choices. Deliberately no `{kind:"inngest"}`: that adapter needs an event key, which is environment |
| `packages/core/src/events/booking-events.ts` | `emitExceptionRaised` — shapes the event in ONE place, never throws |
| `packages/core/src/events/index.ts` | barrel, re-exported from `src/index.ts` |

`DomainEvent` carries an optional `id` (idempotency key) on top of the `{name, data}`
the slice prompt sketched. It is needed for dedup and it is not Inngest-specific —
every queue worth using has the concept — so the seam stays adapter-agnostic.

Wiring: `CoreConfig.emitter` (defaults to `NoopEmitter`), `RuntimeOptions.emitter`
(instance) and `RuntimeOptions.events` (declarative). Core still reads no env.

### Where the emit happens, and why there

Emission sits at the **two transaction choke points**, not at call sites:

1. `services/bookings.ts` — `applyTransition`, after the commit, when `to === "exception"`.
2. `services/webhooks.ts` — `moveBooking`, which writes its own transaction and does
   not go through `applyTransition`.

Those two are the only ways a booking row reaches `exception`. Putting the emit there
means a future eighth path is covered by construction rather than by remembering to add
a call — which is precisely the failure this finding was.

The dedupe key is the **custody event id**, returned from the same transaction as the
status change. One row per raise, so: a losing concurrent transition emits nothing, and
a Stripe redelivery (which performs no move) emits nothing. The previous key was Stripe's
event id; the new one is strictly no weaker.

Reason text is derived from the custody metadata the existing call sites already write
(`reason`, plus `note`/`detail`), with an `exceptionReason` override on
`ApplyTransitionInput` for paths that carry neither. No call site had to change.

### The seven paths — wiring status

`raise_exception → exception` is legal from **seven states**
(`booking/state-machine.ts:53-81`). Every one of them now emits, because all seven are
reached through the two choke points above:

| # | Source state | Reached by | Emits |
|---|---|---|---|
| 1 | `draft` | admin override (`admin/app/bookings/actions.ts:53` → `applyTransitionForSession`) | ✅ |
| 2 | `paid` | admin override; Stripe `payment.cancelled` (`webhooks.ts:112`) | ✅ |
| 3 | `agent_assigned` | **`reportVisitException`** (`agent-visit.ts:386`) — the operational path, silent before this slice; admin override | ✅ |
| 4 | `verified_sealed` | capture failure (`payment-lifecycle.ts:92`); admin override | ✅ |
| 5 | `awaiting_pickup` | capture failure; admin override | ✅ |
| 6 | `in_transit` | capture failure; Stripe `payment.cancelled` mid-custody; admin override | ✅ |
| 7 | `delivered_to_bagdrop` | capture failure; admin override | ✅ |

Every code path that transitions to `exception`, and its wiring:

| Call site | Route | Wired |
|---|---|---|
| `services/agent-visit.ts:386` `reportVisitException` | `applyTransition` | ✅ |
| `services/payment-lifecycle.ts:92` capture failure | `applyTransition` | ✅ |
| `services/webhooks.ts:112` `payment.cancelled` in custody | `moveBooking` (own emit) | ✅ |
| `apps/admin/.../bookings/actions.ts:53` ops override | `applyTransitionForSession` → `applyTransition` | ✅ |
| `payment-intent.ts:351`, `dispatch.ts:199,292`, `agent-visit.ts:337`, `payment-lifecycle.ts:227` | `applyTransition` with non-exception events | n/a — never lands on `exception` |

### App runtimes

- **apps/web** — the Inngest client was split into `lib/inngest-client.ts` so
  `lib/core.ts` can build an emitter from it without importing `lib/inngest.ts`, which
  imports `getCore` right back (that cycle is why the client moved). `lib/event-emitter.ts`
  holds the `InngestEmitter`; `getCore`/`tryGetCore` inject it.
- **apps/agent** — gained the runtime wiring it lacked: `lib/event-emitter.ts` +
  `INNGEST_EVENT_KEY` in `env.ts`. **Send-only** — no `/api/inngest` route, deliberately:
  apps/web owns the registry and a second serve endpoint would double-register all 8
  functions.
- **apps/admin** — same treatment. Not named in the slice prompt, but its override path
  (`applyTransitionForSession`) can raise an exception too, so leaving it out would have
  left the gap half-open.

### Stripe webhook migrated onto the seam

`apps/web/.../webhooks/stripe/route.ts` no longer emits the exception event; the
`movedTo === "exception"` branch is gone (with a comment saying why re-adding it would
double-send). `emitExceptionRaised` was deleted from `apps/web/src/lib/booking-events.ts`,
which now handles `booking/confirmed` only. **Event name and payload shape unchanged** —
the existing Inngest function is untouched.

### N4 comment fix (comment-only, no refactor)

`payments/factory.ts` and `notifications/factory.ts` no longer claim "core never touches
`process.env`". Both now name the one real exception, `auth/hash-destination.ts` reading
`OTP_LOG_HMAC_KEY`. The HMAC read itself is unchanged.

### Tests

- `packages/core/src/events/emitter.test.ts` (unit, 6): factory selection, the
  `NoopEmitter` default, injected-instance passthrough, exact wire name + payload shape,
  `raisedByUserId` omitted for a system raise, and a rejecting emitter resolving instead
  of throwing.
- `packages/core/src/events/exception-emit.integration.test.ts` (5): an agent field
  exception emits **exactly one** event with the right payload; two raises produce two
  distinct dedupe ids; an illegal transition emits nothing; **a throwing emitter does not
  fail the transition** (booking still `exception`, custody event written, task `failed`);
  a system raise omits `raisedByUserId` rather than sending null.

### Gate

| Gate | Result |
|---|---|
| `pnpm turbo typecheck` | **6 successful, 6 total** |
| `pnpm turbo lint` | **6 successful, 6 total** |
| `pnpm turbo test` (unit) | core **250** (was 244), web **64**, admin **19**, agent **6** |
| `pnpm --filter @koolee/core test:integration` | **15 files passed, 1 skipped · 92 passed, 3 skipped** |

### Files changed — Phase 1

```
A  packages/core/src/events/emitter.ts
A  packages/core/src/events/factory.ts
A  packages/core/src/events/booking-events.ts
A  packages/core/src/events/index.ts
A  packages/core/src/events/emitter.test.ts
A  packages/core/src/events/exception-emit.integration.test.ts
M  packages/core/src/config.ts
M  packages/core/src/runtime.ts
M  packages/core/src/index.ts
M  packages/core/src/services/bookings.ts
M  packages/core/src/services/webhooks.ts
M  packages/core/src/payments/factory.ts          (comment only — N4)
M  packages/core/src/notifications/factory.ts     (comment only — N4)
A  apps/web/src/lib/inngest-client.ts
A  apps/web/src/lib/event-emitter.ts
M  apps/web/src/lib/inngest.ts
M  apps/web/src/lib/core.ts
M  apps/web/src/lib/booking-events.ts
M  apps/web/src/app/api/webhooks/stripe/route.ts
A  apps/agent/src/lib/event-emitter.ts
M  apps/agent/src/lib/core.ts
M  apps/agent/src/env.ts
A  apps/admin/src/lib/event-emitter.ts
M  apps/admin/src/lib/core.ts
M  apps/admin/src/env.ts
```

---

## Phase 2 — N5: `OPS_ALERT_EMAIL` production boot gate ✅

`OPS_ALERT_EMAIL` was `optionalString` with no gate. Unset in production,
`exceptionOpsAlertEmail` logs `"OPS_ALERT_EMAIL not configured; skipping exception
email."` and returns — a deploy that forgets it loses every ops alert while looking
perfectly healthy. Phase 1 raises the stakes: the alert path now covers all seven
states, so a missing address drops the whole thing rather than one webhook's worth.

Implemented with the **same mechanism as `RESEND_API_KEY`** — the existing prod-boot
`if` block became a two-check block, sharing the identical exemptions (coming-soon
deploys, no Supabase, the `next build` phase). Dev is untouched: both stay optional at
parse time, which is the zero-credentials local experience.

The runtime skip-and-log in `jobs/functions.ts` stays as defense in depth. The gate
makes it unreachable in production, not redundant.

Also: `apps/web/.env.example` gained `OPS_ALERT_EMAIL` (it was missing entirely) and a
`REQUIRED IN PRODUCTION` note on both it and `RESEND_API_KEY`.

### Tests — `apps/web/src/env.test.ts`, 13 → 16

- `stubCompleteProdConfig()` now includes `OPS_ALERT_EMAIL` ("complete" means complete).
- throws at import when `OPS_ALERT_EMAIL` is missing on a live prod boot;
- boots without it when the deploy is coming-soon;
- leaves it optional outside production.

### Gate

typecheck **6/6** · lint **6/6** · unit: core **250**, web **67** (was 64), admin **19**,
agent **6**.

### Files changed — Phase 2

```
M  apps/web/src/env.ts
M  apps/web/src/env.test.ts
M  apps/web/.env.example
```

---

## Phase 3 — D1: human-readable booking reference ✅

The confirmation email's own doc comment promised a "ref"; no such column existed, so the
email identified a booking by flight plus a UUID trip link. Meanwhile **two** ad-hoc
substitutes had grown up independently, both DERIVED from the id:

- `apps/web/src/lib/booking-reference.ts` → `KL-` + last six hex
- `apps/admin/src/lib/booking-ref.ts` → bare last six hex

One booking therefore had two different "references" depending on which console you were
looking at, and neither appeared in the email the customer actually received. Both are
deleted; everything now reads `bookings.ref`.

### Format

`KOO-XXXXX` — five **Crockford base32** characters over `0123456789ABCDEFGHJKMNPQRSTVWXYZ`.
`I`, `L`, `O` and `U` are absent, so no glyph pair a human can confuse survives and a ref
read over the phone transcribes back to the same row. 32^5 ≈ 33.5M. `varchar(9)`, NOT NULL,
UNIQUE.

**Display and support only.** Nothing authenticates or authorizes on it; the trip page URL
stays UUID-based. 33.5M is fine for uniqueness and hopeless as a secret, and that is stated
in the column comment, the migration header and `booking/ref.ts` so nobody later mistakes
it for a credential.

### Migration `0021_big_hobgoblin.sql` — LOCAL ONLY, applied

Drizzle generated a single `ADD COLUMN "ref" varchar(9) NOT NULL`, which fails outright on
a table that already has rows. Rewritten by hand as the §3.1 three-step:

| # | Statement | Lock / cost |
|---|---|---|
| 1 | `ALTER TABLE bookings ADD COLUMN ref varchar(9)` (nullable) | catalog-only in PG11+, instant, no rewrite |
| 2 | `DO $$ … $$` backfill, Crockford base32, bounded at 20 attempts/row, `RAISE`s rather than looping | row-by-row inside the transaction, so the collision check sees rows written moments earlier; linear in row count |
| 3 | `ALTER COLUMN ref SET NOT NULL` | ACCESS EXCLUSIVE + one full scan to verify — the statement to watch if `bookings` ever gets big |
| 4 | `CREATE UNIQUE INDEX bookings_ref_key` | SHARE lock; not `CONCURRENTLY`, same reasoning as 0017/0019/0020 (the migrator runs in one transaction) |

Applied locally after TD's explicit OK. `Target host: 127.0.0.1` confirmed before running.

```
$ pnpm db:migrate   → Target host: 127.0.0.1 · Migrations applied.
$ pnpm db:status    → Target host: 127.0.0.1
                      Applied:  22 of 22 (matched by content hash)
                      In sync — nothing pending.
```

Step 3 succeeding is itself the proof the backfill covered every pre-existing local row —
`SET NOT NULL` cannot pass with a NULL left behind.

**Hosted is TD's manual step**, documented in Phase 6.

### Generation — `packages/core/src/booking/ref.ts`

`generateBookingRef()` uses `crypto.getRandomValues`; 256 is divisible by 32 so `byte % 32`
is uniform with no modulo bias and no rejection sampling. No env, no external dependency.

`withBookingRef(attempt, maxAttempts = 5)` retries on — and **only** on — a 23505 whose
`constraint_name` is `bookings_ref_key`. The database is the arbiter rather than a
`SELECT … WHERE ref = ?` before the insert, because that check races and losing the race is
the case the loop exists for. Any other error propagates on the first throw.

`create-booking.ts` retries the **whole transaction**, not just the insert: a failed
statement aborts its Postgres transaction, so there is nothing to retry inside one. Nothing
has committed when the retry runs.

### Where it surfaces

| Surface | Change |
|---|---|
| Confirmation email | `Booking reference: KOO-XXXXX` line + HTML table row; subject now leads with the ref |
| Reminder email | same line + row; subject leads with the ref |
| Ops exception email | `KOO-XXXXX (uuid)` in body and heading, ref in the subject. Looked up from the row — the event payload shape is fixed and a missing row must not stop the alert |
| Customer trip list | `Reference` fact now reads the column (was `KL-` + hex) |
| Customer trip detail | ref added to the header subtitle |
| Admin bookings list | ref column now reads the column (was bare hex) |
| Admin booking detail | `KOO-XXXXX · <uuid>` |
| Admin exceptions board | ref added — the alert email names the booking by ref, so it has to be scannable where ops triages |
| Agent task list | ref added (had none) |
| Agent visit view | ref added (had none) |

`jobs/functions.ts:85`'s doc comment no longer lies — it names `bookings.ref` explicitly.
`TaskBookingContext` gained `ref` so the agent list can render it.

### Tests

- `packages/core/src/booking/ref.test.ts` (11): format over 500 draws, **no I/L/O/U** in
  2,500 characters, all 32 alphabet characters reachable, 1,000 draws with no repeat;
  conflict detection recognises a wrapped 23505 on `bookings_ref_key` and rejects one on a
  *different* index; retry mints a **new** ref each attempt, is bounded, and does **not**
  retry unrelated failures.
- `create-booking.integration.test.ts` +2: a created booking's ref is well-formed, unique
  and stored (not derived from the id); a duplicate ref insert is rejected by the index.
- `emails.test.ts`: the confirmation body asserts `Booking reference: KOO-7H2QM`.

### Gate

typecheck **6/6** · lint **6/6** · core unit **261** · core integration **94 passed, 3
skipped** · admin **19** · agent **6** · web **62**.

⚠️ web unit went 67 → **62** because `booking-reference.test.ts` (5 tests) was deleted along
with the helper it covered. Not a regression — the behaviour it pinned no longer exists.

### Files changed — Phase 3

```
A  packages/db/drizzle/0021_big_hobgoblin.sql   (hand-rewritten from the generated diff)
M  packages/db/drizzle/meta/_journal.json
M  packages/db/drizzle/meta/0021_snapshot.json
M  packages/db/src/schema/bookings.ts
A  packages/core/src/booking/ref.ts
A  packages/core/src/booking/ref.test.ts
M  packages/core/src/booking/index.ts
M  packages/core/src/services/create-booking.ts
M  packages/core/src/services/tasks.ts
M  packages/core/src/notifications/emails.ts
M  packages/core/src/notifications/emails.test.ts
M  packages/core/src/jobs/functions.ts
M  packages/core/src/services/create-booking.integration.test.ts
M  packages/core/src/services/payment-lifecycle.integration.test.ts
M  packages/core/src/jobs/cleanup-anonymous-users.integration.test.ts
D  apps/web/src/lib/booking-reference.ts
D  apps/web/src/lib/booking-reference.test.ts
D  apps/admin/src/lib/booking-ref.ts
M  apps/web/src/app/trips/page.tsx
M  apps/web/src/app/trips/[bookingId]/page.tsx
M  apps/admin/src/app/bookings/page.tsx
M  apps/admin/src/app/bookings/[bookingId]/page.tsx
M  apps/admin/src/app/exceptions/page.tsx
M  apps/agent/src/app/tasks/page.tsx
M  apps/agent/src/app/tasks/[taskId]/page.tsx
```

---

## Phase 4 — N6: tests for `jobs/functions.ts` ✅

The file had **zero** test files. All six Inngest functions now run in the unit tier
against faked deps — no Inngest dev server, no database, no network.

### How it is testable at all

`createKooleeFunctions(inngest, getConfig, options)` takes its client as an argument.
`packages/core/src/jobs/test-doubles.ts` supplies:

- **`RecordingInngest`** — a client whose `createFunction` captures `{id, crons, events,
  handler}` instead of registering. That turns each function into a plain async function
  you can call.
- **`FakeStep`** — runs every `step.run` inline and **records** `sleepUntil` targets
  rather than sleeping. This is the only way the reminder's schedule is testable: a real
  run suspends for ~38 hours, which is exactly why the validation run could not probe it.
- **`fakeDb`** — just enough Drizzle for these six handlers. `where` clauses are ignored
  by design: what is under test is send-or-skip decisions and error handling, and the
  query predicates are already covered against real Postgres by the integration suites. A
  fake that pretended to evaluate `eq()` would be a second, worse query engine.

`test-doubles.ts` is not exported from the package barrel.

### Coverage — 28 tests

| Function | Pinned |
|---|---|
| registration | all six ids present; both cron expressions exact |
| **confirmation** | sends exactly one email carrying the ref, breakdown, trip link, and the `airline's bag drop` copy rule **at the point of send**; a **thrown send is caught** → `{sent:false, reason:"send_failed"}`, warning alert, no throw; cancelled booking skipped; no-email customer skipped with a log line |
| **reminder** | `sleepUntil` target is **exactly** `pickup_window_start − 2h`; a window already inside the lead sends immediately with **no** sleep; SMS + email both sent when worthy; **`REMINDER_WORTHY` guard** skips `cancelled`/`exception`/`verified_sealed`/`completed` at send time and still sends for `paid`/`agent_assigned`; deleted booking skipped; a **thrown email is caught** → warning alert |
| **exception alert** | emails `OPS_ALERT_EMAIL`, subject names the ref; **unset address → logged skip, `{sent:false, reason:"no_ops_email"}`, no throw**; a failed send escalates to `critical` rather than throwing |
| **cutoff-risk monitor** (`*/5`) | quiet with nothing in transit; alerts on an in-transit booking with no cutoff on record |
| **agent no-show** | waits the exact 15-minute grace deadline; escalates `critical` when no task started; silent when the agent checked in |
| **waitlist sweep** (daily) | clean and **silent** with an empty queue (it runs every day forever); emails a covered signup and stamps `notifiedAt`; a failed send leaves the row **unstamped** so the next sweep retries |
| module contract | importing `jobs/functions` with no credentials does not throw |

The throwing-notifier double follows the `FlakyNotifier` pattern from
`waitlist/notify-covered.integration.test.ts`.

### Mutation check

These 28 passed on the first run, which is worth distrusting, so two assertions were
deliberately broken (the `sleepUntil` instant, and the ops recipient address) and the suite
re-run: **both failed**. The assertions bite.

### Gate

typecheck **6/6** · lint **6/6** · core unit **289** (was 261) · web **62** · admin **19** ·
agent **6**.

### Files changed — Phase 4

```
A  packages/core/src/jobs/test-doubles.ts
A  packages/core/src/jobs/functions.test.ts
```

---

## Phase 5 — N1 + N7: env footgun and stale docs ✅

### N1 — `DIRECT_DATABASE_URL` removed from the app env files

All three `.env.local` files carried the **hosted dev project's direct DDL credential**
(`db.jpvlzoikcivxepgyrkho.supabase.co:5432`) while `DATABASE_URL` pointed at local. Nothing
in any app reads it — the runtime uses `DATABASE_URL`, and `packages/db` does not load app
env files — so it was pure hazard: a hosted DDL credential one `dotenv -e` away from the
migrator, which is the exact accident the `packages/db/.env` LOCAL flip exists to prevent.

Removed from `apps/{web,agent,admin}/.env.local`. In each `.env.example` the live
`DIRECT_DATABASE_URL=` entry is replaced by a commented note saying it belongs in
`packages/db/.env` and nowhere else — so the next person to copy the example cannot
reintroduce it. (Backups of the three `.env.local` files were taken to the scratchpad
first.)

**Verification:** all three dev servers restarted clean —

```
@koolee/web:dev:   ✓ Ready in 288ms   - Environments: .env.local
@koolee/agent:dev: ✓ Ready in 288ms
@koolee/admin:dev: ✓ Ready in 288ms
```

`/` 200, `/trips` 200 (→ `/login?returnTo=%2Ftrips`, correct for an unauthenticated
request), admin `/bookings` 200, admin `/exceptions` 200, agent `/tasks` 200. **Zero**
errors in the dev log — in particular no `column "ref" does not exist`, which is what a
schema/code mismatch would have produced.

**Stated precisely, since the slice asked for a booking smoke:** the live consoles all
require a session, so a curl smoke returns the login page and cannot show a rendered ref.
The booking smoke that *did* run is `create-booking.integration.test.ts` against real
Postgres, which exercises the real `createBooking` and asserts the minted ref. A live
authenticated render of the ref was **not** performed and is not claimed.

### N7 — stale docs

`docs/CODEBASE-MAP.md`:

| Was | Now |
|---|---|
| deploy checklist: *"Migration `0012` … applied locally but **not** yet hosted"* — false, and the exact prose-migration-claim §3.1 exists to forbid | points at `pnpm db:status` against the target, with a note that this file itself has been wrong about migration state |
| *"open items … and the Inngest jobs' side effects"* | records them as **shipped**; every function in the table does real work |
| `exception-ops-alert-email` row: *"unset = skip"* | *"now required in prod"* |
| *"`packages/core` reads no environment variables"* | *"takes its credentials as values"*, naming the one exception (`auth/hash-destination.ts` / `OTP_LOG_HMAC_KEY`) — the N4 correction, consistent with the factory comments |
| Inngest section: events emitted from `apps/web/src/lib/booking-events.ts` | rewritten — `booking/exception_raised` is emitted by **core** from the two choke points; documents the `EventEmitter` seam, the send-only agent/admin wiring, and why emission never throws |

`RUN-REPORT-3.md:296`: *"7 registered functions"* → **8**, with the correction dated and
the arithmetic spelled out (6 from `createKooleeFunctions` + 2 in `apps/web/src/lib/inngest.ts`).

`PROJECT-STATUS.md`: new snapshot bullet leading §3; tracker rows **58–62** for B2, N5, D1,
N6, N1+N7; **B1 explicitly restated as OPEN** with the command to clear it. §7 standing
constraints updated — the "core reads no env" line now names its one exception, plus two new
constraints (never re-add an exception emit at a call site; `bookings.ref` is never an auth
or lookup credential).

### Stale claims found but deliberately NOT changed

- PROJECT-STATUS §3 says the confirmation email was *"verified live end-to-end locally (real
  Resend delivery)"*. The validation run verified the **console** path only (it blanked
  `RESEND_API_KEY` so no mail left the machine). Per the report's own reading this claim is
  *not contradicted, just not re-proven*, so it is left standing rather than silently
  weakened on no evidence. Flagging it here so TD can decide.
- `DIRECT_DATABASE_URL` still exists in each app's `env.ts` **schema** (and in agent's
  `HINTS`), now dead. Removing it is outside this slice's stated scope (which named the
  `.env.local`/`.env.example` files only) and would be a small, separate cleanup.

### A real defect found in this slice's own Phase 3 work

The full gate caught `ref.test.ts > does not repeat itself` failing. Not a fluke — a test I
had written on wrong reasoning. The birthday bound over 32^5:

| refs minted | P(at least one collision ever) |
|---|---|
| 1,000 | 1.5% |
| 5,000 | 31.1% |
| 7,000 | **51.8%** |
| 10,000 | 77.5% |

So `expect(refs.size).toBe(1000)` was a test that fails about once every 67 runs, and my
comment in `ref.ts` claiming a collision is "1-in-astronomical" was **wrong**.

The *design* is fine, and this actually vindicates it: what stays negligible is the
**per-insert** case, which is the one the retry loop faces — at 10,000 existing rows a
single attempt collides with probability ~3e-4, so five consecutive collisions is ~2e-18.
But the retry loop is **load-bearing rather than insurance**, and both the comment and the
test now say so. The test asserts entropy (`> 990` distinct of 1,000) instead of perfect
uniqueness, because perfect uniqueness is the unique index's job, not the generator's. Ran
8× consecutively: 11/11 green each time.

### Gate

typecheck **6/6** · lint **6/6** · core **289** · web **62** · admin **19** · agent **6**.

### Files changed — Phase 5

```
M  apps/web/.env.local        (DIRECT_DATABASE_URL line removed)
M  apps/agent/.env.local      (same)
M  apps/admin/.env.local      (same)
M  apps/web/.env.example      (live entry → commented note)
M  apps/agent/.env.example    (same)
M  apps/admin/.env.example    (same)
M  docs/CODEBASE-MAP.md
M  RUN-REPORT-3.md
M  PROJECT-STATUS.md
M  packages/core/src/booking/ref.ts        (collision-rate comment corrected)
M  packages/core/src/booking/ref.test.ts   (flaky uniqueness assertion → entropy)
```

---

## Phase 6 — Close-out ✅

### Final gate — everything, from a clean state

| Gate | Command | Result |
|---|---|---|
| Typecheck | `pnpm turbo typecheck` | **6 successful, 6 total** |
| Lint | `pnpm turbo lint` | **6 successful, 6 total** |
| Prod builds | `pnpm turbo build` | **3 successful, 3 total** (web, agent, admin) |
| Unit — core | `pnpm turbo test` | **19 files / 289 tests** (baseline 244) |
| Unit — web | " | **7 files / 62 tests** |
| Unit — admin | " | **2 files / 19 tests** |
| Unit — agent | " | **1 file / 6 tests** |
| Integration — core | `pnpm --filter @koolee/core test:integration` | **15 files passed, 1 skipped · 96 passed, 3 skipped** |
| Migrations | `pnpm db:status` | `Target host: 127.0.0.1` · **22 of 22 (matched by content hash)** · In sync |

Test movement, accounted for: core **244 → 289** (+6 emitter, +11 ref, +28 jobs);
web **64 → 62** (+3 env boot gate, −5 from the deleted `booking-reference.test.ts`).
Integration **87 → 96** across the slice (+7 the new exception-emit file, +2 the ref cases).

`apps/{web,agent,admin}/next-env.d.ts` were touched by `turbo build` (Next rewrites the
routes-types path between dev and prod builds) and have been reverted — they are generated
artifacts, not part of this slice.

---

## Manual setup — what TD must do by hand

### 1. Apply migration 0021 to each hosted project (REQUIRED before deploying this branch)

`bookings.ref` is `NOT NULL`; app code reads it unconditionally. **A deploy without this
migration will fail on every booking read.** Apply the migration first, deploy second.

```bash
# Check first — read-only, safe against production. READ THE `Target host:` LINE.
DIRECT_DATABASE_URL='<hosted direct 5432 url>' pnpm db:status

# Then apply.
DIRECT_DATABASE_URL='<hosted direct 5432 url>' pnpm db:migrate

# Confirm.
DIRECT_DATABASE_URL='<hosted direct 5432 url>' pnpm db:status
#   → Applied:  22 of 22 (matched by content hash)
#   → In sync — nothing pending.
```

Run it against **both** hosted projects (prod `dblfbpxorleurqdlkylz`, dev
`jpvlzoikcivxepgyrkho`). On an IPv4 network use the session pooler host (port 5432), per
docs/MIGRATIONS.md §3.

Blast radius: `bookings` only. One added column, one added unique index, one backfill of
existing rows. No data destroyed. The `SET NOT NULL` step is the one to watch if a hosted
`bookings` table is large — see the migration header for the per-statement lock notes.

### 2. `OPS_ALERT_EMAIL` is now REQUIRED in production env

Add it to the Vercel **Production** scope for apps/web before the next production deploy.

```
OPS_ALERT_EMAIL=<ops inbox address>
```

Without it the boot assertion **throws and the deploy will not serve** — which is the
intended behaviour, not a bug to work around. It joins `RESEND_API_KEY` on that gate.
Coming-soon deploys and Preview are unaffected. Optional locally.

Updated production env checklist for apps/web:

| Var | Status |
|---|---|
| `RESEND_API_KEY` | required (existing gate) |
| `OPS_ALERT_EMAIL` | **required — new in this slice** |
| `RESEND_FROM` | optional; sandbox default only delivers to the Resend account's own address |
| `NEXT_PUBLIC_APP_URL` | optional but emails ship with no CTA without it |

### 3. `INNGEST_EVENT_KEY` for apps/agent and apps/admin (production only)

Both apps now SEND events (they serve no functions). Against Inngest Cloud they need the
event key; locally the dev server accepts unauthenticated sends, so nothing changes for
local work. Without it in production, an exception raised from the agent or admin console
will not reach the queue and no ops alert is sent.

### 4. Not done, still yours — **B1**

Hosted migration state has still never been verified from a shell. The `db:status` commands
in step 1 clear it as a side effect. Read the `Target host:` line every time.

---

## The seven exception paths — final wiring status

`raise_exception → exception` is legal from seven states. All seven emit, because all seven
route through one of the two choke points.

| # | Source state | How it is reached | Wired |
|---|---|---|---|
| 1 | `draft` | admin override | ✅ `applyTransition` |
| 2 | `paid` | admin override; Stripe `payment.cancelled` | ✅ both choke points |
| 3 | `agent_assigned` | **`reportVisitException`** — the operational path, **silent before this slice**; admin override | ✅ `applyTransition` |
| 4 | `verified_sealed` | capture failure; admin override | ✅ `applyTransition` |
| 5 | `awaiting_pickup` | capture failure; admin override | ✅ `applyTransition` |
| 6 | `in_transit` | capture failure; Stripe `payment.cancelled` mid-custody; admin override | ✅ both choke points |
| 7 | `delivered_to_bagdrop` | capture failure; admin override | ✅ `applyTransition` |

Every code path that lands a booking in `exception`:

| Call site | Route to the emit | Wired |
|---|---|---|
| `services/agent-visit.ts:386` `reportVisitException` | `applyTransition` | ✅ |
| `services/payment-lifecycle.ts:92` capture failure | `applyTransition` | ✅ |
| `services/webhooks.ts:112` `payment.cancelled` in custody | `moveBooking` (own emit) | ✅ |
| `apps/admin/.../bookings/actions.ts:53` ops override | `applyTransitionForSession` → `applyTransition` | ✅ |
| `payment-intent.ts:351`, `dispatch.ts:199,292`, `agent-visit.ts:337`, `payment-lifecycle.ts:227` | `applyTransition` with non-exception events | n/a — never lands on `exception` |

Per-app emitter wiring:

| App | Emitter | Serves `/api/inngest`? |
|---|---|---|
| web | `InngestEmitter` via `lib/inngest-client.ts` | **yes** — owns the registry (8 functions) |
| agent | `InngestEmitter`, send-only | no — a second serve endpoint would double-register |
| admin | `InngestEmitter`, send-only | no — same reason |

---

## Deferred, with reasons

| Item | Why |
|---|---|
| **B1** — hosted migration state unverified | Requires hosted credentials and TD's own shell. Command given above; it is the one item that must clear before rollout. |
| **N2** — probe residue in the local dev DB | Explicitly out of scope; TD runs `pnpm local:reset`. Untouched. |
| **N3** — no ESLint boundary for the Resend adapter | Explicitly out of scope (hardening backlog). Still moot today: `ResendNotifier` uses REST with an injectable fetch and no `resend` package exists to restrict. |
| **N4** beyond the comment fix | Explicitly out of scope. `auth/hash-destination.ts` still reads `OTP_LOG_HMAC_KEY`; the three doc comments that denied it (both factories + CODEBASE-MAP) and PROJECT-STATUS §7 now name it. The HMAC read is unchanged. |
| `DIRECT_DATABASE_URL` in each app's `env.ts` **schema** | Now dead config. Outside the slice's stated scope, which named the `.env.local`/`.env.example` files only. Small, separate cleanup. |
| PROJECT-STATUS §3's *"verified live … (real Resend delivery)"* | Not contradicted by the validation run, only not re-proven (it deliberately blanked the key). Left standing rather than weakened on no evidence. TD's call. |
| Live authenticated render of the ref in the consoles | Requires a browser session; not scriptable here. Booking creation + ref is proven by integration test against real Postgres, and the dev servers boot and serve every affected route with no errors. |

---

## Findings closed

| Finding | Status |
|---|---|
| **B2** exception alert covers 1 of 7 paths | ✅ closed — all seven, via a core-level seam |
| **N1** hosted DDL credential in app `.env.local` | ✅ closed |
| **N5** `OPS_ALERT_EMAIL` has no prod boot gate | ✅ closed |
| **N6** `jobs/functions.ts` has zero tests | ✅ closed — 28 tests |
| **N7** stale docs | ✅ closed |
| **D1** confirmation email promises a ref that does not exist | ✅ closed — `bookings.ref` |
| **N4** "core reads zero env" is false | ◐ comment-corrected in 4 places; the read itself deliberately unchanged |
| **B1** hosted migration state unverified | ⬜ **OPEN — TD's manual check** |
| **N2**, **N3** | ⬜ deferred by instruction |

### One defect found during close-out verification

Re-reading `apps/admin/src/app/bookings/actions.ts` to confirm the Phase 1 wiring claim
turned up a real gap in Phase 1's own work: the admin manual override writes
`metadata: { source: "admin_manual_override", note }` — a **`note`, never a `reason`**. The
first version of `exceptionReasonFrom` only promoted `note` when a `reason` was already
present, so an ops override would have alerted with the generic
*"Booking moved to exception by raise_exception."* and thrown away the one sentence the
operator actually typed.

Fixed: with no `reason`, the `note` becomes the reason; the generic sentence is the last
resort. Two integration cases added — one asserting the admin payload verbatim, one the
empty-metadata fallback. Integration tier 94 → **96**.

No commits were made on `fix/validation-close-out`.
