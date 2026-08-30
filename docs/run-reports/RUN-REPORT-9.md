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

---

## Phase 1 — The notification matrix

Four new messages, three new Inngest functions, and two rows of the given
matrix collapsed into one email. The matrix itself now lives as a living table
in [docs/features/notifications.md](../features/notifications.md).

### 1.1 What was already there

Six emails shipped before this slice: booking confirmation, pickup reminder,
driver selected, bag-drop delivered, the ops exception alert, and the ops
"no driver could be offered" alert. Nothing about them changed.

### 1.2 What is new

| Function | Trigger | Says |
|---|---|---|
| `agent-assigned-email` | `booking/agent_assigned` | "Nina is on your pickup", with the window in the booking's zone |
| `bags-sealed-email` | `booking/bags_sealed` | the seal numbers, and "choose your driver" |
| `exception-customer-email` | `booking/exception_raised` | "we've hit a snag, our team is on it" — and nothing else |

### 1.3 The adjustment: two matrix rows, one email

The matrix listed "bags sealed — a summary" and "driver selectable — a link" as
separate customer emails. **They fire at the same instant.** `verified_sealed`
is both the moment the last seal goes on and the moment
`DRIVER_SELECTABLE_STATUSES` opens the shortlist; there is no interval between
them in which one could arrive without the other.

Two emails seconds apart is a worse product than one that says both things, so
`bags-sealed-email` carries the seal numbers AND the call to action, and its
subject names both: *"Bags sealed — choose your driver — KOO-XXXXX"*. Flagged
here per the prompt's instruction to implement the closest correct thing rather
than stall.

The seal numbers are read at SEND time from `bags`, not carried on the event: an
event payload is a snapshot, and a seal is evidence the agent could still have
corrected between the transition and the send.

### 1.4 The exception email carries no reason, and is its own function

Ops gets `buildOpsExceptionEmail` with the full reason because they can act on
it. The customer gets none of it. The internal reason is written for an
operator ("ID mismatch", "capture failed after retry"), it can name staff or a
payment provider, and it is frequently **wrong in the first minute** because an
exception is raised before anybody has looked.

A separate function on the same event, rather than a second send inside the ops
one, because Inngest retries a *function*: a combined handler whose ops send
failed would re-send the customer half on retry.

`supportEmail` is passed in from `SITE.contactEmail` in `apps/web` — public site
copy, not per-environment config, so **no new environment variable** and core
still reads none. Absent → the email is skipped rather than sent with a
placeholder address nobody monitors, and a test pins that.

### 1.5 Where the two new events are raised

Both follow the standing rule that emission lives beside the fact, never at a
route handler.

- **`booking/bags_sealed`** — from `applyTransition`, on arrival at
  `verified_sealed`, beside the existing exception emit. One caller reaches
  that state today (`completeVerificationVisit`); emitting there instead would
  leave the second one silent.
- **`booking/agent_assigned`** — from `assignAgentToBooking`, NOT from
  `applyTransition`, and that asymmetry is deliberate. Two paths reach that
  line and only one moves the booking: the on-paid transition, and a
  reassignment that changes nothing except who is coming. A customer told once
  and never again when a different person is sent has been told something
  false. Its dedupe key is **(booking, agent)** — coarser than the write, so
  ops re-picking the same agent is not news and picking a different one is. The
  only place in the codebase where that is true, and the emitter says so.

### 1.6 The in-app half: `useAnnounceChange`

A signal-driven `router.refresh()` is completely silent — the new state simply
appears. A customer who looked away comes back to a page that has quietly grown
a "choose your driver" card; an agent at a door does not notice the identity
gate unlock.

`useAnnounceChange(stage, announce)` (in `packages/ui`) fires the first time an
opaque **server-computed** stage key changes after mount, and is silent on
mount — the first render of a page is not news, and announcing there would
toast on every navigation, which is the fastest way to teach somebody to ignore
toasts.

Toasts are deliberately few:

- **customer**: driver shortlist opened, in transit, delivered, exception. The
  `choose_driver` stage requires `canChooseDriver && candidates.length > 0` —
  a toast telling somebody to choose from an empty list is worse than silence.
- **agent**: identity gate opened, this pickup became theirs, and *n* new jobs
  landed in the queue (the count decides the wording, so it is computed rather
  than looked up).

Everything else on both surfaces updates quietly, which is the default.

### 1.7 A second lint catch, same family as Phase 0's

`react-hooks` rejected `announceRef.current = announce` during render. The fix
orders two effects: the ref update is declared FIRST so that on a render where
both the stage and the callback changed, the announcement uses the new one.

### 1.8 Tests

- `emails.test.ts` — the three new builders join the existing gauntlet (never
  "check you in", bag-drop wording, plain-text body, one Tag Orange on the CTA
  only, HTML escaping), plus 11 new assertions of their own. The one worth
  naming: **the customer exception email is checked against a list of internal
  phrases** — "ID mismatch", "customer not home", "payment authorization
  expired", the raiser's user id — because both emails are built from the same
  event and that is the assertion keeping an operator's words out of a
  customer's inbox.
