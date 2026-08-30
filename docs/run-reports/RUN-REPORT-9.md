# Run report 9 — Slice F2: live experience & UX revamp

**Branch:** `feat/f2-live-ux`, cut from `origin/dev` @ `fe4f405` with
`--no-track` (`branch.feat/f2-live-ux.merge` verified empty; `git status -sb`
shows no upstream). **Commits are made on this branch**, one per phase, at TD's
explicit instruction — the slice prompt's "no commits" default is overridden.

**One session, one branch.** No parallel sessions.

**Databases touched: LOCAL ONLY.** `127.0.0.1:54322` for migrations and the
seed, the disposable `koolee_test` for the integration tier. Hosted is never
contacted; no `DIRECT_DATABASE_URL` override is ever set. Hosted steps are
TD's: [docs/features/f2-hosted-setup.md](../features/f2-hosted-setup.md).

**Precondition checked before anything else.** F1 is merged into `dev`
(PR #29, `fe4f405`) and `packages/core/src/services/actionability.ts` exists
with `getBookingActionability` / `assertActionable` wired into the five gated
entry points. The slice was cleared to start.

---

## The five embedded decisions, and what happened to each

| # | Decision as given | Outcome |
|---|---|---|
| 1 | Realtime is a signal, never a source of truth | **Implemented as given.** Encoded in migration 0030's header, `docs/features/realtime-signals.md`, and a new §7 standing rule. |
| 2 | Web push is OUT; in-app realtime + email is the coverage | **Held.** No push code. Backlogged as its own item. |
| 3 | SMS stays parked (A2P) | **Held.** The matrix carries an SMS column marked *parked*; no code. |
| 4 | Photos: own upload, admin may replace staff photos, no moderation queue, relationship-scoped visibility | **Adjusted — see Phase 4.** The bucket, the column, the upload pipeline and the initials fallback ALREADY SHIPPED in the storage/avatars slice (migration 0027). What was missing was the admin replace path and server-side enforcement of relationship scope. Phase 4 builds those instead of rebuilding what exists. |
| 5 | Profile completeness = verified email + verified phone + display name + photo | **Implemented as given.** |

---

## Phase 0 — Realtime foundation

### 0.1 The shape chosen, and the one the prompt suggested

The prompt sanctioned a thin `booking_signals` table with one RLS policy,
upserted by core "at one call site: applyTransition + the assignment writes".
The table and the single policy are exactly that. **The writer is not.**

Counting first: there are **26** `insert(custodyEvents)` sites in
`packages/core/src` (20 outside tests), across `bookings`, `agent-visit`,
`pickup`, `driver-selection`, `dispatch`, `agreements`, `passport`,
`payment-lifecycle`, `create-booking`, `webhooks` and `shifts`. `applyTransition`
covers status changes and nothing else — an agent sealing a bag, a customer
accepting the agreement, and a passport upload all append custody evidence
without any transition at all, and the matrix in Phase 1 requires every one of
them to move the customer's screen.

Adding a `touchBookingSignal` call to ten services would have re-created,
exactly, the failure this codebase already paid for once: the exception alert
lived at one call site, six of the seven paths into `exception` were silent for
a whole slice, and the fix was to move emission to a choke point so a new path
is covered *by construction*.

There is no choke point for custody inserts in core. So the construction is a
**database trigger**: `public.touch_booking_signal()` AFTER INSERT on
`custody_events`. Twenty services signal correctly while knowing nothing about
the table, and so does the twenty-first.

One writer stays explicit, because it deliberately appends no custody event:
`recordDriverPosition`. A position is not evidence (standing §7 rule), so it
cannot ride the trigger — and "how far away is my driver" is the single number
a customer sits and watches.

**Nothing time-based signals at all.** `running_late` and `missed_cutoff` are
computed from the clock; nothing is written when they become true, so nothing
can be published. The polling fallback surfaces them, which is the honest
mechanism for a state change nobody performs. This is called out because it is
the one row of the Phase 1 matrix that realtime does *not* deliver.

### 0.2 The policy, and the trap it steps around

One policy, SELECT only — every write is on the direct/service-role connection,
which bypasses RLS.

The check runs through `public.can_watch_booking(uid, booking)`, **SECURITY
DEFINER**, mirroring `public.is_active_staff` from `0009`. An inline
`EXISTS (… verification_tasks …)` would have been evaluated as `authenticated`;
RLS is on for every table in `public` (`0016`) and the task tables carry no
policies, so the subquery returns zero rows and the staff half of the policy
silently never matches. That is the identical shape of the bug fixed in `0009`
and again in `0023`, and it would have been invisible to the integration tier,
which runs on the direct connection where RLS is never consulted.

Admitted: the customer who owns the booking, or active staff with a
verification or pickup task on it. Never a null `uid`.

### 0.3 Migration 0030 — LOCAL ONLY

`0030_booking_signals.sql`. Generated DDL (table + 2 FKs + 1 index) plus
hand-written additions: backfill one row per existing booking, the trigger
function and trigger, `can_watch_booking`, RLS enable + the one policy,
`REPLICA IDENTITY FULL`, and publication membership. Every Supabase-only block
is guarded on `pg_roles`/`auth.uid()`/`pg_publication` so plain Postgres 16
(docker-compose, CI) still migrates.

Applied locally and verified from `psql`:

```
trigger     | custody_events_touch_signal            (plus the 3 append-only guards)
policy      | booking_signals_select_watchable | SELECT
rls         | t
replident   | f      (FULL)
publication | custody_events, booking_signals
fn          | touch_booking_signal (secdef), can_watch_booking (secdef)
rows        | 21     (backfill)
```

`pnpm db:status` → **31 of 31, matched by content hash. In sync.**

### 0.4 The client

`useBookingSignal` in `packages/ui/src/lib/booking-signal.ts`: debounce 400 ms,
polling fallback 30 s (stretched to 120 s while the socket reports live),
refetch once on every connect and reconnect, and a returned transport status so
a surface can say "live" or "polling" honestly.

It takes the Supabase client as a **structurally typed argument** rather than
importing one — `@koolee/ui` must not depend on `@supabase/supabase-js`, and
each app builds its own client with its own cookie name. A real
`SupabaseClient` satisfies the interface; the package gains no dependency.

Two subscription shapes, both deliberate:

- **web** passes one booking id → a `booking_id=eq.<uuid>` filter.
- **agent** passes none → watches everything RLS admits. Enumerating assigned
  bookings client-side is a filter list that goes stale the moment ops assigns
  one more. This is a scoping convenience, not a boundary; the boundary is
  still `getAssignedTask` refusing a task that is not theirs.

**Where it is wired.** `TripLive` (web) at **page** level, not inside the
driver card. The 30-second interval it replaces lived in `DriverTracking`,
which meant the trip page only went live once a driver had been chosen — an
agent sealing bags on the doorstep changed nothing on the screen the customer
was watching. `LiveTasks` (agent) on today, the schedule, and both task detail
modes, disabled once a task is done.

`apps/agent` gained its first browser Supabase client (`lib/supabase/browser.ts`),
anon key only, cookie name `sb-koolee-agent-auth` to match its server client.

### 0.5 A lint rule caught a real bug shape

`react-hooks/set-state-in-effect` rejected the first draft, which called
`setStatus` synchronously in the effect body on every subscription change. The
fix is better than a suppression: socket state is now **stamped with the key of
the subscription it describes** and written only from supabase-js's own
callback, and the public status is derived. A report belonging to a previous
subscription simply does not match the current key, so a booking id change
reads `connecting` again with no second render and no reset effect.

### 0.6 Tests

- `booking-signals.test.ts` — 13 unit tests parsing `0030` (the
  `buckets.test.ts` pattern): three columns and no more, cascade, backfill,
  AFTER INSERT only, upsert-not-insert, exactly one policy and it is SELECT,
  SECURITY DEFINER routing, who the function admits, REVOKE/GRANT, replica
  identity, publication membership, and — the standing-rule assertion — that
  **no domain table is added to the publication**.
- `booking-signals.integration.test.ts` — 9 tests on `koolee_test`: a new
  booking gets exactly one row; a transition moves it and leaves ONE row; the
  actor is recorded; an agreement acceptance (a service that has never heard of
  this table) moves it; touching booking A never touches booking B; a GPS ping
  moves the signal for the bookings on that shift; `touchBookingSignal` on a
  missing booking resolves rather than throwing; `latestSignalFor` picks the
  newest; deleting a booking cascades the signal away.
- `client-directive.test.ts` extended to scan `packages/ui/src/lib` as well as
  `components/` — hooks live in both, both are exported from the barrel a
  server component imports, and the failure mode (green build, runtime
  explosion on first open) is identical.

### 0.7 Gates

`turbo typecheck` 6/6 · `turbo lint` 6/6 · unit `pnpm test` 5/5 packages
(454 core + 98 ui + 95 web + 27 admin + agent) · core integration **212 passed,
3 skipped, 23 files** · `pnpm db:status` in sync 31/31.

Browser evidence (two windows, customer + agent) is recorded in the
verification pass at the end of this report.
