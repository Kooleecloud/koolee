# Validation report — Tier 1 + Tier 2 slice (dispatch close-out + email notifications)

**Run date:** 2026-08-28
**Target:** `dev` @ `e1c70f5` (clean working tree, no commits made, no fixes applied)
**Scope:** read-only verification with live probes, per `VALIDATION-RUN-tier1-2` prompt.
**Environment:** local stack only (`scripts/local.sh up` → Supabase 54321/54322, Mailpit
54324, Inngest dev 8288, web 3000 / agent 3001 / admin 3002). **No hosted database was
contacted at any point in this run** — see §2.4 and Blocker B1 for what that leaves
unverified.

Every claim below names the command or probe that produced it. Where a check could not
be performed, it says so rather than inferring from code.

---

## Section verdicts at a glance

| § | Area | Verdict |
|---|------|---------|
| 0 | Baseline gates | **PASS** |
| 1 | Small fixes (Phase 0) | **PASS** (6/6) |
| 2 | Task uniqueness (Phase 1) | **PASS** local · hosted unverified |
| 3 | On-paid auto-assign (Phase 2) | **PASS** |
| 4 | Seed integrity (Phase 3) | **PASS** with one residue note |
| 5 | ResendNotifier (Phase 4) | **PARTIAL** — 2 stated expectations are factually wrong |
| 6 | Email side effects (Phase 5) | **PARTIAL** — one real functional gap, one test gap |
| 7 | Docs + tracker | **PARTIAL** — stale migration-state prose in CODEBASE-MAP |

---

## 0. Baseline gates — PASS

| Gate | Command | Result | Last known green (RUN-REPORT-3, Unit 3) |
|------|---------|--------|------------------------------------------|
| Typecheck | `pnpm turbo typecheck` | **6 successful, 6 total** (exit 0) | 6/6 ✅ match |
| Lint | `pnpm turbo lint` | **6 successful, 6 total** (exit 0) | 6/6 ✅ match |
| Unit — core | `pnpm turbo test` | **16 files / 244 tests passed** | 244 ✅ match |
| Unit — web | " | **8 files / 64 tests passed** | 59 at Unit 2 close — higher, no regression |
| Unit — admin | " | **2 files / 19 tests passed** | 19 ✅ match |
| Unit — agent | " | **1 file / 6 tests passed** | 6 ✅ match |
| Core integration | `pnpm --filter @koolee/core test:integration` | **14 files passed / 1 skipped; 87 passed / 3 skipped** | 87 passed / 3 skipped ✅ exact match |
| Production build | `pnpm turbo build --force` | **3 successful, 3 total · Cached: 0 cached, 3 total** | 3/3 ✅ match |

The three skipped integration tests are the documented `booking-ownership` set that needs
`ALLOW_DEV_DB_WIPE=1` by design. Builds were run with `--force` so none of the three apps
was satisfied from cache.

Stack health at start: `scripts/local.sh up` reported **verify: all 8 checks passed**,
including "every migration in the checkout is applied (hash-matched via db:status)" and
the `__koolee_test_database` marker on `koolee_test`.

---

## 1. Small fixes (Phase 0) — PASS

### 1.1 `migrate.ts` exits instead of hanging — PASS

Code: `packages/db/src/migrate.ts:42-48` has `try { await migrate(...) } finally { await
client.end() }`.

Live proof — a deliberately failing migration against a disposable scratch database
(`koolee_migfail_probe`, created with a conflicting `airports` table, dropped afterwards):

```
$ DIRECT_DATABASE_URL='…/koolee_migfail_probe' npx tsx src/migrate.ts
Target host: 127.0.0.1
Applying migrations from …/packages/db/drizzle
Migration failed: DrizzleQueryError: Failed query: CREATE TABLE "airports" …
---
wall clock: 1s — process EXITED (no hang)
exit code = 1
```

Exits non-zero in ~1s. Scratch DB dropped after the probe.

### 1.2 Weight input accepts `15.25` — PASS (live)

`apps/agent/src/app/tasks/[taskId]/visit-flow.tsx:374` → `step="0.01"`.

Live, against a real verification task in the running agent app
(`/tasks/4772441f-…?kind=verification`):

```js
input[name=weightKg] → { step: "0.01", min: "0.1", max: "99" }
set to "15.25" → { valid: true, validationMessage: "", stepMismatch: false }
```

### 1.3 `/exceptions` timestamps are airport-local with abbreviation — PASS (live)

Rendered on `http://localhost:3002/exceptions`:

- `Departs Tue 18 Aug, 10:00 PM EDT · Seal Test Passenger`
- `Departs Mon 17 Aug, 1:06 AM EDT · Tarun Dadlani`

Compared against the stored instants:

```
id            | stored_utc          | jfk_local (America/New_York)
525f1def…     | 2026-08-17 05:06:00 | 2026-08-17 01:06:00   → page: "Mon 17 Aug, 1:06 AM EDT" ✅
dbbb4bdf…     | 2026-08-19 02:00:00 | 2026-08-18 22:00:00   → page: "Tue 18 Aug, 10:00 PM EDT" ✅
```

`airports.tz` is `America/New_York` for all three codes. Exact match, abbreviation present.

### 1.4 Trip page has a real `<title>` — PASS (live)