- `functions.test.ts` — 56 tests (was 39). The registration test now pins all
  twelve functions and asserts that the ops and customer exception handlers
  both listen to `booking/exception_raised`. The agent-assigned test asserts
  the window renders as **10:00 AM EDT** from a 14:00Z instant, which is the
  assertion that catches a server-local render.
- `test-doubles.ts` gained a `bags` table.

### 1.9 Gates

`turbo typecheck` 6/6 · `turbo lint` 6/6 · unit 5/5 packages (core 479, ui 99,
web 95, admin 27, agent 12) · core integration 212 passed / 3 skipped ·
`turbo build` 3/3.

---

## Phase 2 — Upload-first funnel entry

### 2.1 The reshape

`/book/flight` opened on a six-field form with the upload card under a divider
at the bottom of the page. It now opens on a **drop area**, with manual entry
as a link below it. That is the whole change in one sentence, and the argument
for it is that typing a flight number, an airport, a date, a time and a name is
the slowest possible way to tell us something we can read off a document the
customer already has.

Manual entry is framed as an equal path — "Enter your flight details manually
· takes about a minute" — not as a fallback. Some people genuinely have no file
to hand, and a door with one handle is a wall for them.

### 2.2 The rule that needed a pure function

`flightEntryMode` ([apps/web/src/lib/flight-entry.ts](../../apps/web/src/lib/flight-entry.ts))
returns `door` | `review` | `manual`. It was extracted from three inline
conditions in the page because one of them is a real hazard:

> **Somebody stepping back to edit must never be sent to the door.** A draft
> that already carries a flight goes straight to the form. Re-asking for a
> ticket there reads as having lost their booking, which is the worst thing a
> funnel can imply.

And a second: `?from=ticket` with no prefill behind it — a shared link, a back
button after the draft cookie expired — falls back to the **door**, not to a
"here's what we read from your ticket" banner above six empty fields.

### 2.3 Failure is two different things

The old card showed every failure as one red line under an "Upload ticket"
button. The door splits them, and the split is the product decision:

| Outcome | HTTP | What happens |
|---|---|---|
| missing / too large / wrong type | 400 / 413 / 415 | **stay on the door**, show the specific message — picking a different file is one tap |
| accepted but unreadable | 200, `ok: false` | **drop into the manual form** at `?entry=manual&read=failed` |
| storage or transport failure | 502 / network | same drop, same apology |

The apology is deliberately non-blaming and names the real cause: *"some
airline tickets are images we can't get text out of. Nothing's lost."* The
compact upload card stays under the form for a second attempt.

That mapping is a decision taken in a client component about numbers produced
in `ticket-upload-handler.ts` — exactly the coupling that rots silently — so a
test asserts that the unreadable status is NOT in the retryable set and that
all three bad-file statuses are.

### 2.4 Camera capture is a SECOND input

`capture="environment"` makes a phone skip the file picker entirely, so one
input cannot both open the camera and let somebody pick the PDF their airline
emailed. There are two hidden inputs and two affordances; the camera button is
`sm:hidden`, because on a laptop `capture` is ignored and the button would open
the same picker as the drop area above it.

The drop area itself is a `<button>`, not a div with an onClick — it has to be
keyboard-reachable and announce itself. Drag-and-drop rides on top.

### 2.5 What did NOT change

- **The manual form.** Same fields, same `CoverageStepForm`, same
  `submitFlight`, same remount-on-seed-key fix from F1.
- **The ZIP-sync reconciliation.** It lives at the PICKUP step
  (`actions.ts`'s `zipMismatch` branch and `createBooking`'s required
  `quotedZip`), which this phase does not touch. Verified still present and
  still covered by the integration tier.
- **Extraction never writes to bookings.** A new test asserts the prefill
  carries no field a booking could be written from (`bookingId`, `userId`,
  `priceCents`, `pickupAddressId`, `status`).

### 2.6 Instrumentation

`track()` from `@vercel/analytics` — the system already mounted in the root
layout — gains `ticket_upload_started`, `ticket_upload_read` and
`ticket_upload_failed`, each tagged with the variant (`door` vs `compact`) so
the door's conversion is separable from the card's. No new analytics system, as
instructed.

### 2.7 Tests

- `flight-entry.test.ts` — 9 new tests over the three modes, including the
  step-back case and the `?from=ticket`-without-prefill case.
- `ticket-upload-handler.test.ts` — three new groups: the status contract the
  door routes on, the prefill validating against `ticketPrefillSchema` (a
  prefill the schema rejects renders an EMPTY form under a "we read your
  ticket" banner — the shape of the bug F1's remount key was written for), the
  wall-clock departure format, and the no-booking-fields assertion.
- `MAX_TICKET_UPLOAD_BYTES` / `TICKET_UPLOAD_MIME_TYPES` are now exported from
  `@koolee/core/uploads` so the client component can size and filter its own
  picker without reaching the package barrel (which pulls the Postgres driver
  — see `uploads/buckets.ts`'s header).

### 2.8 Gates

`turbo typecheck` 6/6 · `turbo lint` 6/6 · web unit 109 passed (was 95) ·
full unit 5/5 packages · core integration 212 passed / 3 skipped ·
`turbo build` 3/3.
