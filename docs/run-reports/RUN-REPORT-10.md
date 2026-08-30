# Run report 10 — Slice F3: web push, dispatch timing, email fixes

**Branch:** `feat/f3-push-and-dispatch-timing`, cut from `origin/dev` @ `a9e17aa`
with `--no-track`. Verified before any work:

```
$ git config --get branch.feat/f3-push-and-dispatch-timing.merge   # empty (exit 1)
$ git status -sb
## feat/f3-push-and-dispatch-timing                                # no upstream
```

**One session, one branch. NO COMMITS** — each phase is checkpointed here; TD
commits after review.

**Databases touched: LOCAL ONLY.** `127.0.0.1:54322` for migrations and the
seed, the disposable `koolee_test` for the integration tier. Hosted is never
contacted. Hosted steps are TD's, in `docs/features/f3-hosted-setup.md`.

**Precondition checked before anything else.** F2 is merged into `dev`
(PR #32, `a9e17aa`) and `booking_signals` exists — `packages/db/src/schema/signals.ts`,
migrations `0030_booking_signals.sql` and `0031_booking_signals_grant.sql`, both
on `origin/dev`. The slice was cleared to start.

**Reference POC.** `/Users/tarundadlani/code/personal/chrome-notify`. Its README
and three docs are copied verbatim to
[`docs/fixtures/chrome-notify/`](../fixtures/chrome-notify/), with a
[README-KOOLEE.md](../fixtures/chrome-notify/README-KOOLEE.md) saying what they
are for and recording the one open question F3 answered. Reference, not code:
the slice ported the POC's DECISIONS, not its files.

---

## Phase 0 — Email fixes

### 0.1 What was actually wrong

Two dispatch points existed for one email and they sent **different emails**.

| | `booking/confirmed` Inngest function | `attachEmailPostBooking` (guest adds email on the confirmed screen) |
|---|---|---|
| Builder | `buildBookingConfirmationEmail` — branded HTML + text | hand-rolled plain-text body in `services/confirmation-email.ts` |
| Subject | `Pickup confirmed — KOO-7H2QM · DL123 from JFK` | `Koolee pickup confirmed — DL123 from JFK` |
| Booking ref | present (the one token support can act on) | **absent** |
| Price breakdown | itemised + total | `$68.00 authorized` only |
| Pickup address | present | absent |
| Agreement nudge | present | absent |
| Trip link | absolute `https://…/trips/<id>` | **`/trips/<id>` — a relative path, in an inbox** |

So whoever paid as a guest — precisely the customer with the least context —
got the materially worse email, with an unclickable link, and nothing in the
type system or the tests said so.

### 0.2 The shape chosen

Not "make the second path call the builder", which would have duplicated the
~50 lines of row-reading and label-formatting that turn a booking row into the
builder's input. Those reads are where the divergence would come back.

Instead the assembly is extracted once:

- **`assembleBookingConfirmationEmail(config, { booking, to, appOrigin })`**
  ([`services/confirmation-email.ts`](../../packages/core/src/services/confirmation-email.ts))
  — reads the address and the display zone, formats the window and departure
  in the BOOKING's tz, maps the persisted `priceBreakdown` to `PriceLine[]`,
  and returns the `EmailMessage`. No I/O beyond the two reads, no decisions
  about *whether* to send.
- **`sendBookingConfirmationEmail(config, { bookingId, email, appOrigin })`** —
  loads the booking (throws `NotFoundError` if absent), assembles, sends. The
  guest path's entry point; unchanged signature plus `appOrigin`.
- The Inngest function keeps its own skip rules (`booking_missing`,
  `cancelled`, `no_email`) and its `try/catch` + ops-alert, and now calls the
  assembler for the message. **Net −49 lines in `jobs/functions.ts`.**

One builder, one assembler, two dispatch points that differ only in what they
do when a send fails — which is correct, because they genuinely differ there
(the job ops-alerts and returns a reason; the Server Action lets its existing
catch log).

### 0.3 The absolute URL

`tripUrlFor` was a closure inside `createKooleeFunctions`, reachable only from
the Inngest factory. Lifted to
[`notifications/links.ts`](../../packages/core/src/notifications/links.ts) as
`tripUrlFor(appOrigin, bookingId)`, now used by both paths. Core still reads no
env: `apps/web/src/actions/auth.ts` passes `optionalEnv("NEXT_PUBLIC_APP_URL")`
at the call site, the same value `lib/inngest.ts` already passes as
`appOrigin`.

An absent origin yields `undefined`, and the builder omits the CTA entirely
rather than emitting a relative href — asserted, along with the fact that no
CTA means Tag Orange appears nowhere in the message.

This file is where Phase 4's deep links (task detail, admin booking) will be
added, so push and email name the same URLs.

### 0.4 Idempotency: traced, and there is no double-send to guard

The prompt asked whether the guest-add-email path and the Inngest confirmation
can both fire for one booking. **They cannot**, and no guard was added.

The chain, each link verified in the code:

1. `apps/web/src/app/book/confirmed/page.tsx:81` renders
   `<ConfirmationEmailCard>` only when `!hasEmail` — where `hasEmail` is
   `Boolean(userRow?.email ?? authUser?.email)`. A customer who already has an
   email is **never offered the card**, so `attachEmailPostBooking` is
   unreachable for them.
2. That is exactly the case in which the Inngest function returned
   `{ sent: false, reason: "no_email" }` (`jobs/functions.ts`, the
   `if (!customer?.email)` branch). It did not send.
3. That return is a **successful** `step.run` — not a throw — so Inngest
   memoizes it. A retried run replays the memoized result and never re-reads
   the now-populated email. There is no "Inngest retries after the guest adds
   an email" path.
4. The webhook/return-page race that could produce two events is already
   collapsed upstream: senders emit with event id `booking-confirmed:<id>`, so
   Inngest dedupes to one event before any of this.

The theoretical window is: guest pays, and adds an email in the sub-second
before the Inngest run reads `users.email`. That requires the customer to load
the confirmed page, type an address and submit it faster than the queue
dispatches a job — and its cost is one duplicate email, not a wrong charge or a
wrong state. Guarding it would mean a persisted send-marker on `bookings` for a
race nobody can hit; **not built**, deliberately, and recorded here so the
question is not re-opened as an unknown.

### 0.5 Tests

New: [`services/confirmation-email.test.ts`](../../packages/core/src/services/confirmation-email.test.ts)
(6 cases, `fakeDb` harness — no database needed):

- sends the branded template, asserted by the template's subject shape and the
  presence of `html`;
- **the trip link is absolute** in both body and HTML, and the old
  `Track your pickup: /trips/` string appears nowhere — the regression itself;
- no origin ⇒ no CTA and no `#FF6B35` anywhere;
- copy rules: `deliver them to your airline's bag drop` present, "check you in"
  absent from body and HTML;
- times carry the airport zone abbreviation (`EDT`);
- a missing booking throws `NotFoundError` rather than emailing a blank.

Three of those assertions (`Booking reference:`, `Total: $68.00`,
`airline's bag drop`) are deliberately the same ones `jobs/functions.test.ts`
makes of the Inngest path, over an identical fixture: if the two dispatch
points ever stop sharing an assembler, one of the two suites fails.

### 0.6 Gates

| Gate | Result |
|---|---|
| `turbo typecheck` | 6/6 ✅ |
| `turbo lint` | 6/6 ✅ |
| `turbo test` (unit) | core 492 ✅ · web 119 ✅ · admin 27 ✅ · agent 19 ✅ · ui 102 ✅ |
| `@koolee/core test:integration` (`koolee_test`) | 248 passed, 3 skipped ✅ |

Files touched: `packages/core/src/services/confirmation-email.ts` (rewritten),
`packages/core/src/notifications/links.ts` (new),
`packages/core/src/services/confirmation-email.test.ts` (new),
`packages/core/src/jobs/functions.ts`, `packages/core/src/notifications/index.ts`,
`packages/core/src/services/index.ts`, `apps/web/src/actions/auth.ts`.

---

## Phase 1 — Deferred agent assignment

### 1.1 What changed, in one sentence

`autoAssignOnPaid` now assigns only when the pickup window is inside a
configurable horizon; a five-minute Inngest sweep assigns the rest as their
windows come into range.

### 1.2 The horizon

`CoreDefaults.assignmentHorizonHours`, default **48**. Resolved by the apps
from `ASSIGNMENT_HORIZON_HOURS` and injected through `createRuntime({ defaults })`
— core reads no env.

The predicate lives in its own module,
[`services/assignment-horizon.ts`](../../packages/core/src/services/assignment-horizon.ts),
rather than inside `auto-assign.ts`. Not tidiness: `auto-assign.ts` imports
`dispatch.ts` for `assignAgentToBooking`, and `dispatch.ts` needs the same
predicate for the board's at-risk flag — sharing it in either direction would
have been an import cycle. Three callers, one definition, no cycle.

The env value is parsed in each app's `lib/core.ts`, not in `env.ts`, and a
non-numeric or non-positive value **warns and falls back to the default**.
`Number("fourty-eight")` is `NaN`, and `NaN` makes `withinAssignmentHorizon`
false for every booking — an app that boots and silently stops assigning
anybody. Parsed in web and admin only; the agent app neither assigns nor
renders at-risk state.

### 1.3 On-paid behaviour

Inside the horizon: unchanged, byte for byte — the same `autoAssignBooking`
call, the same task pair, the same system-actor custody event. At the default
48 hours that is every same-day and next-day booking.

Beyond it: **nothing is created.** The hook reads `pickup_window_start` and
returns before `autoAssignBooking`. No verification task, no pickup task, no
custody event, and the booking rests in `paid`.

### 1.4 Task-creation reconciliation — the decision, with evidence

The prompt asked for ONE coherent rule, and recommended deferring both
creations. **Adopted, and the codebase supports it rather than contradicting
it.** The evidence:

- `assignAgentToBooking` (`services/dispatch.ts`) creates the verification
  task and the pickup task **in one transaction**. Deferring the call defers
  both; the paired-creation invariant is untouched, and the pair can never be
  half-made. No change was needed inside that function at all.
- The pickup task is not a driver assignment. Since Tier 4 the driver is
  chosen by `selectDriver`, which **updates** the existing pickup task row
  (`driver-selection.ts` — `tx.query.pickupTasks.findFirst`, then
  `tx.update(pickupTasks).set({ driverShiftId, assigneeUserId })`), throwing
  `NotFoundError` if the row is absent.
- So the question is whether deferring the row can ever strand a driver
  selection. It cannot: `assertSelectable` restricts selection to
  `DRIVER_SELECTABLE_STATUSES = ["verified_sealed", "awaiting_pickup"]` —
  **post-sealing**. Sealing requires a completed agent visit, which requires
  an assigned verification task. A booking whose pickup task has been deferred
  is by construction still in `paid`, where selection is refused with
  "a driver is chosen once the bags are sealed" and always was.

Nothing customer-visible changes, and the invariant is preserved by
construction rather than by remembering to keep two writes in step.

### 1.5 The sweep

`assignEnteringHorizon(config)` → Inngest function `assignment-horizon-sweep`,
cron `*/5 * * * *` (the same pattern as `capture-due-bookings` and
`cutoff-risk-monitor`, for the same reason: nothing server-side observes a
clock crossing a threshold, so the sweep IS the observation).

Selection: `status = 'paid'`, **no verification-task row**,
`pickup_window_start <= now + horizon`, ordered by window, capped at 200.

Two properties make it safe, both proven against a real database:

- **Already-assigned bookings are invisible by construction.** The
  `verification_tasks` left-join + `IS NULL` means an admin's early manual
  assignment is never seen — there is no "never reassign" rule to remember
  and no way to forget it.
- **Concurrent runs collapse.** Four sweeps fired simultaneously all
  `considered: 1`; exactly one landed in `assigned`, the rest in `raced`.
  The 0019 unique index on `verification_tasks(booking_id)` is the referee and
  23505 is read as "already assigned", never an error — the same discipline as
  the two-concurrent-paid test.

Assignment is **sequential** within a batch, deliberately: the candidate
ranking counts each agent's open tasks, so two bookings assigned in parallel
would both read the load from before either was written and pile onto the same
person.

Per-booking `try/catch`, so one uncoverable ZIP cannot stop the batch. A
booking nobody covers is reported `uncovered` and stays `paid` — the board's
problem now, correctly, because it is inside the horizon.

### 1.6 At-risk honesty

`getOpsDashboard` and `listBookingsBoard` both took a bare `now: Date`; both
now take a `BoardContext { now?, assignmentHorizonHours? }`. The admin app
passes `core.defaults.assignmentHorizonHours` at both call sites, so the
console and the sweep cannot disagree about where the line is.

- `unassignedToday` gains `pickup_window_start <= now + horizon`.
- The board's `no_agent` flag gains `withinAssignmentHorizon(...)`.

At the default this changes nothing — every window "today" is inside 48 hours,
and the board's own at-risk window is 12 hours, which is stricter. **That is
exactly why it had to be written down.** Set `ASSIGNMENT_HORIZON_HOURS=6` and
tonight's 11 PM pickup is legitimately unassigned at 9 AM; without these two
clauses the console would show a red badge for work the sweep is going to do
at 5 PM, which teaches operators to ignore the badge.

The test proves the distinction is the horizon and nothing else: the **same
row at the same instant** reads `atRisk: false` under a 1-hour horizon and
`atRisk: true, no_agent` under a 48-hour one.

### 1.7 Consequences checked

- **"Agent assigned" email** now arrives at horizon entry. No template change:
  `emitAgentAssigned` fires from `assignAgentToBooking`, which the sweep calls
  through the ordinary path.
- **Pre-window reminder — unaffected, cited.** `booking-pickup-reminder`
  sleeps until `subHours(event.data.pickupStartAt, 2)` — the window from the
  `booking/confirmed` event, never the assignment — and then re-reads the
  status against `REMINDER_WORTHY = new Set(["paid", "agent_assigned"])`.
  Both statuses are reminder-worthy, so deferral cannot suppress a reminder
  even in the pathological case of a horizon under two hours.
- **The customer-facing copy was already right.** The trip page renders
  "Assigned closer to your window" when no agent is attached
  (`apps/web/src/app/trips/[bookingId]/page.tsx`). That sentence was
  previously aspirational — assignment happened seconds after payment — and is
  now literally true. No copy change.
- **Admin override** is untouched: `autoAssignBooking` from
  `apps/admin/src/app/bookings/actions.ts` still assigns immediately at any
  distance, and the sweep skips the result by construction.

### 1.8 Tests

- [`assignment-horizon.test.ts`](../../packages/core/src/services/assignment-horizon.test.ts)
  — 7 unit cases on the predicate: boundary inclusive (it must agree with the
  sweep's `<=` SQL to the microsecond), a past window is in-horizon, a null
  window is never deferred, the configured number is respected, and the
  default is 48.
- [`assignment-horizon.integration.test.ts`](../../packages/core/src/services/assignment-horizon.integration.test.ts)
  — 12 cases against real Postgres: immediate assign inside the horizon;
  **nothing created** beyond it (both task tables asserted empty); a shortened
  horizon defers a booking the default would have assigned; the sweep is a
  no-op before entry and assigns exactly once after; four concurrent sweeps
  assign once; a re-run sees nothing; an admin's early assignment survives
  with its actor id intact; an uncovered ZIP is reported not assigned; the
  at-risk distinction above; and the on-paid hook never throws.

### 1.9 Gates

| Gate | Result |
|---|---|
| `turbo typecheck` | 6/6 ✅ |
| `turbo lint` | 6/6 ✅ |
| `turbo test` (unit) | core 499 ✅ · web 119 ✅ · admin 27 ✅ · agent 19 ✅ · ui 102 ✅ |
| `@koolee/core test:integration` | 260 passed, 3 skipped ✅ (was 248) |
| `turbo build` | 3/3 ✅ |

No migration in this phase — deferral is behavioural, and adding a column to
record "deferred" would be bookkeeping a query already answers.

---

## Phase 2 — Push core (schema, sender, subscription API)

### 2.1 Migration 0032 — GENERATED, NOT APPLIED

[`packages/db/drizzle/0032_push_subscriptions.sql`](../../packages/db/drizzle/0032_push_subscriptions.sql).
Local is at 32/32 by content hash (`pnpm db:status`, target host `127.0.0.1`).
**`pnpm db:migrate` has not been run** — a migration CLI is a TD-confirms
command. The SQL and its risks are in the hand-off at the end of this report.

Shape: `id`, `user_id` (fk → `users`, cascade), `endpoint`, `p256dh`, `auth`,
`label`, `app`, `created_at`, `last_seen_at`, `verified_at`.

**The unique index is on `endpoint` ALONE, not `(user_id, endpoint)`**, and
that is the one decision in this table worth arguing about. An endpoint
identifies one browser install globally. Key the index on the pair and a
device that changes hands gains a SECOND row — the previous owner keeps
receiving notifications about a stranger's bags, forever, with no UI anywhere
that would show it. Keyed on `endpoint`, subscribe is an upsert that moves the
row to the new user. Proven in the integration tier ("a device that changes
hands MOVES to the new person").

`verified_at` exists because of the POC's central finding: `showNotification`
resolving tells you the notification was *created*, not displayed. macOS with
Chrome switched off in System Settings reports success at every layer and
draws nothing. The only trustworthy signal is a human saying "yes, I saw it",
so there is a column for it.

**RLS: deliberately nothing.** The table is server-only — no browser client
ever queries it. 0016's `ensure_rls` event trigger switches RLS on for any new
`public` table, so it lands with RLS enabled and zero policies, which denies
`anon` and `authenticated` outright. The §7 rule "a policy grants nothing, add
the GRANT too" governs CLIENT-READABLE tables (0031, 0016); adding either here
would widen access nothing needs. Written into the migration header so the
next reader does not "fix" the omission.

### 2.2 The `PushSender` seam

[`packages/core/src/notifications/push.ts`](../../packages/core/src/notifications/push.ts)
mirrors `Notifier` exactly: interface, `ConsolePushSender` default,
`RecordingPushSender` for tests, and `pushSender` on `CoreConfig` /
`RuntimeOptions`.

Passed as an INSTANCE rather than a declarative `{ kind: ... }` config — the
same call the Inngest emitter makes, and for the same reason: the real one
needs the `web-push` library, and core must not depend on a Node crypto
library or read three env values.

The real one is
[`apps/web/src/lib/web-push-sender.ts`](../../apps/web/src/lib/web-push-sender.ts).
`web-push` does the two things not worth hand-rolling: the VAPID JWT that
authenticates Koolee to the push service, and AES128GCM encryption against the
subscription's own keys (the push service relays ciphertext it cannot read).

Decisions inside it:

- **TTL 300s.** A task assignment is worth showing five minutes late. An hour
  later the person has seen it in the app or the situation has moved on, and a
  stale alert is worse than none.
- **`urgency: 'high'`** for tasks and exceptions, `'normal'` for customer
  milestones.
- **404/410 prunes; everything else does not.** A 5xx is the provider having a
  bad afternoon — pruning on it would silently unsubscribe people and nothing
  would say why. Pinned by a test.
- **`setVapidDetails` per send, not at module scope.** It is global mutable
  state in the library, and a module-scope call runs on import in processes
  that never send anything.
- **It never throws.** Every call site is an Inngest step whose EMAIL is the
  real notification.

`services/push-subscriptions.ts` holds storage, authorization and the
`pushToUsers` / `pushToTargets` fan-out (send → prune expired → report).
Both swallow everything, by contract.

The ops audience (`listAdminPushTargets`) is **derived** from active admin
`staff_members` — no notification-role column, no recipients table. §7: a
roster on a write path is a thing that has to be kept in step with what it
counts. Deactivating an admin removes them from the audience on the next send;
asserted.

### 2.3 Env, boot gate, keygen

`VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` plus
`NEXT_PUBLIC_VAPID_PUBLIC_KEY` in `apps/web/src/env.ts`, and a **production
boot gate** beside the RESEND / OPS_ALERT_EMAIL / ANTHROPIC ones.

The gate exists because the fallback is `ConsolePushSender`, which logs and
**reports success**: without it a production deploy would report every
notification as sent while no device ever rings. That is the same class of
silent degradation as the heuristic ticket extractor, and worse here, because
push is the channel a driver relies on with the tab closed. The
`NEXT_PUBLIC_` copy is checked separately — a server that can send with a
browser that can never subscribe is a configuration nobody means, and
forgetting that one variable is the likely mistake.

`pnpm push:vapid` → `apps/web/scripts/generate-vapid.mjs`. It **refuses to
overwrite** an existing private key and says why: regenerating invalidates
every row in `push_subscriptions`, every device goes silent while its UI still
reports "subscribed", and recovery means truncating the table and asking every
agent, driver and admin to re-enable by hand. It appends rather than writes,
so it cannot clobber the rest of `.env.local`.

### 2.4 Subscription API — route handlers, not Server Actions

`app/api/push/subscribe/route.ts` in all three apps: `POST` subscribe/
re-register, `PATCH` "I saw it", `DELETE` unsubscribe.

Route handlers are **forced, not preferred**. The service worker's
`pushsubscriptionchange` handler has to re-register a rotated subscription,
and a service worker can only `fetch` a URL — no React, no form, no way to
invoke a Server Action. One endpoint serves the page and the worker so the two
cannot drift.

Authorization is one sentence: **the user comes from the session, never the
body.** There is no field in any payload that names a user, so there is
nothing to forge; core additionally scopes every write by `user_id` so that
knowing an endpoint (a value that travels through logs and proxies) is not
enough to silence somebody's device. Web uses `getVerifiedAuthUser`, not
`getAuthUser`: the funnel's anonymous guests are reaped by
`cleanup-anonymous-users`, and a subscription bound to one would be deleted
out from under a device that still believed it was subscribed.

### 2.5 Dependency added

`web-push@^3.6.7` + `@types/web-push@^3.6.4`, in **apps/web only** (where the
Inngest functions send). Transitive: `asn1.js ^5.3.0`, `http_ece 1.2.0`,
`https-proxy-agent ^7.0.0`, `jws ^4.0.0`, `minimist ^1.2.5`. Same version the
POC ran on. No breaking-change notes — a first install, not a bump. Lockfile
passes the supply-chain policy check.

### 2.6 Tests

- [`apps/web/src/lib/web-push-sender.test.ts`](../../apps/web/src/lib/web-push-sender.test.ts)
  (8, `web-push` faked): the wire shape (stored flat, sent nested — the
  conversion is what breaks), TTL + urgency, 410 **and** 404 prune, a 500 does
  **not** prune, a non-Error rejection is still swallowed, and zero targets
  makes no call at all. Plus `createWebPushSender` returning null on any
  partial configuration rather than a sender that fails every send.
- [`push-subscriptions.integration.test.ts`](../../packages/core/src/services/push-subscriptions.integration.test.ts)
  (12, real Postgres): many devices per person; re-subscribe with rotated keys
  updates in place; **a device that changes hands moves**; cannot delete or
  verify another user's subscription even knowing the endpoint; a deleted user
  takes their rows with them; the ops audience is derived and reacts to
  deactivation; fan-out to every device; prune on expiry; **a throwing sender
  is swallowed and prunes nothing**; nobody subscribed makes no call.
- `apps/web/src/env.test.ts` gained the VAPID gate cases and its
  "complete prod config" fixture gained the four variables.

### 2.7 Gates

| Gate | Result |
|---|---|
| `turbo typecheck` | 6/6 ✅ |
| `turbo lint` | 6/6 ✅ |
| `turbo test` (unit) | core 499 ✅ · web 129 ✅ · admin 27 ✅ · agent 19 ✅ · ui 102 ✅ |
| `@koolee/core test:integration` | 272 passed, 3 skipped ✅ (was 260) |
| `turbo build` | 3/3 ✅ |

---

## Hand-off — two things TD has to run before Phase 3

### 1. Apply migration 0032 to the LOCAL dev database

```sql
CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"label" varchar(120),
	"app" varchar(16) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"verified_at" timestamp with time zone
);
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
CREATE UNIQUE INDEX "push_subscriptions_endpoint_key" ON "push_subscriptions" USING btree ("endpoint");
CREATE INDEX "push_subscriptions_user_idx" ON "push_subscriptions" USING btree ("user_id");
```

Command: `pnpm db:migrate` (targets `127.0.0.1` — verified via `pnpm db:status`).

**Lock / index risk: none.** A fresh `CREATE TABLE` plus two index builds on a
table with zero rows — nothing to lock out, no rewrite, no scan, no
`CONCURRENTLY` needed. Reversible with `DROP TABLE push_subscriptions`. It
touches no existing table: the only reference is an outbound FK to `users`,
which takes a brief `SHARE ROW EXCLUSIVE` on `users` and validates nothing
(the new table is empty).

The integration tier does **not** need this: its harness migrates the
disposable `koolee_test` database itself, which is why 272 tests already pass.
Only the local dev database (and therefore Phase 3's browser verification)
needs the command run.

### 2. Generate a local VAPID pair

`pnpm push:vapid` — writes four lines to `apps/web/.env.local` (gitignored)
and prints the public key. The agent and admin apps each need
`NEXT_PUBLIC_VAPID_PUBLIC_KEY` set to the same value in their own
`.env.local`, or nobody can subscribe there. The script refuses to overwrite
an existing pair; the default subject is `mailto:ops@koolee.cloud` and can be
overridden with `VAPID_SUBJECT=… pnpm push:vapid`.

---

## Phase 3 — Service workers, the shared hook, enable UX

TD applied 0032 (`db:status`: 33/33 in sync, target `127.0.0.1`) and ran
`pnpm push:vapid`, with `NEXT_PUBLIC_VAPID_PUBLIC_KEY` copied into all three
apps' `.env.local`. Verified before starting: `/api/push/vapid` returns the
same key on 3000, 3001 and 3002.

### 3.1 Two things found in the existing agent PWA

**(a) The agent app already had a service worker** (`public/sw.js`, an
offline shell). Per the prompt: the push listeners were **merged into it**,
not shipped as a second worker. That is not tidiness — a scope gets exactly
ONE worker, so registering a `/push-sw.js` at scope `/` would have REPLACED
the offline shell and taken it with it, silently. The file now has a two-job
header and the push listeners below the fetch handler.

**(b) `ServiceWorkerRegistrar` has never registered anything, in any
environment.** It returned `null` — the exact §7 trap F2 paid for
(`TripLive`/`LiveTasks`: a client component that returns `null` never mounts
in a Next 16 / Turbopack production build; its module loads, its body runs,
its effects never fire). And it *also* returned early unless
`NODE_ENV === "production"`. So: nothing in dev by design, nothing in
production by accident. The offline shell it exists to install has never
installed.

Fixed the way F2 fixed it — it renders `<span hidden data-sw={state} />`, and
that attribute is how "did it register?" is answered from the DOM. The dev
guard is gone too: the worker is network-first for navigations and cache-first
for only three precached files, so it cannot serve a stale page, and keeping
the guard would have meant push could never be tested locally.

### 3.2 The hook

[`packages/ui/src/lib/use-web-push.ts`](../../packages/ui/src/lib/use-web-push.ts).
Ported from the POC, dependency-free beyond React.

The VAPID key is **passed in**, not read from the environment: `NEXT_PUBLIC_*`
is only inlined where it is written as a literal member expression, so a
shared package reaching for one gets `undefined` in Storybook, in vitest, and
in any consumer that is not a Next build. Each app reads its own and hands it
over. The SERVICE WORKER cannot be handed anything — it outlives the page and
`pushsubscriptionchange` fires when no page is open — so it fetches
`/api/push/vapid`, added per app. That route is unauthenticated on purpose: it
is a public key, already in every client bundle, and it authenticates Koolee
TO the push service rather than the other way round.

Non-negotiables carried over: permission requested ONLY from a gesture,
`userVisibleOnly: true`, SW registration on mount but never a permission
prompt, and an existing subscription reused rather than re-subscribed (a
re-subscribe with a different key throws `InvalidStateError`).

**Deliberately absent: a `showLocalNotification` helper.** The POC has one as
a debug aid. It would be one line here and it would be a trap — it proves the
worker can draw a notification, which is not the question. The question is
whether a push sent from Koolee arrives, and only a real send answers it.

`unsubscribe` calls the server BEFORE `subscription.unsubscribe()`: the other
order leaves a row alive whose endpoint 410s forever if the server call fails.

### 3.3 The enable UX

`PushEnableCard` in `packages/ui` (§7 — lift it when a second app needs it).
The two staff apps differ by exactly one prop:

- **Agent** (`/account`) passes `verify`, so enabling runs the
  did-you-see-it check: a real push through the full server pipeline, then a
  Yes/No, then platform-aware remediation on No (ordered by likelihood, from
  the POC's debugging notes: the OS per-app switch, Focus/DND, an alert style
  of "None", enterprise policy; iOS gets the Add-to-Home-Screen instruction
  instead). "Yes" writes `verified_at`.
- **Admin** (Overview) does not. An ops person is looking at the board all
  day and the board is already the channel; the step buys less than it costs.
  `POST /api/push/test` still exists there for a manual check.

The card's state is `asking`, never `sent` — because "accepted" is all the
server can honestly report.

**Customer web** gets a soft card on the trip page instead: dismissible,
remembered per booking in `localStorage`, and shown ONLY inside the window
`withinPushPromptWindow` allows (within 24h of the pickup window opening,
until it closes). That test runs on the SERVER, next to the cutoff banner's,
so the server and browser cannot disagree about whether the card exists. On a
platform that cannot do push — iOS Safari not added to the Home Screen — it
renders NOTHING rather than an offer that cannot work.

### 3.4 Browser verification

Two harnesses, because the first one could not answer the question.

**The Playwright MCP is headless, and headless Chromium has no notification
platform backend.** `registration.getNotifications()` came back EMPTY for a
notification the page had just created itself — so it could not distinguish
"nothing was drawn" from "the harness cannot see it". Re-ran headed, driving
the bundled Chromium (`Chrome/149.0.7827.55`) over raw CDP. There, a probe
notification created and listed correctly, which is what makes every result
below trustworthy.

Incidentally this **answers the POC's open question** in `limitations.md`
("whether `getNotifications()` still lists a notification the OS suppressed is
untested"): where the platform cannot draw one, it does NOT list it. So
`getNotifications()` is not a detection signal, and the ask-a-human design is
the right one.

| Check | Agent (3001) | Admin (3002) | Web (3000) |
|---|---|---|---|
| `/sw.js` `no-cache` + `Service-Worker-Allowed: /` | ✅ | ✅ | ✅ |
| Worker registers at scope `/`, active | ✅ (`data-sw="registered"`) | ✅ | ✅ |
| Enable card renders, gesture-only | ✅ | ✅ | n/a (trip-page card) |
| Permission granted → **real FCM subscription** | ✅ | ✅ | — |
| Server send accepted | ⚠️ **see §6.2 — this was `ConsolePushSender`, not a real send** | ⚠️ same | — |
| did-you-see-it step appears | ✅ (screenshot) | n/a by design | n/a |
| `push` handler → visible notification, right payload | ✅ | ✅ | ✅ |
| Deep-link `data.url` carried | ✅ `/tasks/t-abc` | ✅ | ✅ `/trips/b-1` |
| Branded icon resolves | ✅ | ✅ | ✅ `/icons/icon-192.png` |

**Tag behaviour — the POC's most expensive trap — proven in the real worker:**

- two DIFFERENT tags ⇒ **two** notifications (stack);
- the SAME tag ⇒ still two, with the second one's title REPLACED
  (`New visit assigned` → `Bags sealed` on `verification-task:t-2`) — collapse,
  exactly as documented, which is what Phase 4's per-moment tag strategy
  depends on;
- an EMPTY push (`{}`) falls back to title "Koolee", tag "koolee", url "/"
  without throwing — the "a push with no body is legal" guard works.

**What is NOT proven, and why.** *(Read with §6.2: the agent/admin half of
this paragraph turned out to be a wrong diagnosis — those sends were never
real. The customer app and the synthetic-push evidence stand.)* FCM never
delivered to the automation profile: the subscription endpoint is FCM's **preprod** environment
(`fcm.googleapis.com/preprod/wp/…`, which Chrome for Testing uses), the send
returned success, and nothing arrived. That is the automation build's GCM
driver, not this code — every link on either side of it is proven above, and
the same worker raised the identical notification when the push event was
delivered directly. **The tab-open / other-tab / tab-closed matrix needs one
manual pass in TD's own Chrome**, listed in the hand-off. `notificationclick`
focus-or-open is in the same bucket: no protocol command clicks a
notification.

### 3.5 Gates

| Gate | Result |
|---|---|
| `turbo typecheck` | 6/6 ✅ |
| `turbo lint` | 6/6 ✅ |
| `turbo test` (unit) | core 499 ✅ · web 137 ✅ · admin 27 ✅ · agent 19 ✅ · ui 104 ✅ |
| `turbo build` | 3/3 ✅ |

Two lint rules bit and both were real: `no-useless-assignment` on the test
routes' `let userId = null`, and "setState synchronously within an effect can
trigger cascading renders" on the registrar and the trip prompt. Both
restructured rather than suppressed.

---

## Phase 4 — Fan-out wiring (moments × push)

### 4.1 Shape

Push sends live **inside the existing Inngest functions**, as the prompt
specified — no new events, and the one new function is Phase 1's horizon
sweep. Each send is its own `step.run`, placed AFTER the email step and never
inside it. Three reasons, and the third is the one that matters most:

1. the email is the guaranteed channel and must complete first;
2. Inngest memoizes steps independently, so a retried email step does not
   re-send the push and a retried push does not re-send the email;
3. **the function's return value is still the email's result** — so nothing
   downstream, and no existing test, learns a new shape.

`pushToUsers` / `pushToTargets` never throw, so a dead provider cannot fail a
step either way. Belt and braces are both here on purpose: this is the channel
that fails silently.

### 4.2 The table, as built

| Moment | Function | Push to | Tag | Urgency |
|---|---|---|---|---|
| verification task assigned (incl. horizon sweep) | `agent-assigned-email` | the assigned agent | `verification-task:<taskId>` — stacks | high |
| agent assigned | same function | customer | `booking:<id>` + renotify | normal |
| pickup task assigned / driver selected | `driver-selected-email` | the shift's driver | `pickup-task:<taskId>` — stacks | high |
| driver selected | same function | customer | `booking:<id>` + renotify | normal |
| bags sealed / choose driver | `bags-sealed-email` | customer | `booking:<id>` + renotify | normal |
| delivered to bag drop | `bagdrop-delivered-email` | customer | `booking:<id>` + renotify | normal |
| exception raised | `exception-ops-alert-email` | every active admin with a subscription | `exception:<id>:<ts>` — stacks | high |
| driver pool empty | `driver-pool-empty-ops-alert` | same audience | `driver-pool-empty:<id>` + renotify | high |

The horizon sweep needed no wiring of its own: it assigns through
`assignAgentToBooking`, which emits `booking/agent_assigned` like every other
path — the same reason the exception emit lives at a choke point (§7).

### 4.3 The two tag decisions, and why they differ

**Every customer milestone shares `booking:<id>`.** "Nina is your agent" is
REPLACED by "your bags are sealed", which is replaced by "your bags are at the
bag drop". A lock screen should show where the bags ARE, not a stack of
everywhere they have been. `renotify: true` is what makes the replacement
re-alert instead of landing in silence — without it, a same-tag replacement is
completely silent, which is the POC's most expensive trap and which the Phase 3
browser run reproduced deliberately.

**Staff work stacks.** A second assigned visit is a second job; a replaced
notification would be a visit nobody knows about. Same for a driver's second
pickup.

**The two ops moments deliberately disagree with each other.** An exception
gets a unique tag — two bookings in exception are two problems, and collapsing
would hide the second one entirely, which is the exact failure the alert
exists to prevent. An empty driver pool gets a stable tag plus renotify — that
is ONE booking with a staffing problem that keeps recurring until somebody
rosters a driver, and stacking would bury the console under repeats of one
fact. (`emitDriverPoolEmpty` already buckets its event id by hour, so "each
time" is at most hourly.)

### 4.4 Audiences and payloads

"Ops" is **derived**: every active admin in `staff_members` who has a
subscription. No notification-role column, no recipients table — §7, a roster
on a write path is a thing that has to be kept in step with what it counts.
Deactivating an admin drops them on the next send; asserted.

The ops push deliberately does **not** depend on `OPS_ALERT_EMAIL`. It is a
different channel to different people, and an unset inbox address is no reason
to leave everyone's phone silent. Asserted with no email configured at all.

**Deep links** come from `notifications/links.ts` (`tripUrlFor`, `taskUrlFor`,
`adminBookingUrlFor`) — the same module Phase 0 created, so push and email
name the same URLs. Task ids are looked up rather than carried: the event
shapes are fixed, and the row is the truth about which visit this is. The
agent app's `/tasks/[taskId]` resolves a pickup task first and falls back to a
verification visit, so one route takes both and the URL does not encode the
kind. `NEXT_PUBLIC_AGENT_APP_URL` / `NEXT_PUBLIC_ADMIN_APP_URL` were added to
apps/web (that is where the Inngest functions run). Absent → the push still
goes, without a link: a notification is worth more than its link, and
`notificationclick` falls back to `/`.

**No sensitive content.** Names and `bookings.ref` only — no address, no ZIP,
nothing passport-shaped. A push is decrypted onto a lock screen that may be
face-up on a table. Asserted against the fixture's real street and ZIP.
Payloads are a few hundred bytes, far under the 4KB limit.

### 4.5 Tests

[`jobs/push-moments.integration.test.ts`](../../packages/core/src/jobs/push-moments.integration.test.ts)
— 14 cases, and deliberately **not** in the `fakeDb` tier. The whole question
is *who received it*, and `fakeDb` ignores `where` clauses: every audience
query would return every row, so a passing test would prove nothing. Sending
an agent's task notification to a customer is exactly the bug this file
exists to catch.

Each case seeds a customer, an agent, a driver and two admins, subscribes
several of them, and asserts the recipient set by resolving subscription ids
back to users — so "the driver is subscribed and must not be in either send"
is a real assertion, not an absence.

Covered: both two-audience moments; no address or ZIP in a body; a cancelled
booking says nothing; the three customer milestones share one tag in order;
the bag-drop copy never claims check-in; the exception audience is every
active admin and nobody else with a unique tag; a deactivated admin drops out;
the pool alert collapses and re-alerts; ops push works with no
`OPS_ALERT_EMAIL`; nothing is sent when no admin is subscribed; **a throwing
sender leaves the email sent, the function complete, both steps run, and the
subscription un-pruned**; the push runs in its own step after the email; and
with no origins injected the link is omitted rather than sent relative.

`fakeDb` gained `pickupTasks`, `pushSubscriptions` and `staffMembers` so the
push steps can run in the unit tier and find nobody — with a header saying why
those two are always left empty there.

### 4.6 Gates

| Gate | Result |
|---|---|
| `turbo typecheck` | 6/6 ✅ |
| `turbo lint` | 6/6 ✅ |
| `turbo test` (unit) | core 499 ✅ · web 137 ✅ · admin 27 ✅ · agent 19 ✅ · ui 104 ✅ |
| `@koolee/core test:integration` | 286 passed, 3 skipped ✅ (was 272) |
| `turbo build` | 3/3 ✅ |
| `pnpm db:status` | 33/33, in sync ✅ |

---

## Phase 5 — Docs and close-out

### 5.1 A concurrency bug the sweep exposed, and the fix

The final integration run failed on **"concurrent sweeps assign exactly once"**
— a test that had passed earlier in the slice. Three of four sweeps reported
success. Not flakiness; a real bug, and the timing that revealed it was the
batch sweep's own.

`autoAssignBooking`'s documented rule is that **it never reassigns**, and that
was enforced by a check at the TOP of the function — before the pickup-address
lookup, the covering-agent query and four load-count queries. Several round
trips. A second sweep could pass that check, watch the winner commit during
the gap, and then reach `assignAgentToBooking`, which found an existing task
and took the **UPDATE** branch — moving the booking to a different agent and
appending a `booking.agent_reassigned` custody event. The 0019 unique index
cannot referee that, because nobody inserts.

The window pre-dates F3 (the on-paid hook has the same shape); the sweep made
it reachable, and Phase 1 had promised "concurrent sweep runs safe".

**Fix:** `AssignAgentInput.neverReassign`, set by `autoAssignBooking` only.
The decision is re-made INSIDE the transaction, against a re-read that can see
a committed winner, and refusal returns the existing `conflict: true` shape. A
dispatcher clicking Assign leaves it unset — reassignment is exactly what they
mean. Two writers that both read before either commits still both INSERT, and
there the unique index does referee. The early check stays as a cheap exit
with a comment saying it is not the guard.

The test now also asserts `reassignEvents` is empty — the actual tell — and
was run three times to be sure. `auto-assign-on-paid` and `dispatch`
integration suites re-run green.

### 5.2 Docs written

- **[f3-hosted-setup.md](../features/f3-hosted-setup.md)** (new): the 7-step
  table, migration 0032's lock notes, VAPID generation with the regeneration
  warning stated as a consequence rather than a caution, the full env table
  per app with why each is boot-gated, the **enable-and-verify walkthrough**
  including the four-row tab-open/other-tab/other-app/**tab-closed** smoke
  test and the `osascript` trick for isolating the OS from the browser, and
  `ASSIGNMENT_HORIZON_HOURS` with its default and the warning that web and
  admin must agree.
- **[notifications.md](../features/notifications.md)**: the matrix gains a
  **Push** column (SMS column stays parked), plus four new decision sections —
  collapse-for-customers vs stack-for-staff, nothing sensitive in a payload,
  why ops push does not depend on `OPS_ALERT_EMAIL`, and why verification is
  asking a human.
- **PROJECT-STATUS.md**: snapshot entry, rows 92–96, and four §7 standing
  constraints — push is never load-bearing; notifications are raised from the
  service worker (with the tag/`renotify`/`userVisibleOnly`/
  `pushsubscriptionchange`/`no-cache` corollaries); a scope gets exactly one
  service worker; an agent is assigned at a horizon.
- **[CODEBASE-MAP.md](../CODEBASE-MAP.md)**: `push.ts` in the schema table,
  the `PushSender` seam beside `Notifier`, the horizon paragraph in services
  (including why the predicate has its own module), `assignment-horizon-sweep`
  in the functions table, and a note that push rides inside those functions.
- **[docs/features/README.md](../features/README.md)**: index row.

### 5.3 Final gates

| Gate | Result |
|---|---|
| `turbo typecheck` | **6/6** ✅ |
| `turbo lint` | **6/6** ✅ |
| `turbo test` (unit) | core 499 · web 137 · admin 27 · agent 19 · ui 104 — **786** ✅ |
| `@koolee/core test:integration` | **286 passed**, 3 skipped ✅ (248 at slice start) |
| `turbo build` | **3/3** ✅ |
| `pnpm db:status` | **33/33**, in sync, target `127.0.0.1` ✅ |

### 5.4 Deferred, with reasons

- **The tab-closed delivery matrix in a real browser.** FCM never delivered to
  the automation profile (Chrome for Testing subscribes to FCM's *preprod*
  endpoint), so §3.4's table is proven on both sides of that hop and not
  across it. Needs one manual pass in TD's own Chrome — the four-row smoke
  test in the hosted-setup doc.
- **`notificationclick` focus-or-open.** No protocol command clicks a
  notification. The handler is ported verbatim from the POC and the payload's
  `data.url` is asserted end to end; the click itself is in the same manual
  pass.
- **A dev-only delayed test route.** The prompt sanctioned one for the
  tab-closed check. Not built: `POST /api/push/test` already sends a real
  push, and `curl`-ing it from another machine covers the delayed case without
  shipping a route that must not be enabled in production.
- **Notification history, per-moment preferences, escalation ladders,
  SMS, ops-alerter replacement.** Out of scope as stated.
- **`ASSIGNMENT_HORIZON_HOURS` in apps/agent.** The agent app neither assigns
  nor renders at-risk state, so it has no use for the value.

---

## Phase 6 — The bug TD found, after the slice reported itself green

**Symptom (TD, in review):** "notifications did not work for me on the agent
app… I'm not receiving any notifications, like the test notifications."

### 6.1 What was actually wrong

`WebPushSender` lived in `apps/web`. The agent and admin apps therefore had
**no real sender at all**, and `createCoreConfig` gave them the default —
`ConsolePushSender`, which logs one line and returns
`{ sent: targets.length, failed: 0, expired: [] }`.

So `POST /api/push/test` in the agent app:

1. found the user's real subscription,
2. handed it to a sender that printed to the dev-server terminal,
3. read `sent: 1, failed: 0` and answered `accepted: true`,
4. and the card asked **"Did a notification just appear?"** about a push that
   had never left the Node process.

The one mechanism in this slice built to detect silent non-delivery was itself
silently non-delivering. Nothing in 786 unit tests, 286 integration tests, six
typechecks, six lints or three production builds caught it, because **the
counts are identical either way** — a console fallback and a flawless send are
indistinguishable in `{ sent, failed }`.

### 6.2 A correction to §3.4 of this report

That section claimed the agent's server send was verified — `{accepted: true,
targeted: 2, sent: 2, failed: 0}` — and attributed the missing notification to
FCM's preprod environment not delivering to an automation profile.

**The first half was wrong.** Those counts came from `ConsolePushSender`. The
FCM *subscription* was real; the *send* was not. The preprod hypothesis was a
plausible story that happened to fit, and it was wrong. The §3.4 table's
"Server send accepted" row for agent and admin should be read as **not
verified** until Phase 6.

The general lesson is the specific one: a verification whose only evidence is
a success count cannot distinguish success from a no-op.

### 6.3 Fixes

| Change | Why |
|---|---|
| `WebPushSender` moved to **`@koolee/core/web-push`** | One implementation, three consumers. Deliberately NOT in the package barrel: `web-push` is Node-only crypto and anything in `src/index.ts` can reach a client bundle. The `web-push` dependency moved to core with it. |
| **`PushSender.delivers`** (required on the interface) | Makes "a log line is not a delivery" a type-level fact. `ConsolePushSender` = `false`; `WebPushSender` / `RecordingPushSender` = `true`. |
| `/api/push/test` returns **503 `not_configured`** when `!delivers` | It reports to a HUMAN who is about to be asked whether they saw something. It must refuse rather than pretend. |
| All three apps resolve a real sender | Every app that sends needs the private key — and each of the three sends its own self-test. |
| `pnpm push:vapid` writes to **all three** apps | The script created the asymmetry. It is now idempotent: an existing pair found anywhere is reused and distributed, never regenerated. It reports PARTIAL apps by name. |
| Agent/admin boot gate on half-configured VAPID | Half-configured is precisely the state that caused this. |
| The card distinguishes `not_configured` / `no_subscription` from "did not see it" | "Nothing was sent" and "something was sent and you missed it" have completely different fixes. Conflating them sends people to System Settings over a missing environment variable. |
| "Send a test notification" available from `confirmed` too | It used to vanish the moment you answered Yes — so anyone changing an OS switch afterwards had no way to re-check. |

### 6.4 Evidence this time — not counts

A count could not distinguish the two states, so the proof does not use one.

1. **A real network round-trip.** Signing with the agent app's keys and
   posting to a well-formed but non-existent FCM endpoint returns
   **`410 — push subscription has unsubscribed or expired`**. A console
   sender cannot produce a push-service status code; it never touches the
   network.
2. **The route's own guard is the discriminator.** `/api/push/test` now
   returns 503 unless `pushSender.delivers`. Against the running agent app it
   returns **200** — which is only reachable with a real `WebPushSender`
   wired.
3. **A regression test that pins the trap itself**
   (`notifications/push.test.ts`): `ConsolePushSender.delivers === false`
   *and* it still returns `{ sent: 1, failed: 0 }`. The second assertion
   deliberately pins the misleading behaviour, so nobody "fixes" the counts
   and assumes the problem is gone — the counts are not where the truth is.

### 6.5 One non-reproducing test failure

A single full-suite run failed `passport.integration.test.ts` ("allows a
replacement while unconfirmed"). It passed in isolation and on two subsequent
full runs (286/286). The file is untouched by this slice. Recorded rather than
explained away: two new integration files were added that truncate shared
tables, and `fileParallelism: false` means the suites run in sequence, so
leftover fixture rows are the plausible mechanism. **Worth watching** — it is
not yet proven benign.

### 6.6 Gates

typecheck 6/6 · lint 6/6 · unit 807 · core integration 286 (3 skipped) ·
builds 3/3 · `db:status` 33/33 in sync.

---

## Phase 7 — Amendment: push kill switch, default OFF

Requested after Phase 6, same branch. Small and surgical: no F3 push code
removed, no schema change, no subscription pruning, nothing touched in email,
realtime or deferred assignment.

### 7.1 The switch, and why it is ONE variable

**`NEXT_PUBLIC_PUSH_NOTIFICATIONS_ENABLED`** — `"true"` enables; anything
else, including unset, is OFF. Default OFF in every environment.

The prompt suggested `PUSH_NOTIFICATIONS_ENABLED` plus possibly a
`NEXT_PUBLIC_` twin for the client, and asked me to state which pattern the
apps already use. The precedent is **`NEXT_PUBLIC_LAUNCH_MODE`**: a single
`NEXT_PUBLIC_` var read on both sides, with an `isComingSoon()` helper. I
followed it exactly, with one variable rather than two, because **a server
flag paired with a public twin is two things that can disagree — which is
precisely the shape of the bug in Phase 6**, where the agent app held the
public VAPID key but not the private one. "Is push on" is not a secret.

Each app exposes `pushNotificationsEnabled()` beside its existing helpers, and
the runtime, the boot gate and the client surfaces all read that one function.

### 7.2 What OFF does

1. **Sender.** `createWebPushSender` gained a required `enabled` field,
   checked **before** the keys — so a fully configured environment still sends
   nothing when the switch is off. Turning push off must not depend on anybody
   also remembering to remove the credentials.
2. **Boot gate waived.** The VAPID gates in all three apps now run only when
   the flag is on. A production deploy with push disabled and no VAPID vars at
   all boots clean — asserted, including the unset case.
3. **Surfaces hidden.** The agent and admin `NotificationsCard`s return `null`;
   the customer trip page does not render `TripPushPrompt` (the flag is the
   FIRST term of that condition, so nothing else is evaluated). Offering to
   enable a channel the server will not send on is worse than offering
   nothing: the browser's permission prompt is ONE-SHOT, and a person who
   accepts it for a feature that cannot work has spent it for good.
4. **Service workers stay registered.** Explicitly NOT gated — the agent PWA's
   worker also carries the offline shell, and the Phase 3 registration fix
   must keep working with push off.
5. **Subscriptions preserved.** Nothing reads or writes `push_subscriptions`
   differently. Flipping the switch back on resumes delivery to the same
   devices with nobody re-subscribing.

Email and the in-app realtime signal are untouched throughout — they are the
guaranteed channels and they carry the product on their own.

### 7.3 Tests

- **Factory** (`notifications/web-push.test.ts`): enabled + full keys →
  a sender whose `delivers` is `true`; **switch off with every key present →
  null**; partial config → null; and a null return means the console sender,
  which does not deliver.
- **Boot gate** (`apps/web/src/env.test.ts`): prod + push disabled + no VAPID
  at all → boots; prod + flag unset + no VAPID → boots; prod + flag ON +
  any VAPID var missing → throws. The "complete prod config" fixture now sets
  the flag ON, or the existing VAPID assertions would have passed vacuously.
- **One UI-level assertion per app** (`app-push-flag.test.ts` ×2,
  `push-flag.test.ts`): the flag defaults OFF and fails CLOSED on a typo
  (`"yes"`, `"1"`, `"TRUE"` are all off), and the surface consults it. The
  second is a SOURCE assertion — the technique
  `packages/ui/src/components/client-directive.test.ts` established — because
  these app suites run in node with no DOM, no JSX loader and no `@/` alias.
  Rendering is covered by the browser pass in §3.4.
- Existing push integration tests are unaffected: they inject
  `RecordingPushSender` directly and never consult the flag.

### 7.4 Files changed

`packages/core/src/notifications/web-push.ts` (+ its test),
`apps/{web,agent,admin}/src/env.ts` (schema entry, helper, gate waiver),
`apps/{web,agent,admin}/src/lib/core.ts` (pass `enabled`),
`apps/agent/src/app/account/notifications-card.tsx`,
`apps/admin/src/app/notifications-card.tsx`,
`apps/web/src/app/trips/[bookingId]/page.tsx`,
three new flag tests, `apps/web/src/env.test.ts`,
`docs/features/f3-hosted-setup.md` (the switch documented FIRST, §0),
`docs/features/notifications.md` (push column annotated off-by-default),
`PROJECT-STATUS.md` (snapshot, rows 97–98, two §7 constraints).

### 7.5 Gates

| Gate | Result |
|---|---|
| `turbo typecheck` | **6/6** ✅ |
| `turbo lint` | **6/6** ✅ |
| `turbo test` (unit) | core 513 · web 134 · admin 32 · agent 24 · ui 104 — **807** ✅ |
| `@koolee/core test:integration` | **286 passed**, 3 skipped ✅ |
| `turbo build` | **3/3** ✅ |
| `pnpm db:status` | **33/33**, in sync ✅ |