`generateMetadata` at `apps/web/src/app/trips/[bookingId]/page.tsx:45`, deduped through a
`cache()`'d loader that inherits the ownership 404.

Live on the booking created in §3:

```js
document.querySelector('title').outerHTML
→ "<title>DL123 · JFK pickup · Koolee</title>"
```

(`curl` returns nothing for this page — it is auth-gated; the assertion was made in the
authenticated browser session.)

### 1.5 Copy fixes — PASS

- `Leo·` — one hit repo-wide, and it is the comment recording the fix:
  `apps/web/src/app/trips/[bookingId]/page.tsx:182` — *"Real space, not margin: without it
  the accessible/text content read 'Leo· confirmed' (#51)."* The render now emits
  `{assignedAgent.givenName ?? "Assigned"}{" "}`.
- `bags sealed` — `apps/agent/.../visit-flow.tsx:413-415` carries the explicit `{" "}`
  between the count and the words, with the comment recording the `0/2bags sealed` bug.

### 1.6 `packages/db/.env` defaults to LOCAL — PASS

Resolved through the exact dotenv chain `migrate.ts` uses:

```
DATABASE_URL        = postgresql://***@127.0.0.1:54322/postgres
DIRECT_DATABASE_URL = postgresql://***@127.0.0.1:54322/postgres
```

`pnpm db:status` independently printed `Target host: 127.0.0.1`.

Hosted override documented in **both** places required:
- `packages/db/.env` header comment — inline `DIRECT_DATABASE_URL='…pooler…' pnpm db:migrate`.
- `docs/MIGRATIONS.md:87-98` — same override, plus *"Both tools print `Target host:` first.
  **Read that line every time.**"*

> ⚠️ Non-blocking finding **N1**: `apps/web/.env.local`, `apps/agent/.env.local` and
> `apps/admin/.env.local` each set `DATABASE_URL` to local **but `DIRECT_DATABASE_URL` to
> the hosted dev project** (`db.jpvlzoikcivxepgyrkho.supabase.co:5432`). The app runtime
> only reads `DATABASE_URL` (`apps/web/src/lib/core.ts:79`), and `packages/db` does not
> load app env files, so nothing targets hosted today. It is still a live hosted DDL
> credential sitting one `dotenv -e apps/web/.env.local` away from the migrator, which is
> exactly the class of accident the `packages/db/.env` flip was made to prevent.

---

## 2. Task uniqueness (Phase 1) — PASS (local) · hosted unverified

### 2.1 Migration state — PASS

```
$ pnpm db:status
Target host: 127.0.0.1
Applied:  21 of 21 (matched by content hash)
In sync — nothing pending.
```

`0019_jazzy_overlord.sql` and `0020_cool_mantis.sql` are present and applied by content
hash (not by row count — the rewritten `status.ts` compares hashes).

### 2.2 Unique indexes exist — PASS (proved, not inferred)

```sql
SELECT indexname, indexdef FROM pg_indexes
 WHERE tablename IN ('verification_tasks','pickup_tasks','pricing_rules')
   AND indexdef ILIKE '%UNIQUE%';
```
```
 pickup_tasks_booking_id_key       | CREATE UNIQUE INDEX … ON public.pickup_tasks USING btree (booking_id)
 verification_tasks_booking_id_key | CREATE UNIQUE INDEX … ON public.verification_tasks USING btree (booking_id)
 pricing_rules_one_active_key      | CREATE UNIQUE INDEX … ON public.pricing_rules USING btree (active) WHERE active
```

`\d verification_tasks` confirms the same, and that the old non-unique
`verification_tasks_booking_id_idx` is gone (dropped by 0019).

### 2.3 Duplicate insert fails — PASS (rolled back)

```
BEGIN;
INSERT INTO verification_tasks (booking_id) VALUES ('ac4906f0-…');
ERROR:  duplicate key value violates unique constraint "verification_tasks_booking_id_key"
DETAIL:  Key (booking_id)=(ac4906f0-…) already exists.
ROLLBACK;

BEGIN;
INSERT INTO pickup_tasks (booking_id) VALUES ('ac4906f0-…');
ERROR:  duplicate key value violates unique constraint "pickup_tasks_booking_id_key"
ROLLBACK;
```

Post-rollback row counts unchanged (`vt=10, pt=10`).

### 2.4 Hosted — NOT VERIFIED IN THIS RUN

`RUN-REPORT-3.md:262-280` marks the hosted migration (step 1) and hosted re-seed (step 2)
as ✅ **done**, and `PROJECT-STATUS.md` §3 states the production project is *"migrated
21/21 by hash"*. This run made no connection to either hosted project by choice (the task
is a local validation; connecting would put production DDL credentials on the wire for a
read that TD can do safely from their own shell). **The hosted content-hash check per §3.1
remains outstanding — see Blocker B1.**

---

## 3. On-paid auto-assign (Phase 2) — PASS

### 3.1 Concurrency integration test — PASS

`packages/core/src/services/auto-assign-on-paid.integration.test.ts`, run in isolation:

```
Test Files  1 passed (1)
     Tests  3 passed (3)
```

