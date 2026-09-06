# The verification visit — agent app core flow

Shipped 2026-08-09 (overnight run 1, Phase 6). The agent app is now
operationally usable for the core visit. Baseline: `dev` @ `5db21a4`.
Feature-level overview:
[docs/features/agent-visit.md](../../../docs/features/agent-visit.md).

## Where this sits in the day

Since 2026-08-30 the visit is **one leg of a job, not a standalone task**. The
app groups a booking's `verification_tasks` and `pickup_tasks` rows into a
single job in presentation (`src/lib/job.ts`) — **Verify & seal** at the door,
then **Collect & deliver** to the bag drop — because a driver experiences one
trip to one door with two things to do there, not two tasks three lines apart.
The tables stay separate underneath, which keeps this reversible the day the
two halves are assigned to different people.

The Today page (`/`) renders the day as one connected rail with exactly one
open stop, ordered by scheduled time (never by geography — the customer bought
a window). Overdue stops lead the route and are marked late. Everything below
describes what happens once a driver opens the verification leg.

## Screen order (design call)

Arrive → photo-ID check → per-bag loop (photo · weight · seal id) →
completion. Steps unlock in order; completion is disabled until every bag
is sealed. A "flag a problem" escape hatch is always visible.

Bags are numbered from `bags.ordinal`, never from array position. All of a
booking's bags are inserted in one statement and share `created_at` to the
millisecond, so the old `order by created_at` was a non-deterministic tie —
a sealed bag was observed jumping from "Bag 1" to "Bag 3" between two
renders of the same page. The ordinal is assigned once at creation and is
what the agent matches against the physical tag.

## Hard rails honoured

- **Every step appends a `custody_events` row** with the real agent user id,
  role, and timestamp; GPS lands in `lat`/`lng` when the browser grants
  geolocation (best-effort — denied/unavailable degrades to null, never
  blocks); the seal photo path lands in `photo_url`.
  Step events: `visit.arrived`, `passport.agent_confirmed`, `bag.sealed`;
  the matrix writes `booking.verified_sealed` on completion.
  (`visit.identity_verified` was the step event until 2026-08-28. The identity
  step is now a two-part gate — a customer agreement acceptance plus an agent
  passport confirmation — and `recordIdentityVerified` no longer exists. The
  old event name is still rendered by the timelines because it is the only
  record of every visit performed before that change. See
  [agreements-and-passport.md](../../../docs/features/agreements-and-passport.md).)
  `booking.payment_captured` is written later, by the capture sweep, with a
  NULL actor — the charge is the system's act, not the agent's.
- **Task split unchanged**: this flow touches `verification_tasks` only;
  pickup tasks keep their placeholder card (driver flow is later work).
- **The visit's time IS the booking's pickup window.** `assignAgentToBooking`
  (`packages/core/src/services/dispatch.ts`) copies
  `bookings.pickup_window_start` / `pickup_window_end` onto both task rows'
  `scheduled_start` / `scheduled_end` at assignment. It no longer reads a
  slot row — pickup windows are virtual (enumerated per flight, no
  inventory), so the booking carries its window directly. The Today list
  filters and sorts on `scheduled_start`, and the visit header renders the
  window; a task with no window shows "unscheduled", sorts last, and stays
  on Today until it is done rather than disappearing.
- **Completion does NOT take the money** (changed 2026-08-10). It records
  custody and closes the task, and that is all. The agent app holds no
  payment credentials by design (see its `lib/core.ts`), so it cannot
  capture — it shows a READ-ONLY "Payment authorized" badge sourced from the
  `payments` row and nothing else. Charging happens in apps/web via
  `captureDueBookings`; see
  [payments-lifecycle.md](../../web/docs/payments-lifecycle.md).

  This used to call `captureBookingPayment` from here, which failed EVERY
  pickup: with no `STRIPE_SECRET_KEY` the app silently wired the fake
  provider, the provider check found no matching authorized row, and each
  booking landed in `exception` with the bags already sealed and collected.
  The split makes that class of bug impossible rather than merely fixed.

- **Copy never overclaims** — completion says the bags are in Koolee's
  custody "until the airline's bag drop".
- **Photos**: PRIVATE `bag-photos` bucket, server-side upload. The agent app
  holds NO service key, so uploads run as the signed-in agent over the anon
  key, gated by storage RLS: only ACTIVE STAFF can write/read (migrations
  `0008` + `0009`; the staff check is a SECURITY DEFINER function so the
  `staff_members` table itself stays closed to PostgREST). Reads are
  signed-URL only.

## Authorization

Assignment IS the authorization: every core function
(`packages/core/src/services/agent-visit.ts`) resolves the task by
`(id, assignee = session.userId)` — another agent's task id behaves like a
missing one.

## Exceptions

Reasons: customer not home, ID mismatch, bags refused, unsafe conditions,
other (note required). Flagging moves the booking to `exception` with the
reason in the custody event, marks the task `failed`, and warns ops.
Resolution deliberately does NOT live here — that's the admin console's
manual-override territory (Phase 7); rejected/lost-bag flows remain
deferred (#17).

## Offline

No offline sync (out of scope by instruction). Every action fails with a
clear "check your connection and try again" and the form keeps the typed
values (`usePreservedFormValues`), so a retry is one tap.

## Dev notes

- The agent app wires the fake payment provider and never uses it — capture
  left this app in 2026-08-10. Do NOT "fix" that by adding
  `STRIPE_SECRET_KEY` here: the whole point is that a field device's server
  cannot move money. To exercise capture in dev, complete a visit and then
  hit `POST /api/jobs/capture-due` on apps/web (or let its 5-minute cron
  run).
- QR/RFID seal scanning: TODO(agent-flow) — manual entry ships first, the
  seal id stays an opaque string (decision #18 unchanged).

## Tests

`packages/core/src/services/agent-visit.integration.test.ts` — full happy
path (arrive idempotency, per-bag seals with photos/weights, completion,
booking advanced, task closed, every event's actor asserted, append-only
re-proven); completion refused with unsealed bags; exception path (state +
reason + actor); assignment scoping.

Two assertions are worth not deleting:

- completing a visit leaves the payment **`authorized`**, and the sweep is
  what captures it — the split is pinned by test, not just by convention;
- the bag list is re-read after every seal and its ordinals, ids and
  seal→bag links must all be unchanged, which is the regression that made
  `bags.ordinal` necessary.
