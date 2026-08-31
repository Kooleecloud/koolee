# Admin ops console

> Dispatch, shifts, exceptions — and everything about Koolee that is
> configurable without a deploy. App: `apps/admin` (`:3002`).
> Baseline: `dev` @ `5db21a4`. ← [Features index](README.md) ·
> Deeper: [ops-console.md](../../apps/admin/docs/ops-console.md) ·
> [staff-auth.md](../../apps/admin/docs/staff-auth.md)

---

## 1. The pages, and the two errands they split into

Each is a server component + an `actions.ts` + a client form file.

**The information architecture is one file** —
[components/console/nav.ts](../../apps/admin/src/components/console/nav.ts) is
the only place that knows what sections exist and how they group. The rail, the
breadcrumb trail and the badge counts all derive from it.

Until 2026-08-29 these were seven flat links in the shared `AppHeader`. The
problems were structural, not cosmetic: a header has no room past about seven
items, and a flat list hides that **"what am I doing today" and "how is this
console configured" are different errands, on different days.**

### Operations

| Route                   | Does                                                                                                     | Badge                |
| ----------------------- | -------------------------------------------------------------------------------------------------------- | -------------------- |
| `/`                     | Dashboard — today's bookings by status, unassigned, sealed-with-no-driver, open exceptions. **All real queries** | —             |
| `/bookings`             | Dispatch board — filter by status/airport/day, assign an agent, see at-risk bookings                    | `unassignedToday`    |
| `/bookings/[bookingId]` | Full booking detail + custody timeline + evidence + payment                                              | —                    |
| `/shifts`               | Who is out driving, in what, with how many bags. Force-end with a required reason; grant/revoke `can_drive` | `awaitingDriverToday` |
| `/exceptions`           | Bookings in `exception`, with the three legal resolutions                                                | `exceptionsOpen`     |

### Configuration

| Route              | Does                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------- |
| `/pricing`         | The active pricing rule and the lead-time curve — **a path to change a price that is not SQL** |
| `/cutoffs`         | Airline bag-drop cutoffs per airline × airport × domestic/international                     |
| `/blocks`          | Window blackouts — **the only lever over what customers can book** (§3)                     |
| `/zones`           | Agent ZIP coverage, feeding auto-assignment                                                 |
| `/agreements`      | Versioned booking agreements. "Current" is derived, never a flag                            |
| `/trucks`          | The fleet: name, bag capacity, active toggle. `reserved_spaces` is editable and labelled **not yet enforced** |
| `/staff`           | Invite / list / deactivate agents and admins                                                |
| `/staff/[userId]`  | One staff member — their history, their zones, `can_drive`                                  |

Plus `/login`, `/login/reset` and `/set-password`, which sit outside the rail.

🧭 **The three badge counts compute nothing new.** All three already existed on
`OpsDashboard`; the rail surfaces numbers an operator previously had to navigate
to the landing page to see. `unassignedToday` and `awaitingDriverToday` are
deliberately **separate** — one needs an agent sent to a door, the other needs a
van, and one badge meaning both would hide whichever is rarer.

`resolveConsoleRoute` matches a pathname by **longest prefix**, so
`/bookings/<id>` resolves to Bookings rather than to Overview, whose `/`
prefixes everything. An unknown path returns null and the chrome renders without
a trail rather than guessing.

⚠️ **The rail is admin-only on purpose.**
[DESIGN.md](../../packages/ui/DESIGN.md) promotes a pattern into the shared
package once two apps repeat it — and neither web (two dashboard links) nor
agent (a tab bar) has a rail's worth of navigation.

### Evidence on the booking detail page

The bags card and the custody timeline render evidence photos through the shared
`ImageLightbox`
([packages/ui](../../packages/ui/src/components/image-lightbox.tsx)) — photos
are captured at ~1200px and thumbnails alone are unreadable when the question is
_"was that bag already scuffed?"_. The same component backs the agent's capture
preview and the customer's trip page.

