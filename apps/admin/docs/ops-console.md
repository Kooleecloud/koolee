# Admin ops console

How dispatch, configuration and manual overrides work, and the rails they run
on. Baseline: `dev` @ `5db21a4`. Feature-level overview:
[docs/features/ops-console.md](../../../docs/features/ops-console.md).

## The information architecture

`CONSOLE_NAV` in `apps/admin/src/components/console/nav.ts` is the **only**
place that knows what sections exist and how they group. The rail, the
breadcrumb trail and the badge counts all derive from it.

Until 2026-08-29 these were seven flat links in the shared `AppHeader` — the
marketing/in-app header all three apps use. Two structural problems: the header
has no room to grow past about seven items, and a flat list hides that **"what
am I doing today" (Operations) and "how is this console configured"
(Configuration) are different errands an operator is on at different times.**

The rail stays admin-only on purpose. `packages/ui/DESIGN.md` promotes a pattern
into the shared package when two or more apps repeat it — web's dashboard has
two links and agent's console has none, so neither has a rail's worth of
navigation.

`resolveConsoleRoute(pathname)` matches by **longest prefix**, so
`/bookings/<id>` resolves to Bookings rather than to Overview, whose `/`
prefixes everything. Unknown paths return null and the chrome renders without a
trail rather than guessing. The crumb trail deliberately stops at the section: a
detail page's own identity (`UA1189 · EWR`, ref `K7F2A9`) is already its
`PageHeader`, and the layout cannot know it without the page passing data
upward.

**Three badge counts ride on the rail** — `unassignedToday`,
`awaitingDriverToday`, `exceptionsOpen` — all of which already existed on
`OpsDashboard`. The rail surfaces numbers ops previously had to navigate to the
landing page to see; it computes none of its own. `unassignedToday` and
`awaitingDriverToday` are deliberately separate: one needs an agent sent to a
door, the other needs a van, and one badge meaning both would hide whichever is
rarer.

## Operations

- **Overview** (`/`): real-query stat cards — bookings whose pickup window
  _starts_ today (by status), paid-but-unassigned today ("Assign now" links to
  `/bookings?status=paid`; the board is not day-filtered by that link), sealed
  bookings with no driver, and open exceptions. Nothing is hardcoded
  (`getOpsDashboard` in `packages/core/src/services/dispatch.ts`).
- **Bookings board** (`/bookings`): every booking with its pickup-window
  start, flight + airport, passenger, bag count, assignee, and status.
  Filter links by status, airport, and "today's windows". Both the day
  filter and the ordering read `bookings.pickup_window_start` directly —
  there is no join to `slots` any more, so a legacy booking with a NULL
  window sorts last (`nulls last`) and shows "—".

  **At risk says WHICH now.** It used to be one flag meaning "paid, nobody
  assigned to verify", and every at-risk surface read `verification_tasks`
  alone — so a booking with its bags sealed on a doorstep and nobody coming for
  them looked healthy. `BoardRow.atRiskReason` is `no_agent | no_driver | null`.

  **Assignment is automatic on `paid`** (`autoAssignOnPaid`, since
  2026-08-23). The Assign button is the manual override; an uncovered ZIP still
  falls through to it via the at-risk flag.

- **Booking detail** (`/bookings/[bookingId]`): the full append-only custody
  trail (event type, actor role + id, timestamp, metadata, and evidence
  photos via short-lived signed URLs), bags + seals, payment history, the
  assignment panel, the exception-resolution panel (only while the booking
  is in `exception`), and the generic manual-transition controls.
- **Shifts** (`/shifts`): who is out driving, in what, with how many bags.
  Force-end a shift with a required reason; grant or revoke `can_drive`.
  A driver **cannot clock off while a pickup on the shift is still open**, and
  the refusal names the bookings. `driver_shifts`' two partial unique indexes
  (`WHERE ended_at IS NULL`) are what make "one open shift per person, one per
  truck" hold under concurrency.

  `adminReassignPickup` runs the **same** transaction, advisory lock and
  capacity recount as the customer's own `selectDriver` — one operation with
  two actors. What differs: no ownership check, a relaxed started-travel guard
  (ops may move a run that has set off; a customer may not), and a
  zone/capacity override that is RECORDED on the custody event along with the
  rule it waived.

