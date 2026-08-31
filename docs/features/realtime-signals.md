# Realtime — a signal, never a source of truth

> **How a Koolee screen updates without anybody pressing anything, and the one
> rule that keeps that from becoming a second data path.** Baseline:
> `dev` @ `5db21a4`.
>
> For the notification matrix (what is in-app versus email) read
> [notifications.md](notifications.md). For the storage buckets that use the
> same anon-key/RLS shape read [storage-and-avatars.md](storage-and-avatars.md).

---

## 1. The rule

**Supabase Realtime tells a client THAT something changed. It never tells it
WHAT.** The client then refetches through the ordinary server path — a
`router.refresh()` on a `force-dynamic` page, which re-runs the server
component and every Drizzle query behind it.

Three things follow, and they are the reason the rule is worth writing down:

1. **Drizzle stays the only read path.** Every authorization check in
   `packages/core` still runs on every render. A realtime payload cannot route
   around `getBookingDetailForSession`, because nothing reads it.
2. **An RLS mistake is not a disclosure.** The worst case is that a browser
   learns some booking changed at some instant. There is nothing else in the
   row to leak.
3. **Live degrades to polling instead of failing.** A socket that never
   connects — a proxy, a locked-down browser, Supabase not configured at all —
   leaves the interval that was already there running. Nobody is worse off than
   they were before this existed.

The corollary is a rule for reviewers: if you ever find yourself rendering a
field out of a realtime payload, the design has been inverted.

---

## 2. `booking_signals` — three columns and one policy

Migration `0030`. One row per booking, overwritten in place.

| column       | what it is                                                     |
| ------------ | -------------------------------------------------------------- |
| `booking_id` | PK, `ON DELETE CASCADE` — a deleted booking takes its doorbell |
| `updated_at` | the only thing anybody cares about: that it MOVED              |
| `touched_by` | who caused it. Diagnostics; never branch on it                 |

**Why a separate table rather than realtime on `bookings`.** RLS on the real
domain tables would put a second authorization model beside the one in
`packages/core` — invisible to every test, because the integration tier runs on
the direct connection where RLS is never consulted at all. That is the same
blind spot that let the pre-`0009` storage-policy bug ship twice. One narrow
table means one policy to get right, and a bounded blast radius when it is
wrong.

`custody_events` keeps its `0001` policy and **has left the publication**
(migration `0034`). The reasoning above — "left alone rather than removed,
because removing a published table is a migration with no upside" — had the
cost the wrong way round: a published table with no grant is a trap, not a
neutral. It delivers nothing, says nothing, and reads to the next person as a
subscription that ought to work. The upside of removing it is that the trap is
gone; the policy stays, because it is correct and costs nothing.

### The policy

```sql
CREATE POLICY "booking_signals_select_watchable"
  ON public.booking_signals FOR SELECT TO authenticated
  USING (public.can_watch_booking(auth.uid(), booking_id))
```

SELECT only. Every write reaches this table over the direct/service-role
connection, which bypasses RLS, so an INSERT or UPDATE policy would describe a
client write path that does not exist.

`can_watch_booking` is **SECURITY DEFINER**, and that is not incidental. RLS is
on for every table in `public` (`0016`) and the task tables carry no policies,
so an inline `EXISTS (… verification_tasks …)` would evaluate as
`authenticated`, return zero rows, and the staff half of the policy would
silently never match. Exactly the shape of the storage bug fixed in `0009` and
again in `0023`. It admits:

- the customer who owns the booking (`bookings.user_id = uid`); and
- active staff with a verification or pickup task assigned to them.

Nobody else, and never a null `uid`.

---

## 3. Who rings the doorbell

**A database trigger, for almost everything.** `0030` puts
`public.touch_booking_signal()` on `custody_events` AFTER INSERT. Roughly
twenty services append custody evidence and none of them knows this table
exists — including services written after this one.

That choice is deliberate and it has a precedent in this codebase. The
exception-alert emit used to live at one route handler, which meant six of the
seven paths into `exception` were silent; moving it to the transition choke
points made a new path covered _by construction_ instead of by somebody
remembering. There is no equivalent choke point for custody inserts, so the
trigger is the construction.

**One explicit caller.** `recordDriverPosition` — the GPS ping — appends no
custody event on purpose, because a position is not evidence. It calls
`touchBookingSignals` for the bookings on the pinging driver's shift that are
still open. Without it, the ETA on the customer's card would move only on the
polling fallback, which is the one number a customer actually watches.

**And it is SCOPED to that driver's own shift, which has a consequence worth
knowing.** The filter is `pickup_tasks.driver_shift_id = <this shift>` — so a
booking whose customer is still CHOOSING a driver has no shift on its pickup
task and is signalled by nobody. **The driver shortlist therefore runs on the
poll alone**, and gets the faster one (`SIGNAL_POLL_FAST_MS`, 12s) for that
reason; the tracking map after selection gets the real signal.

Widening it is the expensive answer, not an oversight. A driver on shift is a
candidate for many bookings at once, so an unscoped ping would wake every
customer currently choosing — and each wake is a **full trip-page re-render**,
including an ETA round-trip per candidate through the Routes seam. Four
candidates times three pings a minute times everybody choosing is a great deal
of billable work for pins that move a block.

**Nothing time-based rings.** "Running late" and "missed cutoff" are computed
from the clock in `services/actionability.ts`, and nothing is written when they
become true — so nothing _can_ be signalled. The polling fallback is what
surfaces them, and it is the honest mechanism for a state change nobody
performs.