The bags card is a **wrapping row of per-bag cards** (2026-08-16), one card per
bag carrying its ordinal, weight, seal id on its own line, and its photo — with
an explicit "no photo" slot when there is none. It was a vertical list with
seal and weight crushed into one right-aligned mono line and 20px thumbnails.
A dispute is a comparison between bags ("which one has seal KL-…?", "is this
the bag in the photo?"), and a stacked list makes that a scroll instead of a
glance.

Backed by [dispatch.ts](../../packages/core/src/services/dispatch.ts):
`getOpsDashboard`, `listBookingsBoard`, `assignAgentToBooking`,
`getBookingAssignment`, `listActiveAgents`, `listAgentWorkload`,
`resolveExceptionBooking`.

---

## 2. Manual actions never edit history

The hard rail, stated in the source: **every resolution is a state-machine
transition plus an appended compensating custody event**, carrying a
**required** reason and the admin's **real user id**.

The three exception resolutions are exactly the moves the matrix allows out of
`exception` — **the console cannot invent one**:

| Resolution          | Effect                                                 |
| ------------------- | ------------------------------------------------------ |
| `cancel_and_refund` | Matrix `cancel` + refund/void through the payment seam |
| `resume_transit`    | Back to `in_transit` — the situation was recoverable   |
| `force_complete`    | To `completed` — the work happened, the record lagged  |

🧭 This is the general shape of every ops action in this system: **forward
transition + appended reason**, never a correction in place. If a requested
feature can only be built by editing history, it needs a new _transition_, not a
new UPDATE.

---

## 3. Blackouts matter more than they look

With virtual pickup windows there is **no inventory to withhold**, so
`slot_blocks` is the _only_ way ops can stop selling a span of hours.

- A block hides **every window it overlaps** at that airport.
- **Existing bookings inside the span are untouched** — a block stops new sales,
  it does not cancel work.

Services: `createSlotBlock`, `listSlotBlocks`, `deleteSlotBlock`.

⚠️ If you are ever asked for "capacity limits", note that blackouts are a
_blunt_ instrument — all-or-nothing per airport per span. Real capacity is a new
concept, not a config change. See
[booking-funnel.md §4](booking-funnel.md#4-pickup-windows--computed-never-stocked).

---

## 4. The board reads the booking, not a join

Day filters and ordering use `bookings.pickup_window_start` **directly**. Since
the virtual-window cutover, `slot_id` is NULL on every new booking, so joining
through `slots` would silently drop them.

### 4.1 — Sorting

`BOARD_SORT_KEYS` is the closed set the board may sort by: `window`, `booked`,
`departure`, `status`, `agent`. Every ordering resolves in `orderFor` and ends
with `asc(bookings.id)` as a tiebreak, so paging is stable.

`booked` sorts on `bookings.created_at` — _when the booking came in_. It is the
one key with **no nulls clause**, because `created_at` is never null; the others
carry `nulls last` in both directions since an unassigned or unscheduled row
should sink, not lead.

### 4.2 — Cells stack time over date

The Booked / Window / Departs columns render the clock on the first line and the
date underneath, via `formatTimeInAirportTz` + `formatDayInAirportTz`. An
operator scanning the board reads the hour first. Per
[TIME.md](../TIME.md#how-to-render), the zone label stays on the **time** line.

### 4.3 — Agent identity

`BoardRow` carries `assigneeName` (`users.full_name`) alongside `assigneeEmail`,
and the board shows the **name above the email**. `assigneeName` is null for
staff who never set one — fall back to the email, which is always present for
staff. Never render a bare name without that fallback.

---

## 5. Assignment

**Auto, on `paid`.** Since 2026-08-23 `autoAssignOnPaid` runs when a booking is
paid; the board's **Assign** button is the manual override, not the normal path.
An uncovered ZIP still falls through to a human via the at-risk flag.

**Manual:** `assignAgentToBooking` from the dispatch board.

[auto-assign.ts](../../packages/core/src/services/auto-assign.ts) is a naive v1:
match `agent_zones` against the pickup ZIP and the airport-local day, then
balance by current workload. Managed from `/zones` (`addAgentZones`,
`listAgentZones`, `removeAgentZone`).

🧭 It is explicitly labelled v1 in the source. Treat it as a placeholder with a
correct _interface_, not as a solved routing problem.

### 5.1 — At-risk says WHICH now

Until the driver slice there was one flag and one word, and it only ever meant
"paid, nobody assigned to verify" — every at-risk surface read
`verification_tasks` alone. So a booking with its bags **sealed on a doorstep
and nobody coming for them looked healthy.**

`BoardRow.atRiskReason` is now `no_agent | no_driver | null`, and
`OpsDashboard.awaitingDriverToday` is a separate count from `unassignedToday`
for the same reason the badges are separate: the two need different actions.

### 5.2 — Reassigning a pickup reuses the customer's own path

`adminReassignPickup` runs the same transaction, the same single advisory lock
and the same capacity recount as the customer-facing `selectDriver`. They are
**one operation with two actors**, and letting them drift into two concurrency
stories is how a van ends up overloaded.

What differs is written down at the function, and only this:

- no ownership check;
- a relaxed started-travel guard — ops may move a run that has already set off,
  a customer may not;
- a zone/capacity override, which is **RECORDED on the custody event together
  with the rule it waived**.

### 5.3 — Shifts gate the driving half

A driver clocks on from the top of the agent app's Today page, picking a truck.
They **cannot clock off while a pickup on the shift is still open**, and the
refusal names the bookings. `driver_shifts`' two partial unique indexes
(`WHERE ended_at IS NULL`) are what make "one open shift per person, one per
truck" hold under concurrency. `/shifts` is where ops watches that and, when
they must, force-ends a shift with a required reason.

---

## 6. Staff management

**Invite-only. No self-signup.** `createStaffMember` issues the invite;
`getActiveStaffRole` / `isStaffRole` back every role check; `requireRole`
enforces.

⚠️ **Agent invites must land on the _agent_ app**, which is why
`NEXT_PUBLIC_AGENT_APP_URL` sits in admin's production boot gate. Missing it,
invite links go to the wrong app — and that failure is silent, so the gate
refuses to boot instead.

---

## 7. Env

Gated at boot, with **no coming-soon exemption** — the console is staff-only and
always live: `DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, **`SUPABASE_SERVICE_ROLE_KEY`** (staff invites
and evidence-photo signed URLs), `NEXT_PUBLIC_AGENT_APP_URL`.

Optional: `STRIPE_SECRET_KEY` (**refunds only**), `NEXT_PUBLIC_SENTRY_DSN`,
`ASSIGNMENT_HORIZON_HOURS` (**must match `apps/web`**, or the badges disagree
with the sweep), and the four VAPID vars when push is on — all four or none.
The full inventory is [ENVIRONMENT.md §3](../ENVIRONMENT.md#3-the-full-matrix);
the gate itself is
[scripts/env-manifest.json](../../scripts/env-manifest.json).

`assertProductionBootConfig()` refuses to boot without the Supabase URL, anon
key, service-role key, or agent app URL — each of which otherwise **silently**
disables something ops depends on.

---

## 8. What ops cannot do

Worth knowing, because it is asked for:

- **Cannot un-cancel or reopen.** `completed` and `cancelled` are terminal. A
  reopen is a new booking.
- **Cannot edit a custody event.** Only append a compensating one.
- **Cannot cancel an `in_transit` booking directly.** Route it through
  `exception` first — a driver holding bags is not a cancellation.
- **Cannot invent an exception resolution.** Only the three the matrix allows.