- **Exceptions** (`/exceptions`): read-only queue of bookings currently in
  `exception`, each linking to its detail page. Deliberately has no
  resolution UI of its own — resolution lives on the booking detail page,
  and the dedicated flows (rejected bag, lost bag, re-dispatch, partial
  refund) are still open work (`TODO(exceptions)` in the page).

## Configuration

Everything here is a path to change how Koolee behaves **without a deploy**,
which is the whole reason these pages exist.

- **Pricing** (`/pricing`): the active pricing rule and the lead-time curve.
  Exactly one rule may be active (migration `0020`) — a path to change a price
  that is not SQL against production.
- **Airline cutoffs** (`/cutoffs`): per airline × airport ×
  domestic/international. **Every bookable window derives from these**, so an
  incorrect row silently narrows or widens what customers can buy.
- **Window blocks** (`/blocks`): the only control over what customers can
  book. Its own section below.
- **Agent zones** (`/zones`): ZIP coverage that auto-assign picks from.
- **Agreements** (`/agreements`): versioned booking agreements. "Current" is
  DERIVED — `max(version)` where `effective_from <= now()`. There is no
  `is_active` column and there must not be one.
- **Trucks** (`/trucks`): the fleet — name, bag capacity, active toggle.
  `reserved_spaces` is editable and **enforced**: a van is offered
  `bag_capacity − reserved_spaces − bags on board`.
- **Staff** (`/staff`): list, invite, deactivate — exactly three
  capabilities, no reactivate/edit/delete. See `staff-auth.md`.
- **Staff detail** (`/staff/[userId]`): one staff member — their history, their
  zones, `can_drive`.

Outside the rail: `/login`, `/login/reset`, `/set-password`.

## Window blocks

**Why this page exists at all.** Pickup windows are virtual. For every
flight, `packages/core/src/slots/windows.ts` enumerates 24 clock-aligned
one-hour windows on demand, and none of them has capacity — unlimited
bookings per window, by design. There is no inventory row to hold back and
no seat count to zero out, so a blackout is the ONLY lever ops has over what
customers can book. Everything else that narrows the calendar (the airline
cutoff, the 6h operations reserve, the 2h booking notice) is policy computed
from the flight, not something a dispatcher can move on a bad-weather
morning.

**What a block is.** One `slot_blocks` row: airport, `block_start`,
`block_end`, an optional free-text reason, and the admin who created it. It
hides every pickup window that **overlaps** `[block_start, block_end)` at
that airport — overlap, not containment, so a block that straddles two clock
hours removes both of them. It is enforced in two places, deliberately:
`listBookableWindows` classifies those windows `blocked` and keeps them out
of what the picker offers (they move to its `unavailable` list, with the
reason), and `createBooking` re-checks the blocks table on the write path
and throws `SlotNotSellableError`. A customer already mid-funnel when the
block landed is therefore rejected at checkout rather than quietly sold a
window nobody will drive. If a block leaves a flight with nothing bookable,
the picker shows its "no windows can make that flight" dead end.

**What a block does NOT do.** It does not touch existing bookings. Rows
already sold inside a blocked span keep their windows, their tasks, and
their assignments — a block only stops _new_ sales. So placing one strands
nothing on its own, and it also fixes nothing on its own: to see what is
already committed inside the span, open the bookings board filtered to that
day and deal with those bookings individually.

**Entering one.** Airport, date, first blocked hour, and a length of 1–24
hours, plus an optional reason (≤200 chars, admin-only — customers never see
it). Hours are the **airport's local wall clock**: the server action converts
them with `airportLocalInstant(day, hour, tz)` at the edge, and core stores
and compares absolute instants only — the same timezone policy the window
enumerator follows. The length is counted in elapsed hours from that
instant, so a block spanning a DST change is exactly N hours long, matching
how the windows themselves are built.

