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

| Route                   | Does                                                                                                        | Badge             |
| ----------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------- |
| `/`                     | Overview — what needs a human right now, then launch readiness, then the day's shape. See §9                | —                 |
| `/bookings`             | Dispatch board — filter by status/airport/day, assign an agent, see at-risk bookings                        | `unassignedToday` |
| `/bookings/[bookingId]` | Full booking detail + custody timeline + evidence + payment                                                 | —                 |
| `/shifts`               | Who is out driving, in what, with how many bags. Force-end with a required reason; grant/revoke `can_drive` | —                 |
| `/exceptions`           | Bookings in `exception`, with the three legal resolutions                                                   | `exceptionsOpen`  |

### Configuration

| Route             | Does                                                                                                                                                                                    |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/pricing`        | The active pricing rule and the lead-time curve — **a path to change a price that is not SQL**                                                                                          |
| `/cutoffs`        | Airline bag-drop cutoffs per airline × airport × domestic/international                                                                                                                 |
| `/blocks`         | Window blackouts — **the only lever over what customers can book** (§3)                                                                                                                 |
| `/zones`          | Agent ZIP coverage, feeding auto-assignment                                                                                                                                             |
| `/agreements`     | Versioned booking agreements. "Current" is derived, never a flag                                                                                                                        |
| `/trucks`         | The fleet: name, bag capacity, active toggle. `reserved_spaces` is editable and **enforced** — held back from booking capacity. Editable during an open shift, within the guard in §5.4 |
| `/staff`          | Agents and admins, **grouped by role**, with active/everyone and can-drive filters in the URL and a per-person workload for today                                                       |
| `/staff/[userId]` | One staff member — their history, their zones, `can_drive`                                                                                                                              |

Plus `/login`, `/login/reset` and `/set-password`, which sit outside the rail.

🧭 **The badge counts compute nothing new.** Both already existed on
`OpsDashboard`; the rail surfaces numbers an operator previously had to navigate
to the landing page to see.

**`awaitingDriverToday` was a third badge, on Shifts, and was removed
(2026-08-31).** The metric is unchanged and still on the Overview dashboard —
sealed bookings today with no driver — but it counts BOOKINGS while `/shifts`
lists SHIFTS, so clicking it never showed the things it counted. It was placed
by CAUSE (nobody eligible is clocked on, and that page is where you fix it)
rather than by subject, which made it the odd one of the three:
`unassignedToday` and `exceptionsOpen` both sit on the page listing what they
count. It is also the one whose likeliest explanation needs no action at all —
the customer has simply not chosen yet — so a standing number there trained an
operator to ignore a badge, which is the opposite of the point.

`unassignedToday` and the retired count were always deliberately **separate** —
one needs an agent sent to a door, the other needs a van, and one badge meaning
both would hide whichever is rarer.

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

### 4.4 — Search reads eleven fields, and the row says which one hit

Reported as "search is case-sensitive". It never was: every clause has always
been `ilike`. **`bookings.ref` simply was not one of the clauses** — the only
thing resembling a ref lookup matched the last six hex of the UUID, which is a
different string entirely, so `KOO-CEMBB` matched nothing in any casing.

The searched set, one predicate per key:

| Key                          | Reads                                             |
| ---------------------------- | ------------------------------------------------- |
| `ref`                        | `bookings.ref`, any part, any case                |
| `id`                         | last six hex of the UUID — for a log or Sentry id |
| `seal`                       | `bags.seal_id`                                    |
| `phone`                      | booking contact **or** account, digits only       |
| `passenger`                  | `bookings.pax_name` — the name on the ticket      |
| `customer` / `email`         | the account holder                                |
| `flight`                     | `bookings.flight_number` ("DL777" or "777")       |
| `driver` / `truck` / `agent` | who is carrying it, in what, who verified it      |

**Address and ZIP are deliberately absent, and a test pins that.** This
reverses the file's own former comment — matching a name was called "a fishing
expedition over customer PII" — and TD's reversal is the better position: the
person on the phone knows their own name and their flight and rarely their
ref, and an operator who cannot find them by name reads the whole board by eye
instead, which is the same PII with more of it on screen. "Who is booked on
this street" is a different question. It answers no support call, and it is
the one search here that would be worth misusing.

**Passenger and customer are separate keys because they are separate people.**
Somebody books for a parent; both names must be reachable and the badge has to
say which was hit.

#### `matchedOn` is built from the same list as the WHERE clause

`searchPredicates` returns `{key, where}[]`. That one list builds `or(...)` for
the filter AND a `CASE`-per-key array expression for `BoardRow.matchedOn`.
Written twice they would drift, and the failure would be quiet and awful: a row
badged "Email" that actually matched on something else is worse than no badge,
because an operator would believe it.

The board shows eight fields and search reads eleven, so **a row can appear for
a reason nowhere on it** — a seal id, an email. The badges sit under the ref,
on one line, capped at three plus a `+N` whose tooltip names the rest. Not
wrapped: two badges made a row twice the height of its neighbours, and a board
with uneven rows is harder to scan down.

The customer is a LEFT JOIN rather than an `exists` subquery, because search
reads three of their columns and `matchedOn` re-reads the same three — six
correlated subqueries per row for data behind one foreign key.

#### The box must not be remounted while somebody is typing in it

The filter bar held the term in the DOM rather than in state — correct, and the
reason is written in the file — and re-seeded it from the URL with
`key={search}`. That is right for a Reset or a pasted link and **wrong for the
ordinary case**: the search a person is typing also changes the URL, so 300 ms
after they stopped the input was destroyed and rebuilt, and focus went to
`document.body`. Every refinement of a term meant clicking back into the box.

`key` is replaced by a ref holding **the term this bar itself asked for**. When
the URL's term matches it the navigation was ours and nothing is touched; when
it differs the term came from outside — Reset, a pasted link, the back button —
and the input's `value` is written directly. Writing to the node keeps the
element alive, which is the whole difference.

What is deliberately NOT re-seeded: typing two characters pushes `q=""`, since
that is below the minimum, so the URL says `""` while the box says `"ce"`. The
ref says `""` too, they agree, and the half-typed term stays where it was put.

There are **two** search boxes named `q`. The console top bar's is Enter-only
by design and navigates to `/bookings?q=`; the filter bar's is the debounced
one. Worth knowing before diagnosing either — a selector for `input[name="q"]`
finds the header's first.

---

## 4.5 — Every page's form is behind a button

Six pages had grown the same layout: a list on the left and a form pinned
permanently down the right in a `2fr 1fr` grid — invite staff, add a truck,
assign ZIPs, block windows, add an airline, publish a pricing rule. Every one
of those forms is used occasionally and read never, and each was taking a third
of the page from the thing an operator came to look at.

They are now `FormSheet`s behind labelled buttons in the page header. The
agreement workbench's version history is the same move for the same reason: the
editor is a rich-text surface for a legal document and wants every pixel, and
picking a version closes the drawer rather than leaving it open over the editor
it just loaded into.

**Pricing was rebuilt rather than moved.** The publish form held the wide
column and the live rule sat second and narrower _below_ it, so "what are we
charging right now?" was answered after a form nobody came to fill in — and the
figures existed only in the page subtitle. The live rule now leads with its
base, per-bag and per-km at a size somebody can read across a desk; the history
follows, each one click from being live again.

**The booking detail consolidated too:** _Details & payments_ is one card
(one fact split across a rule is not two facts), _Verify & seal_ is the identity
gate and the seals together with the assigned agent named at the top, and
_Assignment_ absorbs the pickup run. Assignment deliberately stays in the ACT
column — the page is read-left / act-right, and the visit's record is reading
while reassigning is acting.

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

### 5.0 — When reassignment closes

One function answers it — `assignmentGate` in `services/actionability.ts`, read
by core to refuse and by the console to hide the control with the same
sentence. It sits beside the five customer/agent gates and deliberately outside
them: those are about TIME (a late booking is still savable, which is the whole
reason `phase` exists), and this is about STANDING alone. A booking twenty
minutes past its window can still be handed to a driver who can make the
cutoff — that is exactly when a dispatcher needs it.

**The two kinds close at different moments, and the asymmetry is the point.**

- **Verification closes when the VISIT is done.** The seals, the photos and the
  passport check are recorded against the agent who did them; reassigning would
  reattribute somebody's evidence.
- **Pickup closes when the BOOKING is done**, which is later — a driver can be
  swapped right up until the bags are in a van, because until then the job is
  "go to a door" and any driver can do it.

Before F5 this was three separate status lists, one per call site, and **not
one of them mentioned `cancelled`** — so a cancelled booking could have its
driver swapped, and one that already had an agent skipped the check entirely
because that branch only ran for a first assignment.

The **in-transit** refusal stays in `adminUnassignPickup`, where its sentence
can name force-end-shift as the honest route: that is a fact about the incident
path rather than about standing.

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

### 5.4 — A truck's capacity may not strand its own load

Name, capacity and `reserved_spaces` are all editable **during** an open shift;
only deactivation is refused outright (an inactive truck is filtered out of
every read in `driver-selection.ts`, so the driver would vanish while still
holding bags).

The one guard: while a shift is open, `capacity − reserved` may not fall below
the bags already committed to it. The refusal names the numbers — _"Van Live
has 4 bags committed on its open shift, and 6 capacity minus 5 reserved leaves
only 1"_ — and the form says the constraint before it is hit.

**This reversed a documented decision, on purpose.** `updateTruck`'s header
used to say capacity could be cut below what was aboard, because the number is
being corrected and refusing would not unload the van. That is true, and
nothing breaks: `bookableSpaces` floors at zero, so the van simply stops being
offered. **That silence is the problem.** On a truck with a shift open, the far
likelier cause of "capacity 5" on a van that holds 15 is a typo, and the
consequence of accepting it is a driver quietly leaving every customer's
shortlist for the rest of their shift with nothing anywhere saying why. The
correction is deferred, not lost: end the shift and the edit goes through, and
the message says so.

## 6. Staff management

**Invite-only. No self-signup.** `createStaffMember` issues the invite;
`getActiveStaffRole` / `isStaffRole` back every role check; `requireRole`
enforces.

⚠️ **Agent invites must land on the _agent_ app**, which is why
`NEXT_PUBLIC_AGENT_APP_URL` sits in admin's production boot gate. Missing it,
invite links go to the wrong app — and that failure is silent, so the gate
refuses to boot instead.

**The roster is grouped by role**, because agents and admins are two different
lists that happened to share a table — an agent is somebody you dispatch, an
admin is somebody with console access, and sorted by `created_at` the two
interleaved. Two filters live in the URL, in deliberately different shapes:
active/everyone is a `SegmentedControl` (two views of one list) and "can drive"
is a checkbox (an additional narrowing). Default is active only, with a
"Showing 12 of 16" beside it so the default never hides anything silently.

**Workload is counted BY BOOKING, not by task.** In v1 one person holds both
the verification and the pickup task for the same trip, so counting task rows
reports six jobs for three addresses — a number beside somebody's name that is
worse than no number. `listStaffWorkloadToday` derives it on every read: no
counter column, no `staff_stats` table, per the standing rule that a counter on
a write path is a thing that has to be kept in step with what it counts. The
in-progress booking is a link, because "who is on what right now" is always
followed by "show me".

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

---

## 9. The Overview page

Four stat cards, three of which read `0` on an ordinary day. The page was the
**same shape whether everything was fine or the fleet was on fire**, and only a
digit told you which — so an operator signing in read four numbers to learn
there was nothing to do.

The page now answers three questions in order, and the first one is the point.

### 9.1 — What needs a human (`buildAttention`)

[apps/admin/src/lib/attention.ts](../../apps/admin/src/lib/attention.ts). Lives
in the app rather than in core: it is a rendering decision about what an
operator should look at first, not a fact about the domain.

**Ordered by consequence, never by which query ran first:**

| Level     | Means                                                   |
| --------- | ------------------------------------------------------- |
| `blocked` | The product cannot sell — no pricing rule, no agreement |
| `urgent`  | A booking is failing today                              |
| `soon`    | Real work nobody has picked up yet                      |

**An empty list is the design.** Nothing wrong renders one green line —
"Nothing needs you right now" plus the day's shape — so the LENGTH of the page
is the signal. One line means go and do something else; a list you scroll means
today is busy. You can tell across a room, without reading a digit.

Three rules the tests pin:

- **A zero is not news.** Nine completed bookings is a fine day, not an item.
- **State the absence, not the checklist phrase.** "Pricing rule active" reads
  correctly beside a tick and badly as an alarm; the alarm says "No pricing
  rule is active".
- **"Nobody on shift" needs sealed bags waiting.** An empty road at 6am is
  ordinary and so is a sealed booking mid-morning; together they are the one
  shape where bags sit on a doorstep with literally nobody who could be chosen.

Every item carries a destination and a verb — the whole row is the link, because
the thing an operator is pointing at is the problem.

### 9.2 — Launch readiness, which deletes itself

`getLaunchReadiness` (core) checks the four conditions under which Koolee stops
working **with no error anywhere**: no active pricing rule and every quote
refuses; no published agreement and every agent visit stops at a doorstep; plus
cutoffs and staff. Before this, the console's only signal was
`NoAgreementBanner`, covering one of the four.

**The panel is not rendered once all four pass.** A permanent all-green health
block is a thing nobody reads, so on the day it matters it will not be read
either. [LAUNCH-CHECKLIST.md](../LAUNCH-CHECKLIST.md) remains the record of the
whole opening, including everything no query can see.

Blocked items appear in BOTH panels deliberately: the attention panel is what
somebody does today, this is the progress bar toward opening.

**A trap found in the browser, not by a test:** the first version raised
unverified cutoffs as a quiet third level, which printed the identical sentence
twice on one page — once as a note and once in the readiness list three rows
below. The `note` level is gone; the division is by TIME. This panel is a job
before opening, that one is today.