The three cases are exactly the ones required:
1. *"two concurrent transitions to paid produce exactly one task pair and one assignment"* —
   runs `handlePaymentEvent` (webhook) and `reconcileBookingPayment` (return page) inside
   one `Promise.all`, asserts 1 verification task, 1 pickup task, 1 assign event.
2. *"a concurrent burst of on-paid hooks assigns exactly once, stamped by the system
   actor"* — 4 parallel `autoAssignOnPaid` calls, asserts `assignEvents[0].actorUserId`
   is `null`.
3. *"no covering agent never fails the payment path"*.

The loser of the race lands on `not_assignable` (`auto-assign.ts:251-260`), i.e. treated
as already-assigned, not an error.

### 3.2 Live probe: booking → paid → assigned — PASS

Booking `f4a6ad83-a824-4a10-8325-635d25b703a3` placed through the real funnel in the
browser (JFK / DL123 / 3 bags / ZIP 10001 / window Sun 30 Aug 08:00–09:00 EDT), paid with
Stripe test card `4242 4242 4242 4242`:

```
status         | bag_count | price_cents
agent_assigned |     3     |    7470

kind         | status   | assignee
verification | assigned | agent2@koolee.local
pickup       | assigned | agent2@koolee.local

event_type                 | actor_user_id | actor_role
booking.created            | 41d30097-…    | customer
booking.payment_authorized | (null)        | (null)
booking.agent_assigned     | (null)        | (null)   ← system actor ✅
```

`agent2@koolee.local` is the agent whose `agent_zones` row covers `10001`. Exactly one
task of each kind; assignment custody event carries a null actor as required.

> Deviation from the prompt: the funnel was completed on an **existing authenticated
> session** (customer `+13322602830` / `e2e.tester@koolee-e2e.example`), not a fresh email
> OTP round-trip through Mailpit. Auth is not what this slice changed, that account
> already carries the email address the confirmation email needs, and PROJECT-STATUS #52
> records the email-OTP path green. Stated rather than glossed.

### 3.3 Negative path: uncovered ZIP — PASS

`agent_zones` rows for ZIP `10001` were deleted (1 row), then a second booking was placed
through the same funnel (`bd795c9e-6703-4538-8b37-b39fd376ae94`, DL777, 1 bag, $53.00):

```
status | bag_count | price_cents
paid   |     1     |    5300          ← payment succeeded

vtasks | ptasks
   0   |    0                          ← stayed unassigned

event_type                 | actor_user_id
booking.created            | 41d30097-…
booking.payment_authorized | (null)      ← no agent_assigned event
```

No `[auto-assign]` error lines in the dev-server log — a skip is silent by design, only a
refused *write* (`assignment_failed`) logs.

Board behaviour, on `http://localhost:3002/bookings`:
- Immediately after booking (window ~60h out): row rendered `… DL777 JFK Uncovered Zip
  Probe 1 unassigned Booked`.
- After shifting the probe booking's window to +6h (the at-risk flag is defined as *paid +
  unassigned + window within 12h*, `apps/admin/src/app/bookings/page.tsx:142-143`), the
  same row rendered **`at risk`** and the header read **`17 shown · 1 at risk`**.

`agent_zones` was restored afterwards via `pnpm seed:local` (198 rows, `10001` back to 1).

### 3.4 Assignment cannot fail the payment path — PASS (inspection, closed call-site set)

`autoAssignOnPaid` (`auto-assign.ts:283-297`) wraps everything in `try/catch`, logs, and
returns `void`. All three call sites go through it:

- `services/webhooks.ts:213-215` — after the `to === "paid"` move.
- `services/payment-intent.ts:372-374` — the return-page re-check branch.
- `services/create-booking.ts:348-350` — the inline fake-provider path.

There is no path by which an assignment error reaches the webhook response or the return
page. The call-site set is closed (grep over `apps` + `packages`).

---

## 4. Seed integrity (Phase 3) — PASS, with one residue note