---

## 4. The client: `useBookingSignal`

[`packages/ui/src/lib/booking-signal.ts`](../../packages/ui/src/lib/booking-signal.ts).
Shared, because the three behaviours below are worth exactly one implementation:

- **Debounce (400 ms).** A single visit fires arrive + one seal per bag +
  complete within a second. Un-coalesced that is five full server re-renders on
  a phone at a customer's door.
- **Polling fallback (30 s, stretched to 120 s while the socket is live).** The
  interval the trip page already had. It keeps running even when the
  subscription reports `SUBSCRIBED`, because a channel that says it is
  connected and silently delivers nothing is the one failure the hook cannot
  detect from the inside.
- **Refetch on every (re)connect.** Whatever happened while a sleeping phone
  was disconnected produced no event that will ever be delivered.

It takes the Supabase client as an argument rather than importing one:
`@koolee/ui` must not depend on `@supabase/supabase-js`, and each app builds
its own browser client with its own cookie name (all three share one Supabase
project). The parameter is typed structurally against the two methods used, so
a real `SupabaseClient` satisfies it and the package takes no dependency.

**Filtering: always, and never "watch everything".** Every subscriber passes
booking ids and gets one `booking_id=eq.<uuid>` filter per id.

The first design had the agent's views subscribe UNFILTERED and let RLS decide
what reached them — the reasoning being that enumerating assigned bookings
client-side goes stale the moment ops assigns one more. **Measured in a
browser, that does not work:** an unfiltered `postgres_changes` on an
RLS-protected table reports `CHANNEL_ERROR`, while the identical filtered
subscription connects and delivers in under three seconds. Supabase evaluates
the policy per subscriber per row, and the unfiltered case is the one that
falls over.

So the server passes the ids it already has, and the staleness that argued
against it is exactly what the polling fallback is for: a booking assigned in
the last thirty seconds arrives on the next poll, and the re-render that
follows puts it in the filter list. `bookingIds` is a REQUIRED prop, and an
empty array means **poll-only** — a surface that does not know what it is
showing gets the honest fallback rather than a socket that silently never
fires.

Filtering is scoping, not a security boundary: the boundary is still
`getAssignedTask` refusing to resolve a task that is not theirs.

### Where it is wired

| App     | Component   | Watches                           | Effect                                     |
| ------- | ----------- | --------------------------------- | ------------------------------------------ |
| `web`   | `TripLive`  | one booking (trip page)           | whole trip page re-renders                 |
| `web`   | `TripLive`  | none on `/trips` → poll-only      | the list refreshes on the fallback         |
| `agent` | `LiveTasks` | every booking the view is showing | today, the schedule, and both task details |

### Two traps, both found by driving a browser

**1. A client component that returns `null` never mounts.** In a Next 16 /
Turbopack production build its module loads, its function body runs, and its
effects never fire — so the entire realtime layer was inert in every built app
and degraded silently to polling, which is precisely the failure the fallback
is designed to hide. `TripLive` and `LiveTasks` therefore render
`<span hidden aria-hidden="true" data-live-signal={status} />`. The attribute
is not decoration either: it is how "is this page live or polling?" is
answerable from the DOM rather than from console output in a debug build.

**2. A policy grants nothing.** `0030` enabled RLS and wrote a correct policy,
and no browser received a single event, because `authenticated` had no `SELECT`
privilege on the table — RLS narrows what a role may already read and cannot
widen it. `0031` grants it explicitly rather than relying on an environment's
default privileges, which local and hosted disagree about. See that migration's
header. `custody_events` carried the same shape since `0001` (RLS on, a
policy, published, no grant) and was deliberately left alone at the time;
`0034` removed it from the publication instead, because an armed-looking
subscription that can never deliver is worse than no subscription at all. If
it is ever re-added, **the grant must go with it** — that is this lesson,
stated once.

`TripLive` sits at **page** level, not inside the driver card. The interval it
replaces lived in `DriverTracking`, which meant the page went live only after a
driver had been chosen — an agent sealing bags on the doorstep changed nothing
on the screen the customer was watching.

---

## 5. Applying this to a hosted environment

Migration `0030` is applied by CI on merge like every other migration. Two
things it cannot do for you, both in the Supabase dashboard:

1. **Realtime must be enabled for the table.** The migration adds
   `booking_signals` to the `supabase_realtime` publication and sets
   `REPLICA IDENTITY FULL`, which is everything SQL can do. Confirm under
   _Database → Replication_ that the `supabase_realtime` publication is on and
   lists `booking_signals`.
2. **Nothing else.** No new environment variables, in any app or in core: the
   browser clients use `NEXT_PUBLIC_SUPABASE_URL` and
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, which every app already reads.

Verify afterwards:

```sql
-- The doorbell, its policy, and its publication membership.
select relrowsecurity, relreplident from pg_class where oid = 'public.booking_signals'::regclass;
select policyname, cmd from pg_policies where tablename = 'booking_signals';
select tablename from pg_publication_tables where pubname = 'supabase_realtime';
select tgname from pg_trigger where tgrelid = 'public.custody_events'::regclass and not tgisinternal;
```

`relreplident` must be `f` (FULL) and exactly one policy must exist. If the
publication does not list `booking_signals`, every client silently falls back
to polling — which is a degradation, not an outage, and is the intended shape
of that failure.

**Smoke test:** open a trip page as the customer and the same booking's task in
the agent app, side by side. Accept the agreement in the customer window; the
agent's identity gate unlocks without a reload.