`AIRPORT_TZ` is hardcoded to `America/New_York` in both `page.tsx` and
`actions.ts` because all three airports (JFK, LGA, EWR) are Eastern. That
constant is the thing to fix — reading `airports.tz` per selection — the day
a non-Eastern airport is added; nothing else on the page assumes a zone.

**Listing and removal.** The page lists current and future blocks only:
`listSlotBlocks(core, { from: now })` filters on `block_end > now`. Expired
blocks stay in the table (they explain, later, why a day looked thin) but
are not shown, because this list is a control surface, not a report.
"Remove" hard-deletes the row via `deleteSlotBlock` — blocks are ops
scheduling, not custody history, so there is nothing to preserve — and the
windows are bookable again on the next picker query.

Both the page and both server actions are admin-gated (`getAdminSession` →
redirect, `requireAdminSession` in `createBlock` / `removeBlock`).

## Assignment

`assignAgentToBooking` (core) is the only write path:

- the assignee must be an **active** `staff_members` row with the `agent`
  role — the same check the agent app runs per request;
- one agent covers both the verification visit and the pickup run in v1:
  both task rows are created/updated together, and their
  `scheduled_start`/`scheduled_end` are copied from the booking's
  `pickup_window_start`/`pickup_window_end` (the booking carries its window
  directly now — no slot row is read; legacy rows were backfilled by
  migration `0012`, and anything still NULL schedules as NULL);
- first assignment moves the booking `paid → agent_assigned` through the
  state machine (custody event `booking.agent_assigned`, admin actor);
- reassignment moves the tasks and appends `booking.agent_reassigned` —
  status unchanged, history appended, never edited;
- a completed visit can never be reassigned;
- validation happens **before** any task write, so a refused assignment
  leaves no orphan task rows in an agent's list.

## Exception resolution

`resolveExceptionBooking` accepts exactly the three moves the matrix defines
from `exception`, each with a **required reason** recorded in the
compensating custody event along with the admin's real user id:

| Resolution          | Path                                                                                                                                                                                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `cancel_and_refund` | Phase 5 `cancelBookingWithRefund`: matrix cancel, full refund (captured) or auth void (authorized). The seat-release step only fires for pre-cutover bookings that still carry a `slot_id`; a windowed booking holds no seat, so there is nothing to release |
| `resume_transit`    | matrix `resume_transit` → `in_transit`, event `booking.exception_resolved_resumed`                                                                                                                                                                           |
| `force_complete`    | matrix `force_complete` → `completed`, event `booking.exception_resolved_completed`                                                                                                                                                                          |

There is no free-form status write anywhere: even the generic
manual-transition controls only offer events, and illegal events are
rejected by the state machine.

## Evidence photos

Bag photos live in the **private** `bag-photos` bucket. The admin app views
them through `createSignedUrls` (5-minute TTL) using its service-role
client; if signing is unavailable (no service key configured) the page
degrades to a text placeholder instead of breaking.

`bags.photo_urls` and `custody_events.photo_url` hold **storage paths, not
URLs** — the name is a lie the columns have not shed. Signing is therefore not
an optimisation, it is the only way to render one: fetching the bare path
returns HTTP 400. The customer app skipped this step until 2026-08-16 and
showed broken images on every trip page; it now signs through
`apps/web/src/lib/bag-photos.ts`, which is the same mechanism with a comment
explaining why the service-role client is safe there (ownership is already
established by `getBookingDetailForSession` before any path reaches it).

## Tests

`packages/core/src/services/dispatch.integration.test.ts` (11 tests):
assignment happy path (both tasks scheduled to the booking's pickup window)

- scoped visibility, reassignment event + no duplicates, completed-visit
  refusal, inactive/non-agent/wrong-status refusals without orphan tasks,
  active-agent listing, admin role gate, all three resolutions (including the
  auth void, asserting a windowed booking holds no seat), required-reason +
  illegal-transition rejections, and dashboard/board counts incl. the at-risk
  flag.

`/blocks` has no integration coverage of its own yet — `createSlotBlock` /
`deleteSlotBlock` are thin wrappers, but the block _rules_ are covered by
`packages/core/src/slots/windows.test.ts` (the `blocked` verdict and the
overlap semantics) and by the booking write path's re-check.