`pnpm seed:local` was run **three** times during this session (twice back-to-back for this
section, once more to restore §3.3's zone deletion), plus the automatic re-seed at the tail
of `test:integration`. After every run:

| Check | Result |
|---|---|
| `agent_zones` row count | 198 |
| distinct ZIPs | 198 |
| set-diff vs `ALL_COVERAGE_ZIPS` (198 in code) | **exact match, both directions empty** |
| active pricing rules | **exactly 1** (`launch-v1`) |

Set-diff method: `ALL_COVERAGE_ZIPS` printed from `packages/db/src/coverage-zips.ts` via
`tsx`, `SELECT DISTINCT zip FROM agent_zones` from psql, compared with `comm`/`diff` —
`in code, NOT in agent_zones` empty and `in agent_zones, NOT in code` empty.

Per-agent spread: `agent 40 / agent2 40 / agent3 40 / agent4 39 / agent5 39` — round-robin
across five agents, one agent per ZIP.

### 4.1 The active rule carries both the curve and the discount — PASS

```json
{ "discount_rules": [ { "kind": "family", "minBags": 3, "percent": 10 } ],
  "lead_time_multipliers": [ { "maxLeadMinutes": 600,  "multiplier": 1.4 },
                             { "maxLeadMinutes": 960,  "multiplier": 1.2 },
                             { "maxLeadMinutes": 1440, "multiplier": 1.1 } ] }
```

Live in the window picker for the 3-bag booking (`/book/slot`), prices vary by window:

```
Sun 30 Aug  8:00 AM  $74.70   … 1:00 PM  $82.17   … 9:00 PM  $89.64
Mon 31 Aug  3:00 AM $104.58
```

Ratios against the base tile: `82.17/74.70 = 1.100`, `89.64/74.70 = 1.200`,
`104.58/74.70 = 1.400` — the three multipliers, exactly. **The #51 flat-$68 symptom is
gone**: the picker is no longer one price.

Live breakdown on `/book/pay`, which resolves the arithmetic:

```
Base fee                          $29.00
3 bags                            $45.00
Distance                           $9.00
Family rate (10% off 3+ bags)     −$8.30
Total, all-in                     $74.70
```

Family discount applied to a 3-bag booking, live. `price_cents = 7470` persisted on the
booking row.

### 4.2 Single-active-rule guard — PASS (rolled back)

```
BEGIN;
INSERT INTO pricing_rules (name, base_fee_cents, per_bag_cents, distance_multiplier, active)
VALUES ('validation-probe second active rule', 1000, 500, 1.0, true);
ERROR:  duplicate key value violates unique constraint "pricing_rules_one_active_key"
DETAIL:  Key (active)=(t) already exists.
ROLLBACK;
```

### 4.3 Fixture-leak class after the integration tier — PASS

Immediately after `pnpm --filter @koolee/core test:integration` completed:

```
 id        | name      | active | lead_time_entries | discount_entries
 8a3f7dd2… | launch-v1 | t      |         3         |        1
 6a07c64a… | test      | f      |         3         |        0
```

Still exactly one active rule and it is the canonical `launch-v1`. (A leftover inactive
`test` row exists but cannot be selected — the pricing reader takes the active rule, and
the 0020 index makes a second active row impossible.)

### 4.4 `dispatch.*@koolee-test.example` fixtures — PARTIAL

- **In code: explicitly marked.** `dispatch.integration.test.ts:171-174` carries a
  `TEST-ONLY FIXTURES` comment stating the accounts *"exist solely in the disposable
  `koolee_test` database … never seeded into dev or hosted"*.
- **`koolee_test`: clean** — `SELECT count(*) … LIKE '%koolee-test.example%'` → `0`.
- **The local dev database still holds four of them**, all created `2026-08-10
  02:57:35 UTC` — i.e. residue from before the #48 disposable-DB split, when the
  integration tier ran against the dev DB:

```
 dispatch.a@koolee-test.example     | agent | zones 0 | verification tasks 2
 dispatch.b@koolee-test.example     | agent | zones 0 | verification tasks 0
 dispatch.gone@koolee-test.example  | agent | zones 0 | verification tasks 0
 dispatch.admin@koolee-test.example | admin | zones 0 | verification tasks 0
```

They are **not** regenerated (nothing recreated them across three seeds and a full
integration run), and they hold no zones so auto-assign can never pick them. But
`dispatch.a` is still the assignee on **two dev bookings**, so the local ops board shows
work assigned to a non-existent agent. Local-only cosmetic debt; nothing to do with
hosted. Recorded as **N2**.

---

## 5. ResendNotifier (Phase 4) — PARTIAL

Two of this section's stated expectations do not hold as written. The implementation
itself is sound; the expectations were.

### 5.1 Seam — PASS on substance, with two corrections

- The adapter is confined to `packages/core/src/notifications/resend/` and is selected
  through `createNotifier(config)` (`notifications/factory.ts:17-22`), injected by the app
  via `createRuntime`. Core is handed a value, never an env var.
- **Correction (drift, not a defect):** the adapter sits behind the **`Notifier`**
  interface, *not* `NotificationDispatcher`. `NotificationDispatcher`
  (`notifications/dispatcher.ts`) is the separate custody-event / SMS seam and still
  defaults to `NoopDispatcher` (`config.ts:106`). The prompt named the wrong seam.
- **FAIL as stated — "ESLint boundary present":** there is **no** ESLint rule for the
  Resend adapter. `packages/config/eslint/base.mjs` `restrictedImports.paths` lists only
  `stripe`, `unpdf`, `@anthropic-ai/sdk`; `packages/core/eslint.config.mjs` has per-directory
  exemptions for `payments/stripe`, `extraction/*` and `slots/cutoff.ts` — nothing for
  `notifications/resend`. This is currently **moot**: `ResendNotifier` uses the REST API
  through an injectable `fetch` and there is no `resend` package in any `package.json`, so
  there is no import to restrict. But the file's own comment says *"if the `resend` SDK is
  ever adopted, it may be imported HERE only"* — and nothing enforces that. Recorded as
  **N3**.

### 5.2 "packages/core reads zero env" — **FALSE**

```
$ grep -rn "process\.env" packages/core/src | grep -v "\.test\.ts"
packages/core/src/payments/factory.ts:7:      * … never touches `process.env`.   (comment)
packages/core/src/auth/hash-destination.ts:16:  const key = process.env.OTP_LOG_HMAC_KEY;   ← REAL READ
packages/core/src/notifications/factory.ts:7:  * `process.env`. …                (comment)
```

`hashDestination()` reads `process.env.OTP_LOG_HMAC_KEY` directly and throws if it is
unset. This is **pre-existing** — it arrived with the OTP-PII pass, not with this slice —
and it is the *only* real read in core. Reporting it because the section asked for "expect
none" and the honest answer is "one, and here it is". Recorded as **N4**.

### 5.3 Notifier selection, both branches — PASS

`packages/core/src/notifications/resend/notifier.test.ts`, run in isolation, 6/6 passed,
including:

```
✓ createNotifier > selects Resend when a key is injected, console otherwise
✓ POSTs the exact Resend payload shape
✓ omits html from the payload when the message has none
✓ throws ResendSendError with the status on a non-2xx response
✓ propagates network failures — swallowing is the caller's decision
✓ keeps SMS on the console fallback — never touches the Resend API
```

App-side resolution: `apps/web/src/lib/core.ts:71-74` — `RESEND_API_KEY` present →
`{ kind: "resend", … }`, absent → `{ kind: "console" }`. Exercised live in this run: the
dev servers were started with `RESEND_API_KEY=""` and every send landed on the console
notifier (see §6). No real email was sent to anyone during this run — deliberate, since
`apps/web/.env.local` *does* carry a real Resend key locally.

### 5.4 Production boot gate — PASS

`apps/web/src/env.ts:312-326` throws when `isProd && Supabase configured && !comingSoon &&
!RESEND_API_KEY`, exempting the build phase.

`npx vitest run src/env.test.ts` → **13 passed**, including:

```
✓ throws at import when RESEND_API_KEY is missing on a live prod boot
✓ boots without RESEND_API_KEY when the deploy is coming-soon
```

The run did **not** make `RESEND_FROM` or `OPS_ALERT_EMAIL` required: `RESEND_FROM` has a
sandbox default (`env.ts:99`) and `OPS_ALERT_EMAIL` is `optionalString`. That is a
deliberate choice, but it has a consequence — see **N5**.

### 5.5 A thrown send does not fail the calling flow — PARTIAL

The guards exist and are correct:
- `jobs/functions.ts:161-171` — confirmation email `try/catch` → ops-alert, return
  `{ sent: false, reason: "send_failed" }`.
- `jobs/functions.ts:265-274` — reminder email, same shape.
- `services/create-booking.ts:355-364` — dispatcher send `try/catch` → `console.error`.

**But no test covers any of them.** The only test in the repo that drives a throwing
notifier is `waitlist/notify-covered.integration.test.ts` (its `FlakyNotifier`, proving
per-row isolation in the zone-opened sweep). `packages/core/src/jobs/functions.ts` has
**zero** test files — the only test under `src/jobs/` is
`cleanup-anonymous-users.integration.test.ts`. Recorded as **N6** (shared with §6.3).

### 5.6 SMS untouched — PASS

No Twilio SDK anywhere: `grep -rni twilio` over `packages/core/src`, `apps/*/src` and every
`package.json` returns **comments only** — `notifier.ts:75` (`TODO(notifications): the real
SMS adapter (Twilio) lands with a later work item`), `resend/notifier.ts:78`,
`functions.ts:226`, and `apps/web/src/actions/auth.ts:26-29` (which explicitly forbids
importing the Twilio SDK, since auth OTP is Supabase's). `ResendNotifier.sendSms` delegates
to the console fallback, pinned by the test above.

---

## 6. Email side effects (Phase 5) — PARTIAL

### 6.1 Inngest registration and crons — PASS (live)

Queried the running Inngest dev server (`http://localhost:8288/v0/gql`):

```
registered functions: 8
  koolee-agent-no-show-check            EVENT:booking/agent_no_show_check
  koolee-booking-confirmation-email     EVENT:booking/confirmed
  koolee-booking-pickup-reminder        EVENT:booking/confirmed
  koolee-capture-due-bookings           CRON:*/5 * * * *
  koolee-cleanup-anonymous-users        CRON:TZ=America/New_York 0 4 * * *
  koolee-cutoff-risk-monitor            CRON:*/5 * * * *
  koolee-exception-ops-alert-email      EVENT:booking/exception_raised
  koolee-waitlist-zone-opened-sweep     CRON:TZ=America/New_York 0 10 * * *
```

Six come from `createKooleeFunctions`; `cleanup-anonymous-users` and `capture-due-bookings`
are added in `apps/web/src/lib/inngest.ts:84-91`.

**Both `*/5` crons fired during the run** — counted from the web dev-server log:

```
3 × fnId=koolee-cutoff-risk-monitor      (each followed by "No in-transit bookings at risk.")
3 × fnId=koolee-capture-due-bookings
```

### 6.2 Confirmation email — PASS (live)

Completing the §3.2 booking produced, on the dev console (`ConsoleNotifier`):

```
[notify:email] → e2e.tester@koolee-e2e.example: Pickup confirmed — DL123 from JFK
Hi Validation Probe,

Your Koolee pickup is confirmed for flight DL123 from JFK.

Pickup window: Sun 30 Aug, 8:00 AM – 9:00 AM EDT
Flight departs: Mon 31 Aug, 2:00 PM EDT
Pickup address: 22 W 34th St, New York, NY 10001
Bags: 3 bags

Price:
  Base fee: $29.00
  Bags: $45.00
  Distance: $9.00
  Family rate (10% off 3+ bags): $-8.30
  Total: $74.70

We collect your 3 bags at your door, seal each one in front of you, and deliver them
to your airline's bag drop. You travel to the airport hands-free.

Track your trip: http://localhost:3000/trips/f4a6ad83-a824-4a10-8325-635d25b703a3
POST /api/inngest?fnId=koolee-booking-confirmation-email&stepId=step 206
```

Present: flight, window **in the booking's airport tz with the `EDT` abbreviation**,
departure instant, address, bag count, full price breakdown (including the family
discount), trip link.

**Not present: a booking "ref".** This is unfulfillable, not missed — see Drift D1.

Banned copy: `grep -rniE "check you in|checks you in|handled by TSA"` over `packages` and
`apps` returns **zero hits**. The required phrasing is present and pinned by tests —
`emails.ts` renders `"deliver them to your airline's bag drop"` in 8 places, and
`emails.test.ts:67-70,98` asserts `toContain("airline's bag drop")` for the confirmation,
the reminder and the third template.

### 6.3 Reminder — PARTIAL

- **Scheduling mechanism: verified.** `jobs/functions.ts:199` — `await
  step.sleepUntil("wait-until-2h-before-pickup", remindAt)`, with an immediate-send branch
  when the window is already inside the lead. Live: the reminder function was invoked
  twice (once per booking created in this run) and each run suspended at the sleep step —
  `POST /api/inngest?fnId=koolee-booking-pickup-reminder&stepId=step 206`, with no
  reminder SMS or email in the log, which is the correct behaviour for a pickup ~38h out.
- **Status-check-before-send guard: verified by inspection only.**
  `functions.ts:216-223` (SMS step) and `:243-246` (email step) both re-read the booking
  and bail unless `REMINDER_WORTHY = {"paid", "agent_assigned"}` contains its status.
- **NO TEST EXISTS for either.** `packages/core/src/jobs/functions.ts` has no test file.
  Searching for `REMINDER_WORTHY` or `reminder` across all `*.test.ts` finds only
  `notifications/emails.test.ts:68-70`, which is a copy assertion on the template — it
  never exercises the function, the sleep, or the guard. The section asked for this to be
  proven "by test"; it is not. Recorded as **N6**.
- A live end-to-end reminder probe was **not** attempted: the earliest bookable window is
  ~38h out, so `sleepUntil` would not resume inside this run. Stating that explicitly
  rather than faking it, as the prompt asks.

### 6.4 Exception ops alert — PASS on the wired path, **FAIL on coverage**

The alert function itself works. Emitting `booking/exception_raised` against the §3.2
booking produced:

```
[notify:email] → ops-validation@koolee-test.example: Exception — booking f4a6ad83-…
Booking f4a6ad83-… entered the exception state.

Reason: validation probe — ops alert path
Raised by: system

Resolve it from the admin console's exceptions queue.
POST /api/inngest?fnId=koolee-exception-ops-alert-email&stepId=step 206
```

**But almost nothing emits that event.** `emitExceptionRaised` has exactly **one** call
site in the entire repo:

```
$ grep -rn "emitExceptionRaised(" --include=*.ts --include=*.tsx apps packages
apps/web/src/app/api/webhooks/stripe/route.ts:61
```

Meanwhile `raise_exception → "exception"` is a legal transition from **seven** states
(`booking/state-machine.ts:53-81`), and the primary operational path —
`reportVisitException` in `services/agent-visit.ts:371`, driven by the agent app's
`reportExceptionAction` — moves the booking to `exception` and writes a custody event
**without emitting anything**. Neither the agent app nor the admin app has any Inngest
wiring at all (`grep -rn inngest apps/agent/src apps/admin/src` → no hits; both apps 404 on
`/api/inngest`), and `packages/core` never sends events.

**Consequence:** an agent who flags a problem at the customer's door produces no ops alert
email. Only a Stripe payment failure does. Ops learn about field exceptions solely from the
`/exceptions` board. Recorded as **Blocker B2**.

### 6.5 Idempotency — PASS (live)

`emitBookingConfirmed` sends with a deterministic id `booking-confirmed:<bookingId>`
(`apps/web/src/lib/booking-events.ts:31`); `emitExceptionRaised` uses
`booking-exception:<bookingId>:<dedupeKey>`.

Live replay of the **identical** event id against the running dev server:

```
before replay: 1 confirmation email in the log
POST /e/dev_key {"id":"booking-confirmed:f4a6ad83-…","name":"booking/confirmed",…}
→ {"ids":["01M157MB4AMN15MNRMJZ7A38MV"],"status":200}
after 16s:     1 confirmation email in the log   ← no duplicate
```

Callers additionally gate on "this call performed the move" (`movedTo` / `movedToPaid`),
which is what holds beyond Inngest's dedup window.

---

## 7. Docs + tracker — PARTIAL

### 7.1 Manual-setup doc — PASS

All four required items are documented:

| Item | Where |
|---|---|
| Resend account + DNS records | `RUN-REPORT-3.md:281-285` — *"resend.com/domains → add domain → publish the DKIM/SPF records → after verification set `RESEND_FROM=Koolee <notify@koolee.cloud>`"*, with the verified-live note that the sandbox From only delivers to the Resend account's own address (403 for anyone else). Echoed in `docs/CODEBASE-MAP.md:825-831`. |
| Three env vars, per environment | `docs/ENVIRONMENT.md:91-93` (per-app/per-scope matrix) + `RUN-REPORT-3.md:286-293` (Vercel Production vs Preview, incl. `NEXT_PUBLIC_APP_URL` or the emails ship with no CTA). |
| Hosted migration command for Phase 1 | `RUN-REPORT-3.md:262-275` — inline `DIRECT_DATABASE_URL=… pnpm db:migrate`, with the blast radius spelled out per index. Also `docs/MIGRATIONS.md:87-98`. |
| Hosted re-seed note | `RUN-REPORT-3.md:276-280` — `DATABASE_URL='<hosted pooler>' pnpm --filter @koolee/db seed`, noting staff/zone seeding self-skips on non-local hosts. |

### 7.2 PROJECT-STATUS.md — PASS

- **#47** — row 294, marked **✅**.
- **#15** — row 257, **🔨**, body reads *"2026-08-22: Resend email SHIPPED … Still open:
  SMS (Twilio), AeroAPI, Maps"*. Correct partial.
- **#16** — row 258, **🔨**, *"email side effects SHIPPED"*, with the SMS/no-show remainder
  still open. Correct partial.
- **Snapshot §3** is current: it leads with the dispatch/email slice and the v0.2.0
  release, and states the production project is *"migrated 21/21 by hash"* — which matches
  this run's local `Applied: 21 of 21 (matched by content hash)`.
- **Migration-state prose**: §3.1 is explicitly framed as a dated 2026-08-10 incident
  record (*"verified, not assumed"*) and explains why `db:status` is the authority. Its
  "16 migrations" figure is historical, which the section's date makes clear.

One inaccuracy in the snapshot: §3 says the confirmation email was *"verified live
end-to-end locally (real Resend delivery)"*. This run verified the **console** path only
(`RESEND_API_KEY` deliberately blanked so no real mail left the machine), so that specific
claim was not re-tested today — it is not contradicted, just not re-proven.

### 7.3 `docs/CODEBASE-MAP.md` — **FAIL** (stale migration-state prose)

`docs/CODEBASE-MAP.md:843-845`, in the deploy checklist:

> 1. Apply pending migrations to the hosted project over the direct connection.
>    _(Migration `0012` — virtual windows — is applied locally but **not** yet hosted.)_

This is **wrong and stale**. Local is at 0020 (21/21 applied by hash) and both
RUN-REPORT-3 and PROJECT-STATUS record hosted as migrated well past 0012. This is exactly
the "migration-state claim made from prose" that §7 asks to be absent, and it is the same
class of error that §3.1 was written to correct. Recorded as **N7**.

Two smaller doc staleness items in the same file / report:
- `docs/CODEBASE-MAP.md:855-857` still lists *"the Inngest jobs' side effects"* among the
  open items before launch — shipped in this slice.
- `RUN-REPORT-3.md:295-296` (Unit 2's local-dev check) says *"the Inngest dev UI lists 7
  registered functions"*; the actual count is **8**, as Unit 3's own section in the same
  file correctly states.

---

## (a) Blockers before hosted rollout

**B1 — Hosted migration state is documented-as-done but unverified.**
`RUN-REPORT-3.md` marks the hosted 0019/0020 migration and re-seed ✅, and PROJECT-STATUS
claims prod is 21/21 by hash. This run made **no** hosted connection, so neither was
re-proven here. Given the project's own history (§3.1: the tracker was wrong about hosted
migration state in three places), do not treat the prose as proof. Run, from your own
shell, against each hosted project:
```bash
DIRECT_DATABASE_URL='<hosted direct 5432 url>' pnpm db:status
```
and confirm `Applied: 21 of 21 (matched by content hash)` and `In sync`. Read the
`Target host:` line each time. **This is the only item that must be cleared before rollout.**

**B2 — The exception ops alert covers one path out of seven.**
`booking/exception_raised` is emitted **only** from `apps/web/src/app/api/webhooks/stripe/route.ts:61`
(payment failure). An agent flagging a problem in the field (`reportVisitException`, the
main operational path) moves the booking to `exception` and emits nothing, so no ops email
is sent. Neither the agent nor the admin app has Inngest wiring, and core emits no events —
so this cannot be fixed by adding a call in either staff app without first giving one of
them (or a core-level seam) an emitter. Shipping "ops gets emailed when a booking hits
exception" as a capability is not yet true. Not a data-integrity risk; a coverage gap in
the thing the feature is for. Decide before rollout whether that is acceptable for launch.

---

## (b) Non-blocking findings

| # | Finding | Where |
|---|---|---|
| **N1** | `apps/{web,agent,admin}/.env.local` set `DIRECT_DATABASE_URL` to the **hosted** dev project while `DATABASE_URL` is local. Nothing reads it today (app runtime uses `DATABASE_URL`; `packages/db` doesn't load app env files), but it is a hosted DDL credential one `dotenv -e` away from the migrator — the accident the `packages/db/.env` LOCAL flip exists to prevent. | app env files |
| **N2** | Four `dispatch.*@koolee-test.example` fixture users survive in the **local dev** DB from 2026-08-10 (pre-#48). Not regenerated, hold no zones, but `dispatch.a` is still the assignee on two dev bookings, so the local board shows work assigned to a non-existent agent. `koolee_test` is clean. | local dev DB only |
| **N3** | No ESLint boundary for the Resend adapter. `restrictedImports.paths` covers `stripe`/`unpdf`/`@anthropic-ai/sdk` only. Moot today (REST + injectable fetch, no `resend` dependency) but the file's own "may be imported HERE only" rule is unenforced if the SDK is ever added. | `packages/config/eslint/base.mjs:13-42` |
| **N4** | `packages/core` is not env-free: `auth/hash-destination.ts:16` reads `process.env.OTP_LOG_HMAC_KEY` and throws if unset. Pre-existing (OTP-PII pass), and the only such read — but the "core reads zero env" claim in the comments at `payments/factory.ts:7` and `notifications/factory.ts:7` is not literally true. | `packages/core/src/auth/hash-destination.ts` |
| **N5** | `OPS_ALERT_EMAIL` has **no** production boot gate — it is `optionalString`, and `exceptionOpsAlertEmail` logs `"OPS_ALERT_EMAIL not configured; skipping exception email."` and returns. A production deploy that forgets it silently loses every ops alert, with no boot failure. `RESEND_FROM` is similar but has a working sandbox default, so it degrades visibly instead of silently. | `apps/web/src/env.ts:92`, `jobs/functions.ts:302-305` |
| **N6** | `packages/core/src/jobs/functions.ts` — all six Inngest functions — has **zero** tests. Uncovered: the reminder's `sleepUntil` and `REMINDER_WORTHY` guard, the confirmation/reminder `try/catch` that keeps a thrown send from failing the flow, and the exception alert's unset-address skip. The only throwing-notifier test in the repo covers the waitlist sweep. | `packages/core/src/jobs/` |
| **N7** | `docs/CODEBASE-MAP.md:843-845` still says migration `0012` is *"applied locally but not yet hosted"* — false, and precisely the prose-migration-claim §7 asks to be absent. Same file:855-857 lists the now-shipped Inngest side effects as open. `RUN-REPORT-3.md:296` says the dev UI lists "7 registered functions"; it lists 8. | docs |

---

## (c) Drift between the slice prompt and what was implemented

**D1 — "ref" in the confirmation email.** The prompt (and `jobs/functions.ts:85`'s own doc
comment) says the confirmation email carries a booking *ref*. **No such field exists**:
`bookings` has 21 columns and none is a reference / confirmation code
(`id, user_id, status, flight_number, airline_iata, departure_airport, departure_at,
pax_name, pickup_address_id, bag_count, slot_id, price_cents, currency, created_at,
updated_at, contact_phone, pickup_window_start, pickup_window_end, price_breakdown,
display_tz, booked_from_tz`), and `grep -i "reference|confirmationCode|bookingRef"` over
the schema returns only foreign-key `.references()` calls. The email identifies the booking
by flight + airport in the subject and by the trip-page URL (a UUID). Either the data model
needs a human-readable reference or the doc comment should stop promising one — the code is
not at fault.

**D2 — Wrong seam named.** §5 says the adapter "lives behind `NotificationDispatcher`". It
lives behind **`Notifier`**. `NotificationDispatcher` is the separate custody-event/SMS seam
and is still `NoopDispatcher` by default. The implementation is right; the prompt named the
wrong interface.

**D3 — "`config.ts` selection".** §5 expects the console/Resend choice in `packages/core`'s
`config.ts`. It is actually in `notifications/factory.ts` (`createNotifier`) with the env
read pushed out to `apps/web/src/lib/core.ts:71-74`. That is *better* than what was asked —
it is what keeps core env-free — but it is not where the prompt says to look.

**D4 — "ESLint boundary present" (§5).** Asserted as existing; it does not. See N3.

**D5 — "unit test exists and passes" for the thrown-send guard (§5) and "by test" for the
reminder guard (§6).** Both asserted as existing; neither does. See N6.

---

## Probe residue left in the local dev database

Nothing was committed and no fix was applied. Two probe bookings remain in the **local**
dev DB (they were the probes):

- `f4a6ad83-a824-4a10-8325-635d25b703a3` — "Validation Probe", `agent_assigned`, 3 bags,
  $74.70, assigned to `agent2@koolee.local`. Carries one `booking.agent_assigned` custody
  event with a null actor and one `booking/exception_raised` alert emitted against it.
- `bd795c9e-6703-4538-8b37-b39fd376ae94` — "Uncovered Zip Probe", `paid`, unassigned, 1
  bag, $53.00. Its `pickup_window_start/end` were deliberately shifted to +6h/+7h to make
  the board's at-risk badge render; it is not real data.

`agent_zones` was restored (198/198). The scratch database `koolee_migfail_probe` was
dropped. `pnpm local:reset` clears all of the above if you want a clean dev DB.

The dev servers started for this run (web/agent/admin with `RESEND_API_KEY=""`, plus the
Inngest dev server) have all been stopped. The Supabase stack on 54321/54322 is still up —
bring it down with `pnpm local:down` if you want the ports back.

One pre-existing process was stopped during this run, with the user's explicit go-ahead: a
`next dev` server occupying port 3000, which belonged to an unrelated project
(`GS-internal-apps-fe`), not to Koolee.
