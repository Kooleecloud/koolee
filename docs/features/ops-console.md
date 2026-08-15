# Admin ops console

> Dispatch, exceptions, blackouts, staff, zones. App: `apps/admin` (`:3002`).
> Baseline: `dev` @ `2fe3a2b`. ← [Features index](README.md) ·
> Deeper: [ops-console.md](../../apps/admin/docs/ops-console.md) ·
> [staff-auth.md](../../apps/admin/docs/staff-auth.md)

---

## 1. The pages

Each is a server component + an `actions.ts` + a client form file.

| Route                   | Does                                                                                            |
| ----------------------- | ----------------------------------------------------------------------------------------------- |
| `/`                     | Dashboard — today's bookings by status, unassigned count, open exceptions. **All real queries** |
| `/bookings`             | Dispatch board — filter by status/airport/day, assign an agent, see at-risk bookings            |
| `/bookings/[bookingId]` | Full booking detail + custody timeline                                                          |
| `/blocks`               | Window blackouts — **the only lever over what customers can book**                              |
| `/exceptions`           | Bookings in `exception`, with the three legal resolutions                                       |
| `/staff`                | Invite / list / deactivate agents and admins                                                    |
| `/zones`                | Agent zone coverage, feeding auto-assignment                                                    |

On `/bookings/[bookingId]`, the bags card and the custody timeline render
evidence photos through the shared `ImageLightbox`
([packages/ui](../../packages/ui/src/components/image-lightbox.tsx)) — photos
are captured at ~1200px and thumbnails alone are unreadable when the question is
_"was that bag already scuffed?"_. The same component backs the agent's capture
preview and the customer's trip page.

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

**Manual:** `assignAgentToBooking` from the dispatch board.

**Auto:** [auto-assign.ts](../../packages/core/src/services/auto-assign.ts) —
naive v1. Matches `agent_zones` against the pickup ZIP and the airport-local
day, then balances by current workload. Managed from `/zones`
(`addAgentZones`, `listAgentZones`, `removeAgentZone`).

🧭 It is explicitly labelled v1 in the source. Treat it as a placeholder with a
correct _interface_, not as a solved routing problem.

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

`DATABASE_URL`, `DIRECT_DATABASE_URL`, Supabase URL + anon +
**`SUPABASE_SERVICE_ROLE_KEY`** (staff invites and evidence-photo signed URLs),
`NEXT_PUBLIC_AGENT_APP_URL`, `STRIPE_SECRET_KEY` (**refunds only**),
`SENTRY_DSN`.

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
