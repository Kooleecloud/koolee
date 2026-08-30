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

---

## Phase 3 — Customer post-login: trips home, profile, completeness

### 3.1 What was already there

The profile area is one coherent page already: `/dashboard/profile` holds the
avatar, the name form, the verified contact rows and the address book, and
`/dashboard/addresses` redirects into it. The address book already has list,
add, edit-label and **delete-with-in-use-guard** (`deleteAddressForSession`
refuses an address any booking references, because that address is part of an
evidentiary record). No new settings were invented, as instructed.

What was missing: the completeness card, and a trips home worth landing on.

### 3.2 `listCustomerTrips` — one service, one query per fact

`/trips` was one undifferentiated list, newest-booking-first, with a cancelled
trip from March able to sit above tomorrow's pickup, and nothing on any card
saying which of them needed something from the customer.

The new service ([services/trips.ts](../../packages/core/src/services/trips.ts))
returns `{ upcoming, past }`, each row carrying the booking, its zone, its
**actionability** and its **needs**.

**Why a service and not page code.** Three facts have to come together for
every row and only one of them is on the booking row. A page assembling that
itself would either get it wrong or do it N times, and the moment a second
surface asks "what does this booking still want from me?" the logic forks.

**One query per fact, never one per booking.** `getBookingActionability` reads
the cutoff table on every call — fine for a trip page, fifty round-trips for a
list. The cutoff matrix is 128 rows, so it comes back whole and the **pure**
`bookingActionability` runs per booking. Same function, same two axes, no
second rule engine. That is the standing §7 rule ("answered in exactly one
place") honoured rather than worked around.

### 3.3 Past means "nothing left to watch", not "the status is final"

A cancelled or completed booking is obviously done. So is one whose **flight
has departed**, whatever its status says: a `paid` booking for yesterday's
plane is not upcoming, and leaving it at the top under that heading is how a
history list becomes untrustworthy. `isPast` is
`standing === "terminal" || phase === "departed"` — both axes, which is exactly
why F1 refused to collapse them.

Upcoming sorts **soonest first** (window if present, else departure); past
sorts most-recent-departure first.

### 3.4 Needs are not statuses

`TripNeed` is `accept_agreement | choose_driver | upload_passport`, and every
one is gated on `actionability.can.*` FIRST. A booking past its bag-drop cutoff
asks for nothing — a test pins that, because asking somebody to accept an
agreement for a pickup that can no longer happen is worse than saying nothing.

`upload_passport` is always last and rendered in a muted badge: it is the only
one that does not block a pickup, and the agent checks the passport at the door
either way.

### 3.5 Completeness, and the line it draws

`profileCompleteness` is a **pure function over a user row**: verified phone,
verified email, display name, profile photo. An unverified channel counts
exactly as a missing one — a number on file that was never verified is worth
nothing when a driver is at the kerb.

The interesting half is what is NOT in it. Accepting the agreement and
pre-uploading a passport are **per-booking**: they pin to a booking
(`agreement_acceptances` is UNIQUE on `booking_id`), a customer with three
trips has three answers, and putting them here would make a finished profile
**un-finishable** — every new booking would un-complete it. A test asserts that
no gap name contains "agreement", "passport", "driver" or "booking".

`ProfileCompletenessCard` renders **nothing** when complete. A checklist that
is permanently visible and permanently satisfied is furniture. It lists exactly
what is missing, each row linking to the control that fixes it, and appears on
both the trips home (the landing) and the profile page (where the controls
are), so it ticks items off as they are done.

### 3.6 The trips home is live too

`TripLive` gained an optional `bookingId`. Omitted — which is how the list uses
it — it watches everything RLS admits, and for a customer that is exactly their
own bookings. A needs-action badge appearing without a reload is the point.

### 3.7 Tests

- `profile-completeness.test.ts` — 7 tests, including the no-per-booking-items
  guard and a null user (the page renders before `getCustomerById` has ever
  succeeded on a fresh account; a throw there would be a blank trips home).
- `trips.integration.test.ts` — 11 tests on `koolee_test`: the split on both
  axes, soonest-first ordering, each need appearing and clearing, "asks for
  NOTHING past the cutoff", another customer's trips never appearing, the
  booking's zone on every row, and empty lists rather than a throw.

### 3.8 Gates

`turbo typecheck` 6/6 · `turbo lint` 6/6 · unit 5/5 (core 486) ·
core integration **223 passed / 3 skipped, 24 files** · `turbo build` 3/3.

---

## Phase 4 — Profile photos, cross-app

### 4.1 Most of this was already shipped — the flagged adjustment

The prompt specified a new private bucket `profile-photos`, a new
`users.profile_photo_path` column, a browser downscale, an initials fallback
and three upload surfaces. **All of that shipped in the storage/avatars slice**
(migration `0026`/`0027`, PR #24). What exists:

| Specified | What is actually there |
|---|---|
| bucket `profile-photos` | bucket **`avatars`**, private, 3 MiB limit, 1 h signed URLs |
| `users.profile_photo_path` | **`users.avatar_storage_path`** (0027) |
| browser downscale | `downscalePhoto` via the shared `AvatarUploader` |
| one current photo, replace = new object | exactly that, `upsert: false`, old object orphaned for the same retention sweep passports wait on |
| initials fallback | `Avatar` — initials on a name-derived tint, and it falls back on LOAD FAILURE too, which matters because signed URLs expire in an hour |
| customer + agent + admin own-profile upload | all three |

Rebuilding any of it under new names would have been a migration and a
rename for no behaviour change. **Two things were genuinely missing**, and this
phase built those.

### 4.2 Missing #1 — the admin could not replace a staff photo

Now a **Photo** action per row on `/staff`, in a dialog (a picker per row would
put a dozen file inputs on one page; this is a rare action with a real
consequence). It reuses `AvatarUploader` unchanged — same downscale, same
limits read from the bucket spec — and differs by one query parameter.

Two things follow from `0027` and both are in the route's header:

1. **RLS cannot be the gate.** The insert policy is "your own folder, whoever
   you are", so a cross-folder write is refused — correctly, since that policy
   is what stops a path-building bug writing into a stranger's folder. The
   check moves into code: `canReplaceAvatarOf` admits an admin acting on a
   member of **active staff**, and nobody else.
2. **It runs service-role**, only after that check, through
   `uploadAvatarAsService` — the one place in the product that writes into
   somebody else's folder.

A **customer's** photo is deliberately unreachable from the console. It is
their face, and editing it would be the moderation capability decision #4 said
v1 does not have.

### 4.3 Missing #2 — issuance was a convention, not a control

`signAvatarUrlForViewer(path)` took a raw storage path and carried a comment
saying "never call this with a path that arrived from a request". That comment
was standing in for an authorization rule nothing enforced and no test covered.

`services/avatar-visibility.ts` is the rule:

| Viewer | May see |
|---|---|
| anyone | themselves |
| customer | the agent and driver on **their own** booking |
| staff | the customer of a booking **they have a task on** |
| admin | anyone |

The web helper is now `signAvatarUrlsForBooking({ db, viewer, bookingId,
subjectUserIds })` — **there is no signature it can be handed a path with**. It
resolves through `avatarPathsForViewer` and signs only what comes back; a
subject the viewer may not see is absent from the map and renders as initials,
identical to having no photo, which is not a disclosure either.

`AssignedAgent` gained a `userId` so the trip page can ask by identity rather
than being handed a path.

**The one exception is named rather than hidden.** The driver **shortlist**
shows four faces before anybody is assigned, so no relationship exists yet;
`listCandidateDrivers` — ownership-checked and `assertActionable`-gated — is
the authorization, and `signShortlistAvatarUrl` exists as its own function so
that exception appears in a diff.

**Known coarseness, left deliberately and written down:** `0027`'s Storage read
policy admits any active staff member to any avatar folder, which is broader
than the table above. Tightening it would break the agent seeing the customer
at the door; keys carry an unguessable uuid so folders are not enumerable; and
the app never hands staff a path they were not entitled to. The fine-grained
rule is enforced at issuance, in application code, which is where this codebase
puts authorization anyway.

### 4.4 Tests

`avatar-visibility.integration.test.ts` — 15 tests, and the ones that matter
are all refusals: an **unassigned agent** cannot fetch the customer's face; a
customer cannot fetch an agent who is not theirs; naming somebody else's
booking id changes nothing; a customer with no booking named gets nothing; and
nobody is visible before anybody is assigned. Plus the replacement rules — an
admin may replace a staff photo, may NOT replace a customer's, may not touch a
deactivated staff member's, and an agent may replace nobody's but their own.

The upload/replace path and the downscale are covered by the existing
`buckets.test.ts` and `AvatarUploader` (which downscales before it ever posts,
and previews the downscaled file so what you see is what is stored).

### 4.5 Gates

`turbo typecheck` 6/6 · `turbo lint` 6/6 · unit 5/5 · core integration
**238 passed / 3 skipped, 25 files** · `turbo build` 3/3.

---

## Phase 5 — Agent app: task organization + history

### 5.1 The schedule is ordered by attention, not by time

`/tasks` was Overdue, then a group per day, then a collapsed "12 finished"
disclosure at the bottom. Four buckets now, in the order attention should go:

1. **Open problems** — a failed phase. Nothing else on the screen is already
   going wrong, and a failed stop from yesterday belongs at the top rather than
   filed under "Overdue" with the merely late. A test pins that ordering.
2. **Overdue** — window passed, not finished. Still doable right up to the
   airline's bag drop closing (actionability's `running_late`), which is
   exactly why it must not be hidden.
3. **Today** — the airport-local day the job's own window falls in.
4. **Upcoming** — one group per day after that.

`groupIntoSections` is a pure function taking its two date helpers as
arguments, so `job.ts` stays a presentation module a test can run without a
Postgres driver anywhere near it. **Every day boundary is airport-local**;
production runs in UTC, so a server-local "today" opens at 8 PM the previous
evening.

An **unscheduled** job goes in Today rather than nowhere: "someday" is not a
bucket anybody looks at, and somebody has to see it.

### 5.2 History is a segmented control, not a fourth tab

`shell/nav.ts` caps the tab bar at three by an explicit decision — a driver has
exactly three questions, and the bottom third of a phone is the only part a
thumb reaches without regripping. History is not a fourth question; it is the
past tense of "what is coming". So it lives as a **To do ⇄ History** toggle at
the top of `/tasks` (`?view=history`), the Schedule tab stays lit for both, and
the URL is the state so a shared link lands where it says.

Finished work left the schedule entirely. A collapsed row at the bottom of
"what is left" is still occupying the answer.

### 5.3 One view, two modes

`/tasks/[taskId]` renders its flow while there is work and `TaskRecord` when
there is not — **same page, same doorstep card above it, nothing forked**. A
second history page would drift, and the copy that drifts is always the one
nobody remembers to update.

`TaskRecord` shows what the previous "done" state did not: the seals the driver
put on with their weights, and the full chain of custody in the booking's zone,
in agent voice ("You arrived", "You set off", "Airline took the bags"). Before
this, a completed visit rendered the single line *"Visit complete."* — useless
when somebody asks what happened with Tuesday's pickup.

### 5.4 The verification found a real gap — and it is fixed

The brief said to **verify and cite** that no mutation endpoint accepts a
terminal task. Verifying it found one that did.

**`confirmVisitIdentity` had no actionability gate at all.** `arriveAtVisit`
has carried `assertActionable` since F1; this step — one tap later in the same
flow — had none. An agent whose task was still assigned could append a
`passport.agent_confirmed` custody event to a booking that had already been
delivered, completed or cancelled: an entry growing on the append-only log of a
closed booking days after the bags reached the airline, visible on the
customer's own timeline.

Fixed with `assertActionable(config, booking, "startVisit", actor)`. Not a
sixth gate — this IS the visit, one step after arriving, and it belongs to the
phase before custody transfers, which is exactly the set F1's carve-out covers.
Late-but-savable still runs; past the bag drop it refuses and raises the
exception, identical to arriving.

**Two things verified and deliberately left alone:**

- `deliverToBagdrop` and `confirmAirlineHandover` return `ok: true` on a
  completed booking. That is the documented PWA idempotency — a tap that times
  out gets tapped again, and the second must return the current state rather
  than an error. Both check status first and **write nothing**, which is what
  the test's event-count assertion actually proves. An immutability claim is
  about the database, not about a response code.
- `recordBagSealed` has no actionability gate and keeps none. It is in-flight
  physical work at a door, which F1 carved out on purpose; and terminal
  immutability holds regardless, because a booking cannot reach a terminal
  state with an unsealed bag (`completeVerificationVisit` refuses) and a sealed
  bag refuses a second seal.

### 5.5 Offline: the honest minimum

The service worker is an **offline shell only** — it serves a fallback page for
a failed navigation and caches no API responses and queues no mutations. A page
already rendered stays rendered when the signal drops; `router.refresh()` just
fails, silently.

Silently is the problem. `OfflineNotice` (mounted once in `AgentMain`, so it is
on every screen with a tab bar) watches `online`/`offline` and says *"You're
offline. This is what we last loaded — it may have changed."* It starts
optimistic and corrects on mount, because `navigator` does not exist during SSR
and flashing "offline" on every page load is its own kind of lie.

No offline framework was built, as instructed. A durable outbox for custody
capture is real work with real correctness questions, and a half-built one is
worse than none.

### 5.6 Tests

- `job.test.ts` — 7 new tests. The one that matters is the **partition**:
  every unfinished job lands in exactly one bucket, nothing lost, nothing
  duplicated. Plus problems-outrank-overdue, unscheduled-goes-to-Today,
  one-group-per-day, and finished work staying off the schedule.
- `terminal-immutability.integration.test.ts` — 4 tests proving the Phase 5.2
  claim against a real database: every verification mutation refused on a
  completed booking, a second seal refused, every pickup mutation refused or
  no-op, `completed` having no legal outgoing move for any of the seven events,
  and — on every one — **the custody event count unchanged**. A refusal that
  still appends would be a worse bug than the mutation it prevented.

### 5.7 Gates

`turbo typecheck` 6/6 · `turbo lint` 6/6 · unit 5/5 (agent 19, was 12) ·
core integration **242 passed / 3 skipped, 26 files** · `turbo build` 3/3.

---

## Phase 6 — Admin app: histories

### 6.1 The booking's trip history

The custody trail already carried every custody event, every status transition
and every assignment/reassignment — the append-only log IS the journey, so
nothing had to be assembled. Two things were missing.

**Actors are people now.** Every line identified whoever did the thing as eight
hex characters, so reconstructing a disputed hand-off meant copying ids into
the staff page one at a time. The trail is what somebody reads while a customer
is on the phone; a name and a face are what make it readable at that moment.
Two batched queries resolve the whole trail whatever its length, and the id
stays in the element's `title` — it is what you need when reconciling against a
support ticket and never what you need when reading.

The permission decision goes through **`avatarPathsForViewer` with an admin
viewer** — the same function the customer trip page and the agent visit screen
use. One rule, one place, three callers. Signing stays app-side because core
holds no Supabase client.

**Notifications are NOT in the list, and the card says so.** There is no
notifications table and no local record of an Inngest run: sends live in
Inngest Cloud. So the absence of an email line here is not evidence that no
email was sent, and the card states that rather than letting a reader infer a
zero. Building bookkeeping on the send path to make it knowable is exactly what
the brief said not to do.

### 6.2 Staff work history

New route `/staff/[userId]`, reachable from the name in the staff table (which
was previously a dead string).

- **Counts by kind** — verification visits done, pickup runs done, still open,
  failed. All four derived from `verification_tasks` / `pickup_tasks`. No
  counter column, no `staff_stats` table: a counter on a write path has to be
  kept in step with what it counts, which is how a number becomes confidently
  wrong and stays that way.
- **A date range**, as a GET form onto the same route. The range is in the URL,
  so "what Nina did in June" is a link somebody can paste into a ticket.
- **Every row links to its booking.**
- **Shifts** (Tier 4's `driver_shifts`) on the same page, deliberately NOT
  range-filtered: a driver's shift list is short, and reading "no shifts"
  because a date box was set to last week is a worse answer than a few extra
  rows.

**The range reads when the work HAPPENED**, not when it was assigned:
`coalesce(completed_at, scheduled_start)`. A task handed out in May and run in
June belongs to June — filtering on `created_at` would answer a dispatch
question, not a work-history one. Two tests pin exactly that.

`listShifts` gained an optional `staffUserId`; nothing else changed about it.

### 6.3 What cannot be derived, stated on the page

The brief said: *if a count cannot be derived, say so rather than adding
write-path bookkeeping*. Two things cannot:

- **Emails sent** — no table, no local Inngest record (booking detail says so).
- **Distance driven / time on the road** — `driver_positions` holds ONE mutable
  row per driver with no history, by design and by standing rule; there is
  nothing to integrate over. The staff page says any non-task fact is "absent
  rather than zero".

### 6.4 A `sql` binding trap worth recording

The range predicate is a hand-written `coalesce(...)` fragment, and binding a
`Date` into a raw drizzle `sql` template reaches postgres-js as a positional
parameter with no type mapping — rejected outright with *"The string argument
must be of type string"*. Drizzle's own operators do that mapping; a
hand-written fragment has to say what it means, so the bounds go in as ISO
strings with an explicit `::timestamptz`.

### 6.5 Tests

`staff-history.integration.test.ts` — 11 tests: verifications and pickups
counted separately (one person often does both halves of one booking, at two
times, and collapsing them makes "how many pickups" unanswerable); open and
failed separated from done; **one person's history never contains another's**;
the range reading completion rather than assignment, in both directions;
the schedule fallback for unfinished work; the booking carried on every row so
it can link; empty rather than a throw; and `staffHistoryRange` reading a date
box as a whole inclusive UTC day while ignoring anything malformed — those
values come from a query string, so a bad bound must widen the range, never
throw a page away.

### 6.6 Gates

`turbo typecheck` 6/6 · `turbo lint` 6/6 · unit 5/5 · core integration
**251 passed / 3 skipped, 27 files** · `turbo build` 3/3.

---

## §V — The verification pass, and the two bugs it found

Everything below was done by driving two real browsers against **production
builds** of all three apps (`next build` + `next start` on 3010/3011/3012),
with the local Supabase stack. It is recorded as its own section because it
found two defects that a full green board did not.

### V.0 How, given Turnstile

The staff and customer sign-in forms are gated by a LIVE Turnstile site key,
which will not issue a token for `localhost`, so the login UI cannot be driven
here. Local GoTrue has captcha disabled, so sessions were minted through the
password / phone-OTP grants and written into each app's own
`@supabase/ssr` cookie (`sb-koolee-{web,agent,admin}-auth`). **Nothing about
the apps was changed to make this work** — no bypass, no test-only branch.

The Playwright MCP browser profile was already in use, so the pass ran over raw
CDP against Playwright's bundled Chromium in a scratch profile.

### V.1 BUG — a client component that returns `null` never mounts

`TripLive` and `LiveTasks` both returned `null`; they exist for their effects.
In a Next 16 / Turbopack **production build** their modules load, their function
bodies run, and **their effects never fire**.

The whole realtime layer was therefore inert in every built app. And it looked
fine: the polling fallback picked everything up, which is exactly the failure
the fallback is designed to hide. The first two-window run "passed" — the
agent's gate unlocked without a reload — **40.6 seconds** after the customer
accepted, which is the 30-second poll plus a render, not a socket.

Measured both ways, twice each: with `return null`, no WebSocket is ever
constructed; with a rendered `<span>`, the channel reports `SUBSCRIBED` in
under a second. Both components now render
`<span hidden aria-hidden="true" data-live-signal={status} />`, and the
attribute earns its place: it makes "is this page live or polling?" answerable
from the DOM instead of from console output in a debug build.

**Nothing in this repository could have caught it.** Typecheck, lint, 99 UI
unit tests and 250 integration tests all passed over the broken version.

### V.2 BUG — an RLS policy grants nothing

With the components mounting, the sockets connected and still **no browser
received a single event**.

`0030` was correct in every part anybody would look at: the policy, the
SECURITY DEFINER function, `REPLICA IDENTITY FULL`, publication membership. A
service-role subscriber received changes; an `authenticated` one did not.

`authenticated` held only `REFERENCES / TRIGGER / TRUNCATE` on
`booking_signals` — **no `SELECT`**. Row-level security NARROWS what a role may
already read; it cannot widen it. Realtime's per-row check failed before the
policy was ever consulted, silently, with zero rows and no error —
indistinguishable from "nothing changed".

`0031_booking_signals_grant.sql` grants `SELECT` to `authenticated` and to
nobody else, **explicitly** rather than relying on Supabase's default
privileges, which local and hosted disagree about (§3.1 counts 154 grants per
role — measured on hosted; the local stack has none). That is the same
local-vs-hosted divergence `0016` exists to stop repeating.

Written as a NEW migration, never an edit to `0030`, per the standing rule.

**Noted and deliberately not fixed:** `custody_events` has carried the same
shape since `0001` — RLS on, two policies, in the publication, no `SELECT`
grant — so its subscription has never been able to deliver either. Nothing
subscribes to it (the customer timeline is server-rendered), and opening a
table nobody reads from a browser would be a privilege change with no feature
behind it.

### V.3 DESIGN CHANGE — no unfiltered subscriptions

Phase 0 had the agent's views subscribe with **no filter** and let RLS decide
what reached them, on the reasoning that enumerating assigned bookings
client-side goes stale.

It does not work. An unfiltered `postgres_changes` on an RLS-protected table
reports `CHANNEL_ERROR` in the browser, while the identical **filtered**
subscription connects and delivers in under three seconds — reproduced from
Node as well, where a filtered agent subscription received events and the
policy function returned `true` for that agent and booking. Supabase evaluates
the policy per subscriber per row; the unfiltered case is the one that falls
over.

`bookingIds` is now a **required** prop, and an empty array means **poll-only**
rather than "watch everything" — a surface that does not know what it is
showing gets the honest fallback instead of a socket that silently never fires.
The staleness that argued against filtering is what the fallback is for: a
booking assigned in the last thirty seconds arrives on the next poll, and the
re-render that follows puts it in the filter list.

### V.4 The two-window evidence

Customer trip page (980×1000) and the agent's schedule (430×900), one booking
between them, side by side, neither touched. A custody event lands the way
every service writes one.

```
TRANSPORT  customer: live   agent: live
BASELINE   customer timeline entries: 23
POKE
CUSTOMER updated without reload after ms: 3047  -> entries 24
AGENT    issued RSC refetches after the signal: 7
CONSOLE ERRORS: []
```

**3.0 seconds against a 30-second fallback**, in both windows, with no
interaction. A single-window measurement of the same chain gave **2.9 s**.

Supporting measurements, all from the same session:

| Check | Result |
|---|---|
| trigger fires on a real service write | `booking_signals.updated_at` = the custody event's instant, `touched_by` = the acting agent |
| owning customer receives the change | ✅ (Node + browser) |
| a DIFFERENT customer receives it | ❌ correctly — RLS isolates |
| `can_watch_booking(agent, booking)` | `true` for the assigned agent |
| agent's filtered subscription | `SUBSCRIBED` + event received |
| all four live surfaces on load | `data-live-signal="live"` |
| a finished task's live layer | `polling` — correct: `enabled={!view.done}` |

**One honest caveat.** Across repeated runs on the local Realtime container,
one two-window run had the agent refetch while the customer did not, and one
had both miss. Both recovered on the next run and on the fallback. The local
container had been restarted and hammered by this session; the same chain is
deterministic from Node and single-window. It is called out here rather than
smoothed over, and it is the one thing worth confirming on hosted — where
Realtime runs a different configuration. It is also exactly the case the
polling fallback exists for.

### V.5 The page sweep

Eleven surfaces, production builds, real sessions. All 200, all rendering the
content they claim:

```
OK  web door           ("Upload your ticket" found)
OK  web manual         ("Pickup ZIP" found)
OK  web read-failed    (the non-blaming line found)
OK  web trips home     ("Upcoming" found)
OK  web profile        ("Your profile" found)
OK  agent today
OK  agent schedule     ("To do" found)
OK  agent history      ("History" found)
OK  admin staff        ("Staff" found)
OK  admin bookings
OK  staff history      counts ✓  shifts ✓  date range ✓
```

Console errors: none. (Two `%c%d font-size:0` lines are React DevTools' own
badge, present before this slice.)

The admin booking page was checked specifically for Phase 6: the **Trip
history** card is present and its actor chips resolve to real names
(`Leo Vargas` / `Nina Petrov` / `Alex Morgan`) rather than hex fragments.

---

## Phase 7 — Docs and close-out

### 7.1 New and updated documentation

| Doc | What |
|---|---|
| `docs/features/realtime-signals.md` | **new** — the signal-only rule, the table, the one policy, the client hook, and both traps from §V |
| `docs/features/notifications.md` | **new** — the living matrix, the decisions inside it, idempotency keys, where each event is raised, the copy rules |
| `docs/features/f2-hosted-setup.md` | **new** — TD's steps: two migrations, one dashboard check, no env vars, and the smoke tests in order |
| `docs/features/booking-funnel.md` | §9.0 — the door, the three modes, the two kinds of failure |
| `docs/features/storage-and-avatars.md` | §3.1 — who may see whose face, and replacing a staff photo |
| `PROJECT-STATUS.md` | F2 rows, snapshot entry, four new §7 standing rules |
| `docs/CODEBASE-MAP.md` | `booking_signals`, the realtime chapter pointer, the new services |

### 7.2 The five embedded decisions, at close-out

1. **Realtime is a signal, never a source of truth** — implemented and encoded
   in three places (the migration header, the feature doc, a §7 rule). Nothing
   renders a payload.
2. **Web push OUT** — held; no push code. Backlogged.
3. **SMS parked** — held; the matrix carries the column, the code carries
   nothing.
4. **Photos** — **adjusted**, and the adjustment is the whole of Phase 4: the
   bucket, the column, the downscale, the initials fallback and three upload
   surfaces already shipped with `0026`/`0027`. Built the two things that were
   actually missing instead of renaming what exists.
5. **Profile completeness** — implemented as specified, with the per-booking
   exclusion enforced by a test.

### 7.3 Deferred, with reasons

| Item | Why |
|---|---|
| Web push for the agent PWA | Decision #2. Its own item. |
| SMS | A2P registration, not code. |
| A notifications/`email_sends` table | Would be bookkeeping on the send path. The console says sends live in Inngest instead of implying a zero. |
| Offline outbox for custody capture | Real correctness questions; a half-built one is worse than none. The app says "you're offline" and queues nothing. |
| `custody_events` SELECT grant | Its subscription has never worked and nothing subscribes. Opening a table nobody reads is a privilege change with no feature behind it. |
| Orphaned avatar objects | Same retention sweep bag and passport photos are waiting on. |
| Old `.next` dev-cache growth | Unrelated; `turbo.json`'s exclusion from F1 holds. |

---

## Final gate

| Gate | Result |
|---|---|
| `turbo typecheck` | **6/6** |
| `turbo lint` | **6/6** |
| Unit (`pnpm test`) | **5/5 packages** — core 486 (+1 skipped), web 109, ui 99, admin 27, agent 19 |
| Core integration (`koolee_test`) | **251 passed, 3 skipped, 27 files** |
| `turbo build` | **3/3** |
| `pnpm db:status` (local) | **32 of 32, matched by content hash — in sync** |
| Browser pass | 11 surfaces at 200, zero console errors; two-window realtime at **3.0 s** |

**Databases touched: LOCAL ONLY.** `127.0.0.1:54322` for migrations and the
seed, the disposable `koolee_test` for the integration tier. Hosted was never
contacted and `DIRECT_DATABASE_URL` was never overridden.

**Migrations added: `0030` and `0031`, LOCAL ONLY.** Hosted is TD's step —
[docs/features/f2-hosted-setup.md](../features/f2-hosted-setup.md).

**No new environment variables**, in any app or in core.

### Test-data footprint on the local dev database

The verification pass used the existing seeded accounts and real product
actions against pre-existing dev bookings. It left behind, on `KOO-2JT6V`
only: one sealed bag (`KLS-891872`), a completed verification visit, and eight
`booking.agent_reassigned` custody rows tagged `{"probe": "f2-…"}` used to time
the live updates. All of it is append-only evidence on a dev booking, and the
probe rows are labelled so they are recognisable as probes.

### Commits on `feat/f2-live-ux`

One per phase, in order:

| Commit | Phase |
|---|---|
| `feat(realtime): a doorbell, not a data path` | 0 |
| `feat(notifications): the four messages that were missing` | 1 |
| `feat(funnel): the ticket is the door, the form is the alternative` | 2 |
| `feat(web): a trips home worth landing on, and a checklist that disappears` | 3 |
| `feat(photos): issuance you cannot get wrong, and a photo an admin can fix` | 4 |
| `feat(agent): a schedule ordered by attention, and a history that is a record` | 5 |
| `feat(admin): histories that name people, and counts nobody has to maintain` | 6 |
| `fix(realtime): the layer was inert, and docs to close the slice` | 7 + §V |

---

## Follow-up — the cutoff countdown said 4499 hours

Reported after the slice closed, on a booking six months out:

> `4499h 3m until AI's bag-drop cutoff at EWR.`

`CutoffCountdown` rendered raw hours, always. Nobody converts that number, and
an urgent-looking banner that is permanently non-urgent is the fastest way to
teach somebody to skip the one that matters.

**Two rules now, both in
[apps/web/src/lib/cutoff-horizon.ts](../../apps/web/src/lib/cutoff-horizon.ts):**

1. **Beyond a week, say nothing.** A cutoff more than seven days out is not a
   thing to do today; the page already shows the departure and the pickup
   window. `CUTOFF_HORIZON_MS` is one constant so moving the line is one edit.
2. **Below it, scale the unit.** Days when it is days, hours and minutes inside
   a day, minutes inside an hour.

| span | reads as |
|---|---|
| under a minute | `less than a minute` |
| under an hour | `42 min` |
| under a day | `7h 12m` |
| a day or more | `3 days` |

Days drop the hours on purpose: between one day and two there is nothing a
customer does differently at 25 hours versus 47, and "1 day 23h" is a sentence
people re-read.

**A passed cutoff is always shown**, however long ago — that is not a
countdown, it is the state of the booking and the only thing on the page that
explains why nothing else works.

**The horizon is decided on the SERVER** (the trip page gates the render) and
re-checked in the component. The two clocks differ, and a boundary case where
the server renders the banner and the client does not is a hydration mismatch
on the whole subtree; remaining time only shrinks, so a server "yes" is still a
yes by the time the client hydrates.

**Verified in a browser**, production build, against the real bookings:

| booking | before | after |
|---|---|---|
| `KOO-ECDQZ` — AI/EWR, Mar 2027 | `4499h 3m until …` | banner absent |
| `KOO-Q1RQA` — cutoff passed | `…h …m ago` | `AS's bag drop at EWR has closed. It closed 1 day ago.` |
| `KOO-S4M25` — ~35h out | `35h 12m until …` | `1 day until DL's bag-drop cutoff at JFK.` |

Tests: `cutoff-horizon.test.ts` — 10 cases, including the reported span
(4499 h → hidden), the inclusive boundary, both directions of the ladder, and
an assertion that no span ever renders three or more digits of hours again.

Gates: `turbo typecheck` 6/6 · `turbo lint` 6/6 · web unit **119** (was 109) ·
`turbo build` 3/3.
