# Run report 7 — Tier 4: driver role, pickup lifecycle, selection, ETA + tracking

**Branch:** `feat/driver-pickup`, cut from `origin/dev` @ `fafa378` with
`--no-track` (`branch.feat/driver-pickup.merge` verified empty). **No commits
are made by this session** — every phase below is checkpointed here and TD
commits after review.

**One session, one branch.** RUN-REPORT-6 §0 is the reason: a shared checkout
makes "is this broken, or is someone else mid-write?" unanswerable from the
tree alone.

**Databases touched: LOCAL ONLY.** `127.0.0.1:54322` — the dev `postgres`
database for migrations and the seed, the disposable `koolee_test` for the
integration tier. Hosted was never contacted; no `DIRECT_DATABASE_URL`
override was ever set. Every migration/seed command printed
`Target host: 127.0.0.1` first and it was read. Hosted apply is TD's manual
step (§3.1) and is written up in the setup doc named in Phase 7.

**Design source:** [REPORT-tier4-preflight.md](REPORT-tier4-preflight.md).
Where the slice prompt and that report's facts disagreed, the code was
re-read; each resolution is recorded in the phase that hit it.

---

## Phase 0 — Geo groundwork

The preflight's blocking finding (§7.1–§7.2) was that the haversine seam had
no coordinates at either end: `addresses.lat/lng` were 0-of-8 populated and
`airports` had no lat/lng column at all. This phase supplies both, at ZIP
resolution, without touching the booking funnel.

### What landed

| # | Thing | Where |
|---|---|---|
| 1 | `zip_centroids` table + 837-row NYC-metro dataset | `packages/db/src/schema/geo.ts`, `packages/db/src/zip-centroids.ts` |
| 2 | `airports.lat/lng`, NOT NULL, three terminals seeded | `packages/db/src/schema/airports.ts`, `seed.ts` |
| 3 | `ensureAddress` derives coordinates from the ZIP centroid | `packages/core/src/services/customers.ts` |
| 4 | `EtaEstimator` seam + `HaversineEtaEstimator` + factory | `packages/core/src/geo/` |
| 5 | `cutoffRiskMonitor`: real scope + real ETA | `packages/core/src/jobs/functions.ts`, `packages/core/src/slots/cutoff.ts` |
| — | Migration **0028**, LOCAL ONLY | `packages/db/drizzle/0028_geo_zip_centroids.sql` |

### The ZIP-centroid dataset

**Source: US Census Bureau, 2023 National ZCTA Gazetteer** (public domain),
`2023_Gaz_zcta_national.zip`. `INTPTLAT`/`INTPTLONG` are *internal points* —
a centroid pulled inside the polygon, so a C-shaped ZCTA never reports a
coordinate in the sea. Filtered to prefixes **100–119** (NY: five boroughs,
Long Island, lower Westchester) and **070–079** (NJ: Hudson, Bergen, Essex,
Union and neighbours), rounded to five decimals. 836 rows.

**One ZIP had to be hand-entered.** `10281` (Brookfield Place, Battery Park
City) is a single-building ZIP with no ZCTA at all — it is absent from the
gazetteer while being present in Koolee's coverage allowlist. Its coordinate
comes from the street address, and the file header says so. That makes 837.

`zip-centroids.test.ts` fails if any coverage ZIP ever loses its centroid, so
widening `coverage-zips.ts` without regenerating the dataset is caught in CI
rather than as a silent per-ZIP downgrade of driver selection.

### Where the data lives, and why in two places

Runtime reads the **table**; the TS module is the payload the seed loads into
it. The migration also carries a snapshot of the same payload, because its
step 5 backfills existing addresses by joining `zip_centroids` and a migration
cannot depend on a seed having run first. Re-seeding reconciles the table back
to the file, so the file stays the single thing to edit.

### Migration 0028, statement by statement

Drizzle generated a bare `ALTER TABLE airports ADD COLUMN lat ... NOT NULL`,
which fails outright against existing rows. Rewritten to the 0021 shape —
nullable → backfill → constrain — plus the data and the address backfill:

1. `CREATE TABLE zip_centroids` (+ lat/lng range CHECKs — a transposed pair is
   silent otherwise: the haversine still returns a number, just one pointing
   at Antarctica).
2. `ENABLE ROW LEVEL SECURITY` explicitly, per 0016/0022: the `ensure_rls`
   event trigger needs superuser, which Supabase's `postgres` role lacks.
3. 837 reference rows, `ON CONFLICT DO UPDATE`.
4. `airports`: add nullable → three `UPDATE`s → a guard that RAISEs if any
   airport is still uncoordinated → `SET NOT NULL` → two range CHECKs.
5. `addresses` backfill: `UPDATE … FROM zip_centroids` touching only rows whose
   lat IS NULL, so a precisely geocoded address is never overwritten by a
   centroid. Unknown ZIPs stay NULL and are counted in a `RAISE NOTICE`, by ZIP,
   rather than failing the migration.

**Applied locally, verified by a read-only probe** (`SELECT` only, deleted
after running — the preflight §6.6 pattern):

```
zip_centroids : 837 rows, 07001 … 11980
airports      : EWR 40.6895/-74.1787 · JFK 40.6446/-73.7797 · LGA 40.7743/-73.8722
addresses     : 8 total, 8 with lat  (0 left without coordinates)
```

### The ETA seam

`EtaEstimator.estimate({from, to}) → {minMinutes, maxMinutes}`. Injected
through `createRuntime` (`eta?: EtaEstimatorConfig` declarative, or an
`etaEstimator` instance for a future credentialled provider — the same split
the Inngest emitter uses). Core still reads no environment.

**The result is always a RANGE, never a point.** An estimate built from ZIP
centroids and an average speed is not accurate to the minute and must not be
rendered as though it were.

**A calibration finding worth surfacing rather than burying.** At the
specified constants (road factor 1.5, 18 km/h, 5-minute floor, ±30% widened to
5-minute steps), Midtown → JFK estimates **75–145 min against a real ~50**.
The model has no notion of a highway, so the longer the run the more it
over-states. The constants are kept as specified, because the bias points the
safe way for both consumers:

- the customer-facing card only ever shows a driver **already in zone** — a
  few kilometres out, where the model is realistic (Midtown → Williamsburg
  reads 20–40 min);
- `cutoffRiskMonitor` uses the pickup → airport leg, where over-stating the
  drive makes the alert fire **early**, which is the entire point of it.

Both halves are pinned by tests (`eta.test.ts`) so the trade-off cannot drift
silently, and the constants are named static fields so a recalibration is a
one-line change. **A routing provider behind the same seam is what fixes the
middle ground** — flagged for TD, not fixed here (out of scope by the prompt).

### The `cutoffRiskMonitor` fixes (preflight §7.12)

**Scope — resolution recorded, because the prompt and the code disagreed.**
The prompt says "use the booking's REAL scope (never assume domestic)".
Re-reading the code: **bookings do not persist a scope at all**. `bookings.ts`
has no scope column; the ticket extractor derives one at quote time and
nothing stores it. There is no real scope to read.

The codebase had already answered this question once, in
`getBookingDetail` (`bookings.ts:289-296`): take the **strictest** cutoff
across the scopes that match. That rule is now a named function,
`resolveStrictestCutoffMinutes`, and the monitor uses it. Strictest = the
largest minutes-before-departure. This is a real fix, not a rename: `domestic`
is the *looser* of the two seeded values (45 vs 60), so the old assumption
measured international flights against a deadline 15 minutes later than the
real one and stayed quiet on exactly the bags hardest to re-cut.

**Drive time.** The flat `defaults.driveTimeMinutes` is replaced by the
estimator wherever both ends have coordinates, taking `maxMinutes` — the
pessimistic end, because this is an alert. The configured default remains the
fallback for an address whose ZIP has no centroid, and the alert payload now
carries `driveMinutes` + `driveSource` so an alert is auditable.

Still stubbed, deliberately: the drive is measured from the **pickup address**,
not from where the driver actually is. Wiring `driver_positions` in here is the
obvious next step and is left out so the function keeps working for a booking
whose driver has GPS off.

### Collateral: one shared test fixture

`airports.lat/lng` being NOT NULL broke thirteen integration suites at once,
each spelling `{ code, name, tz }` inline. They now share
`packages/core/src/test-utils/airport-fixtures.ts`. The next airport column
will not break thirteen files.

### Phase 0 gate

| Gate | Result |
|---|---|
| `turbo typecheck` | **6/6 pass** |
| `turbo lint` | **6/6 pass** |
| `turbo test` (unit) | **394 passed, 1 skipped** |
| `pnpm test:integration` (core, `koolee_test`) | **135 passed, 3 skipped, 17 files** |
| `turbo build` (prod) | **3/3 pass** |
| `pnpm db:status` (local) | in sync, 29/29 by content hash |
| Seed idempotency | re-ran clean; 837 centroids reconciled |

New tests: `geo/eta.test.ts` (26), `geo/zip-centroids.test.ts` (7),
`slots/cutoff.test.ts` +7 for `resolveStrictestCutoffMinutes`,
`jobs/functions.test.ts` +4 for the two monitor fixes.

---

## Phase 1 — Schema restructure (one migration)

### The drop, re-verified before it was written

The preflight said `drivers`, `routes` and `agents` were complete dead
scaffolding. The prompt required re-running the same checks and aborting if
anything had changed. Both were re-run immediately before the migration:

```
grep over apps/ + packages/ (excluding node_modules, .next, drizzle/meta)
  drivers  → schema/identity.ts, schema/relations.ts, schema/ops.ts, and
             the `Driver` type re-export. Every other hit is prose:
             marketing copy, a `<Input placeholder="No drivers / weather">`,
             a test fixture string, a doc comment.
  routes   → schema/ops.ts, schema/relations.ts, `Route`/`RouteStatus`
             re-exports. Every other hit is the word "routes" as a verb or a
             Next.js route.
  agents   → schema/relations.ts only. Every other hit is a local variable
             or UI copy about staff.

read-only probe, local:
  agents 0 · drivers 0 · routes 0   (staff_members 11, pickup_tasks 14)
  FKs targeting the three: exactly one — routes.driver_id → drivers
```

Nothing had changed. The drop proceeded.

Also removed: `AgentSession.agentId` / `AgentSession.driverId`
(`auth/types.ts`) — optional fields pointing at the two dropped tables, never
once populated in any code path, and the `Agent` / `Driver` / `Route` /
`RouteStatus` type re-exports from the core barrel.

### The new tables

| Table | Shape | The decision inside it |
|---|---|---|
| `trucks` | id, **name UNIQUE** (free text), bag_capacity > 0, reserved_spaces ≥ 0 default 0, active, timestamps | No size-class enum — a size class would encode a capacity `bag_capacity` already states exactly. `name` is what a dispatcher and a driver say to each other, so it is the identifier. Deactivated, never deleted. |
| `driver_shifts` | id, staff_user_id → users, truck_id → trucks, started_at, ended_at nullable, timestamps | Two PARTIAL unique indexes — one active shift per person, one per truck, both `WHERE ended_at IS NULL`. `CHECK (ended_at IS NULL OR ended_at >= started_at)`. |
| `driver_positions` | staff_user_id PK/FK, lat, lng, recorded_at | One mutable row per driver, upserted. Header comment states in full that it is **NOT** part of the chain of custody. |

Plus `staff_members.can_drive` (bool, default false) and
`pickup_tasks.driver_shift_id` (nullable FK, SET NULL, indexed with status).

### Three decisions worth naming

**Driving is a capability, not a third role.** The `user_role` enum has carried
`driver` since 0000 and `staff_members_role_check` still excludes it,
deliberately. A third role would have forced `STAFF_ROLES`,
`getActiveStaffRole` and both app session readers to reason about somebody who
is an agent on Tuesday and a driver on Thursday — which is the actual v1
operation. `can_drive` says the same thing without splitting the roster. It
defaults **false**, so no existing agent silently became selectable as a driver.

**`pickup_tasks` now has two assignment columns and they must never disagree.**
`driver_shift_id` is the real target — a pickup belongs to a
truck-with-a-person-in-it, which is what turns "you cannot clock off, there are
bags in your van" into a query. `assignee_user_id` stays and is written in the
same statement, because six existing readers key on it (`getAssignedTask`,
`listAssignedTasks`, `agentHasTaskForBooking`, `listAgentBookingIds`, the
auto-assign load count, `listAgentWorkload`) and rewriting all six to join
through shifts would have been a far larger diff for zero behaviour change.
The rule is written on the table.

**No new task statuses.** The prompt allowed adding to the `task_status` enum
"only if the existing enum lacks what Phase 3 needs". It does not: the pickup
lifecycle maps onto `assigned → in_progress → done`, and the fine-grained
states (`awaiting_pickup`, `in_transit`, `delivered_to_bagdrop`) already live
on the booking. Nothing added.

### How the migration was generated — worth knowing before the next one

`drizzle-kit generate` **prompts interactively** when a diff both creates and
drops tables: it cannot tell a drop-plus-create from a rename, and it asks. In
a non-TTY it exits with a stack trace and writes nothing.

The workaround, so the slice still lands as **one** migration:

1. Re-declared the three dead tables in a temporary schema module, so the
   first generate saw **creations only** → no prompt.
2. Deleted that module, generated again → **drops only** → no prompt.
3. Concatenated the two SQL files into `0029`, deleted the second, promoted the
   second snapshot to `0029_snapshot.json` (it is the true final state) and
   re-chained its `prevId` onto `0028`'s `id`, then removed the `0030` journal
   entry.

Verified after the merge: `prevId` chains, 27 tables in the snapshot, and none
of `agents`/`drivers`/`routes` present. This is journal surgery on an
UNAPPLIED migration only, which is why it is safe — §7's rule is about never
reverting a journal entry on an assumption about a database that already ran it.

### What the merged migration does, in order

Creations first (so `pickup_tasks.driver_shift_id` has a table to reference),
then RLS on all three new tables (explicitly, per 0016/0022 — the `ensure_rls`
event trigger needs superuser that Supabase's `postgres` role lacks), then a
**fail-closed guard**, then the drops.

The guard counts all three tables and `RAISE EXCEPTION`s if the total is not
zero — a row means somebody started using a table this migration is about to
delete, and the migration aborts rather than proceeding. The drops run in FK
order (routes → drivers → agents) with **no `CASCADE`**: Drizzle generated
`CASCADE` on all three, and it was removed, because CASCADE would silently take
dependents with it and the entire claim being made is that there are none.

### Seed

Two dev trucks — `DEV Truck A — 30 bags`, `DEV Truck B — 12 bags` — so capacity
is testable in both directions (a run that fits, a run that does not). The
upsert deliberately does **not** reset `active`: an operator who deactivated a
truck should not find it back on the road after a re-seed. All five seeded
field agents get `can_drive = true`; admins do not. **No shifts are seeded** —
an open shift asserts "somebody is out driving right now", and seeding one puts
phantom drivers in front of customers on a machine nobody is driving from.

### Phase 1 gate

| Gate | Result |
|---|---|
| `turbo typecheck` | **6/6 pass** |
| `turbo lint` | **6/6 pass** |
| `turbo test` (unit) | **24 + 3 + 2 + 9 + 1 files pass** |
| `pnpm test:integration` (core, `koolee_test`) | **135 passed, 3 skipped** |
| `pnpm db:migrate` → `db:status` (local) | **30 of 30 by content hash, in sync** |
| `scripts/test-env.sh verify` | **8/8 pass** — 27 tables both databases, columns match |
| Seed idempotency | re-ran clean; trucks + `can_drive` converged |

---

## Phase 2 — Core: shifts + selection

Three new modules in `packages/core/src/services/`: `shifts.ts`,
`driver-selection.ts`, and `pickup-events.ts` (the custody vocabulary for the
whole slice, in one place, because `custody_events.event_type` is free text and
a typo in an event name fails silently forever).

### Shifts

`startShift` / `endShift` / `adminForceEndShift`, plus the reads the two apps
need (`getActiveShift`, `shiftBlockers`, `listTruckOptions`, `bagsOnShift`).

**The invariants live in the database, not in this file.** Two partial unique
indexes — one open shift per person, one per truck — are what stand between two
taps on "Start shift" and two people dispatched to the same van. `startShift`
catches `23505` and then RE-READS to say which half collided, because "you are
already on shift with Van A" and "that van is out with Nina Petrov" want
different actions from the driver. Proven by an integration test that fires two
concurrent starts at one truck and asserts exactly one `driver_shifts` row.

**`endShift` refuses while bags are on the truck**, and the error names the
bookings (`KOO-…`) and the bag count rather than saying "no". Enforced in core,
not in the agent UI — a server action stays a reachable POST whatever the UI
renders.

**Bags, never task count.** `bagsOnShift` sums `bookings.bag_count` over the
shift's open pickup tasks. Counting tasks would let a 12-bag van accept twelve
four-bag runs. One test asserts two 2-bag pickups read as 4 bags on board.

**`adminForceEndShift` does something honest with what was on the truck.** Each
open pickup is RELEASED — shift cleared, assignee cleared, status back to
`pending`, `startedAt` cleared, and a `pickup.shift_force_ended` custody event
carrying the required reason. An unassigned sealed booking is what the board's
at-risk flag is for, so releasing is what puts these in front of a human.

**One case gets more than a release, and this is a deliberate addition to the
prompt's spec.** A booking already `in_transit` has its bags physically inside a
van whose shift just ended. Re-listing it for another driver to collect from a
door the bags have already left would be a lie, so those bookings are raised to
`exception` through `applyTransition` — which is also the choke point that emits
`booking/exception_raised` and pages ops (§7). Tested both ways.

### Driver selection

`listCandidateDrivers` → up to four candidates, `selectDriver` → the assignment,
`getSelectedDriver` → what the trip page and the console render,
`recordDriverPosition` → the GPS upsert.

The rule, in order: **on shift** (+ cleared to drive + truck active) → **covers
the ZIP** → **has room** (`bag_capacity − bags on board ≥ this booking's bag
count`) → sort by load ascending → take four. Four because a customer choosing
between four people is choosing; between fifteen they are doing dispatch's job.

**`agent_zones` is shared, not renamed.** 198 live rows and an admin CRUD behind
it, and its FK is already to `users`. What made a row "an agent's" was only the
column name plus the role filter its other reader applies — so the
discriminator moved to READ TIME here too, and this reader filters on
`can_drive` instead of `role`. Implemented as an `EXISTS` subquery so a driver
covering the ZIP twice cannot appear twice.

**Widening happens only when the in-zone pass is EMPTY, never to pad a short
list.** A customer offered one in-zone driver and three from across the river
would reasonably read that as four equivalent choices. Widened results all
carry `outOfZone: true`.

**ETA is null, not zero, when a driver has never pinged.** `formatEtaRange(null)`
renders "ETA on the way". Inventing a position for a driver whose phone has GPS
off is the one thing this must not do.

### The concurrency design, written down

`selectDriver` runs entirely inside one transaction behind **one**
`pg_advisory_xact_lock` on the chosen **shift**.

**Lock order: there isn't one, deliberately.** `otp-throttle.ts` takes two
advisory locks and therefore documents a fixed order (user, then destination)
to stay deadlock-free. This takes exactly one, ever, so no ordering rule is
needed and no deadlock is possible. The tempting second lock is the shift being
*released* when a customer re-chooses — it is not taken, because releasing only
ever ADDS capacity to the old shift, and no invariant is defended by an upper
bound going down. The comment says what to do if a second lock is ever needed
(ascending shift id, and write it down there).

**Why an advisory lock and not the other two house patterns:** a unique index
cannot express "sum of bag counts ≤ capacity", and a compare-and-swap needs one
column to swap on. `FOR UPDATE` appears nowhere in this codebase and this is
not the place to introduce it — the row being defended (`driver_shifts`) is not
the row being written (`pickup_tasks`).

**Concurrency test evidence** —
`driver-selection.integration.test.ts`, *"two concurrent selections for the last
space: exactly one wins"*: a three-bag van, two customers with two bags each,
`Promise.allSettled` over the real `selectDriver`:

```
won  = 1 fulfilled
lost = 1 rejected, ConflictError, message matches /filled up/
pickup_tasks with driver_shift_id = <shift>  →  exactly 1 row
```

The last assertion is the one that matters: not just that somebody got an
error, but that the van is not carrying four bags in three spaces.

**Selection is re-runnable until the driver sets off.** Re-choosing moves the
one pickup task row, which releases the previous shift by construction — there
is no second row to clean up. A test asserts the old shift's `bagsOnBoard`
returns to 0 and that both `pickup.driver_released` and a second
`pickup.driver_selected` are appended. Once `started_at` is set the choice is
closed ("Your driver is already on the way").

### Agents stay shift-blind — the decision, in the code

A 20-line comment at the `autoAssignBooking` candidate query says why, so it
reads as chosen rather than forgotten (preflight §7.5): a verification visit is
scheduled against a pickup WINDOW bought hours ahead, while a shift is a live
"I am out right now" fact — filtering tomorrow's 9 AM visit by who is clocked in
tonight would assign nobody to anything. And shifts exist for drivers because a
driver has a truck with finite capacity that a customer picks in real time; an
agent has neither. The comment names itself as the thing to delete if agent
rostering ever ships.

### Housekeeping picked up on the way

`OPEN_TASK_STATUSES` existed twice, privately, in `dispatch.ts` and
`auto-assign.ts` — and this slice needed a third reader (the shift-end guard).
Three copies of "what counts as open work" disagreeing is how a driver clocks
off mid-run, so it now lives once in `tasks.ts` with a note naming its three
readers. `ConflictField` gained `"shift"` and `"driver"`.

### Phase 2 gate

| Gate | Result |
|---|---|
| `turbo typecheck` | **6/6 pass** |
| `turbo lint` | **6/6 pass** |
| `turbo test` (unit) | **581 tests pass** across 5 packages |
| `pnpm test:integration` | **167 passed, 3 skipped, 19 files** (was 135/17) |

New suites: `driver-selection.integration.test.ts` (15),
`shifts.integration.test.ts` (17).

---

## Phase 3 — Core: the pickup lifecycle gets callers

`packages/core/src/services/pickup.ts`. Before this file, four state-machine
transitions had **no production caller at all** — `mark_awaiting_pickup`,
`start_transit`, `deliver_to_bagdrop`, `complete` — nothing ever advanced a
`pickup_tasks` row, and the only way past `verified_sealed` was an admin
override (preflight §4.3, §1.3).

Same hard rails as the verification visit: authorization IS assignment (task
resolved by `(id, assignee = session.userId)` in the WHERE clause, so somebody
else's task 404s rather than being checked after the fact), this file touches
only `pickup_tasks`, and it never touches money.

### The five steps

| Function | What moves |
|---|---|
| `startPickupTravel` | `verified_sealed → awaiting_pickup` (if not already), task `in_progress` + `started_at`, `pickup.travel_started`. Driver choice closes here. |
| `scanSealAtPickup` | One `pickup.seal_scanned` per bag; on the scan that completes the set, `start_transit`. |
| `deliverToBagdrop` | `deliver_to_bagdrop`. |
| `confirmAirlineHandover` | `complete` + `pickup.handover_confirmed`, task `done`. |
| `reportPickupException` | `raise_exception` + task `failed` + ops alert. |

### Four decisions inside it

**Scanned state is derived from `custody_events`, not from a column.** The scan
IS the evidence — an append-only row carrying the bag, the seal, the driver and
best-effort coordinates. A second place to record it would be a second thing to
keep in step, and the one that could disagree with the chain of custody.

**The seal match is scoped to THIS booking, and a miss is loud.**
`bags.seal_id` is unique operation-wide, so a seal from another booking would
resolve to a real bag — and loading somebody else's bag into this van is
exactly the mistake worth refusing. A non-matching value appends
`pickup.seal_mismatch`, alerts ops, and throws a `ConflictError` telling the
driver not to load the bag and to file an exception. No format rule beyond a
trim: the seal id is deliberately opaque and no code may infer structure from
it.

**Custody moves on the LAST bag, never earlier.** A partially loaded van with
the booking marked in-transit is a booking whose timeline claims Koolee holds
bags it does not hold. A test asserts the booking is still `awaiting_pickup`
after the first of two scans.

**`deliverToBagdrop` and `confirmAirlineHandover` stay two steps.** The gap
between arriving at the counter and the airline actually taking the bags is a
real interval — a queue, a closed counter, an agent asking for a document — and
it is the interval a customer most wants to see. Collapsing them would have the
timeline say "delivered" while a driver is still holding four suitcases.

**Every step is idempotent**, because the agent app is an offline-prone PWA on
a phone in a van: a tap that times out gets tapped again. Each function asks
"has this already happened?" and returns the current state rather than erroring.
One test calls all five steps twice and asserts exactly one custody event of
each type.

### The at-risk fix (preflight §7.11)

Every at-risk surface read `verification_tasks` only, so a booking with its bags
sealed on a doorstep and nobody coming for them looked healthy on the board.

- `BoardRow` gained `driverShiftId`, `driverName`, `truckName`,
  `pickupTaskStatus`, and **`atRiskReason: "no_agent" | "no_driver" | null`**.
  `atRisk` stays a boolean so nothing downstream breaks; the reason is what is
  new. `no_driver` wins the label when both apply — sealed bags nobody is coming
  for is the later and worse failure.
- `OpsDashboard` gained **`awaitingDriverToday`**, kept SEPARATE from
  `unassignedToday` rather than folded into it: one needs an agent sent to a
  door, the other needs a van, and merging them would make one badge mean two
  things and hide whichever is rarer.
- The `no_driver` horizon is measured against **departure**, not the pickup
  window — once the bags are sealed the deadline that matters is the airline's.
  It is a deliberately coarse 12-hour proxy for the real cutoff, and the comment
  says so: resolving the true cutoff needs `airline_cutoffs` and the
  strictest-scope rule, which is `cutoffRiskMonitor`'s job. Putting deadline
  arithmetic inside a 200-row board query would move it into a render path.

The board query gained three LEFT joins (pickup task → shift → truck/user); all
left, so a booking with no pickup task still appears.

### Phase 3 gate

| Gate | Result |
|---|---|
| `turbo typecheck` | **6/6 pass** |
| `turbo lint` | **6/6 pass** |
| `turbo test` (unit) | **581 pass** |
| `pnpm test:integration` | **180 passed, 3 skipped, 20 files** (was 167/19) |

New suite: `pickup.integration.test.ts` (13), including the full nine-event
custody trail asserted in order, the double-tap idempotency sweep, the
cross-booking seal refusal, and the two board/dashboard at-risk cases.

---

## Phase 4 — Customer web app

### The three states of the driver section

Mounted on the trip page immediately after the sealing card, and rendered only
once the bags are sealed — before that there is no driver to choose and asking
for a shortlist would be a query per render for a card that does not exist.

1. **Choose your driver** — up to four cards (first name, avatar, truck name,
   remaining capacity after this booking's bags, ETA range). Selecting posts
   the shift id to `selectDriverAction`.
2. **Nothing to offer** — "We're assigning your driver — you'll get a
   confirmation as soon as they're on it." It deliberately does NOT say "no
   drivers available": that is a Koolee staffing problem described to the
   customer as theirs, and there is nothing they can do with it. The ops alert
   is what makes the sentence true.
3. **After selection** — the driver card, distance, updating ETA, a status
   timeline, and when the position was last updated.

**A race loss is not a dead end.** `selectDriverAction` returns
`{ error, stale: true }` for a `ConflictError`, and the client `router.refresh()`
es on `stale` — so the customer's next click is a different driver rather than a
retry of the one who just filled up. The action also `revalidatePath`s before
returning, so the refreshed list is already warm.

**Widening is framed honestly.** When every candidate is out of zone the card's
description says so — "everyone close by is full right now, so these drivers are
coming from a little further out" — rather than presenting a longer drive as an
equivalent choice.

### Live tracking, and the map that is deliberately absent

`DriverTracking` sets a 30-second `router.refresh()` while the run is under way.
The trip page is `force-dynamic`, so that re-runs the server component and
brings back a fresh position, distance and ETA. That is the whole mechanism —
no socket, no subscription, no client fetch. `CutoffCountdown` set the precedent
for an interval on this page; the difference is that one re-renders a known
instant and this one re-fetches.

**No map tiles, no map library, and that is a decision.** A map means a
third-party tile host inside a page that renders a private address, a library
in the bundle, and a person's live position drawn at street resolution. A
distance and an updating ETA answer the actual question — "how long until
somebody knocks" — with none of that. Noted here so the next reader knows it
was weighed. The seam to add one later is a single component swap.

### The status timeline

Five steps: Driver booked → On the way → Bags collected → In transit → At the
bag drop. Derived from the **booking** status, not the task status: the task is
`in_progress` from the moment the driver sets off right through to the airline
counter — one value covering three things the customer sees as different.

`pickupStepIndexFor` lives in `apps/web/src/lib/pickup-progress.ts` with 9 unit
tests, including one asserting it can never return an index past the end of the
track. `MilestoneTrack` in `@koolee/ui` was checked first (per the shared-
component rule) and does not fit: it renders a progression with no notion of
"you are here", which is the only thing this needs to say. Kept web-local until
a second app needs it.

### Emails

Three new builders in `notifications/emails.ts`, three new Inngest functions in
core's shared factory (registry now **9**, was 6):

| Event | Function | Notes |
|---|---|---|
| `booking/driver_selected` | `driver-selected-email` | Emitted by `selectDriver` after commit, deduped on the custody event id — so a customer who changes their mind gets the second email too. |
| `booking/delivered_to_bagdrop` | `bagdrop-delivered-email` | Emitted by `deliverToBagdrop` after the transition committed; `applyTransition`'s compare-and-swap means a loser never reaches the emit. |
| `booking/driver_pool_empty` | `driver-pool-empty-ops-alert` | Emails `OPS_ALERT_EMAIL`; console alert either way. |

**Registered in CORE's factory, not in the app that raises them** — the agent
app's Inngest client is send-only by design (it serves no `/api/inngest` route),
so a function added there would silently never run (preflight §7.17).
`apps/web` owns the registry and serves all nine.

**The driver-selected email carries no ETA, on purpose.** The estimate is live
and an email is a snapshot: "20–30 minutes" arriving in an inbox read an hour
later is worse than a line pointing at the page with the real number. A test
asserts the body contains no minutes.

**Copy rule, tested.** Both customer emails assert that neither the text nor the
HTML matches `/check(ing)? you in|check-in/i`, and that the delivery email says
the bags reached the **airline's bag drop**.

### Idempotency of the ops alert, without any state

`booking/driver_pool_empty` is raised from a RENDER — the trip page raises it
whenever it has nothing to offer, and an anxious customer refreshing would page
ops on every reload. The throttle is the **event id**, bucketed by UTC hour:
`booking-driver-pool-empty:<bookingId>:<YYYY-MM-DDTHH>`. Inngest drops a
repeated id, so that is the entire rate limit — no table, no cleanup, nothing to
get out of sync. `reportEmptyDriverPool` never throws: a page that cannot page
ops must still render.

### Custody copy, both consoles

Eight new event types got labels in **both** maps, which stay deliberately
unshared (the same event needs different words on a trip page and a dispatch
console):

- customer: "You chose your driver", "Your driver is on the way", "Seal checked
  at your door", "Your airline took your bags";
- ops: "Customer chose a driver." + truck, bags and the ETA range at the time of
  choosing; "A seal NOT on this booking was presented at the door — the bag was
  refused." + the value presented.

### Phase 4 gate

| Gate | Result |
|---|---|
| `turbo typecheck` | **6/6 pass** |
| `turbo lint` | **6/6 pass** |
| `turbo test` (unit) | **600 pass** (core 404, web 86, ui 85, admin 19, agent 6) |
| `pnpm test:integration` | **180 passed, 3 skipped** |
| `turbo build` (prod) | **3/3 pass** |

New tests: `pickup-progress.test.ts` (9), and 10 in `jobs/functions.test.ts`
covering the three new functions (registration, copy rules, the no-ETA rule,
the no-`OPS_ALERT_EMAIL` path, and the failed-send escalation).

---

## Phase 5 — Agent app (the field PWA)

### The shift bar

Top of **Today**, not behind a fourth tab. `nav.ts:16-17` argues three tabs is
the ceiling — what am I doing now, what is coming, who am I — and a shift is not
a fourth destination, it is the state the first tab is in (preflight §7.14: the
nav ceiling is a stated rule, so it needed either respecting or an explicit
reversal; this respects it).

Off shift → a truck picker + "Start shift". On shift → truck name, `n of N
spaces used`, room left, start time, "End shift".

**Trucks already out are listed and DISABLED, not filtered out.** A driver who
cannot find their van in the list learns nothing; a greyed-out one labelled
"out with another driver" is an answer.

**The blocked-end message is shown verbatim.** Core writes it for the driver —
"You still have 2 bags for KOO-7H2QM. Finish or hand over that pickup before
ending your shift." — so the action layer passes `ConflictError.message`
straight through rather than flattening it into a generic failure.

Mounting is gated on `canDrive`, which now travels on `AgentIdentity`
(`getStaffIdentity` gained the column, ANDed with `active` so a deactivated
row never grants a capability). That is convenience, not enforcement:
`startShift` refuses on the server for anybody else.

### The pickup run — the placeholder is gone

`apps/agent/src/app/tasks/[taskId]/pickup-flow.tsx` replaces the dashed "Not in
the app yet" card at `page.tsx:192-230`. Four steps in the physical order:
**set off → check every seal → at the bag drop → the airline has them**, plus a
"Something's wrong" exception path with six reasons.

The same `DoorstepCard` renders above it as for the verification visit —
address, one-tap Navigate, one-tap Call, flight — because a driver arriving for
the pickup needs exactly what a driver arriving for the visit needed. The
component's prop type was widened to a structural `DoorstepContext` that both
`VisitContext` and `PickupContext` satisfy, rather than duplicating it.

**The expected seal id is deliberately NOT printed next to each bag.** A driver
who can read the answer off the screen is not checking the bag, they are
copying a number. The list shows "Bag 1 · checked" and nothing more.

**Steps render in sequence, but that is convenience.** Core refuses a scan
before the run started and refuses delivery with a bag never scanned — a server
action stays a reachable POST whatever the UI draws.

**Retries are safe by construction**, which is what makes the optimistic
sequencing honest: every underlying core function is idempotent, so a driver in
a basement car park who taps twice gets one custody event and no error.

### The queue tells the two halves apart

`groupJobs` gained `awaitingDriverChoice` on a pickup phase whose
`driver_shift_id` is null, and the job card renders the pickup phase with a
truck icon plus "waiting on the customer to choose a driver" instead of "to the
bag drop".

This matters because the on-paid auto-assign hands the pickup task to the SAME
person as the verification visit, so it appears in their queue before anybody
has picked a driver. That is correct — one person does both in v1, and somebody
has to be responsible if nobody is chosen — but it must not read as settled.

### GPS

`GpsPinger` posts `navigator.geolocation` to `POST /api/driver-position` every
45 seconds, and only while a pickup on the shift is `in_progress` — between
"set off" and "the airline has them".

A **route handler**, not a server action: the caller is a plain `fetch` on an
interval, and a server action would revalidate the page on every ping,
re-rendering a driver's screen forty times an hour for a value that screen does
not show. The session is resolved per request like every other agent endpoint,
and `recordDriverPosition` refuses a driver not on shift — so a tab left open
after clock-off stops writing (409, not 500: nothing is broken, the ping is
simply no longer wanted).

**Permission denied is not an error.** A non-blocking banner says the customer
will not see them coming, the pings stop, and every other part of the pickup
works. Nothing here can block a driver at a door.

**Foreground only, deliberately.** No service worker, no background sync, no
`watchPosition`. A phone in a pocket with the screen off stops reporting, and
the customer's page degrades to "ETA on the way" — honest — rather than showing
a stale position as current. Background tracking is a battery, permission and
privacy conversation of its own.

### Testing: integration + a documented manual pass

**No Playwright harness exists in this repo** — `mcp__playwright__*` tools are
available to the session, but there is no committed spec directory, config, or
CI job, and standing one up is a slice of its own. So, as RUN-REPORT-6 did:
integration tests for the behaviour and a browser pass for the rendering. The
browser pass is recorded in the close-out below.

New unit tests: `apps/agent/src/lib/job.test.ts` (6) — the two task rows
collapsing into one job, the `awaitingDriverChoice` flag appearing and then
disappearing once a shift owns the pickup, and the four job states.

### Phase 5 gate

| Gate | Result |
|---|---|
| `turbo typecheck` | **6/6 pass** |
| `turbo lint` | **6/6 pass** (two real findings fixed: a dead `let` and a synchronous `setState` inside an effect in the pinger) |
| `turbo test` (unit) | **606 pass** |
| `turbo build` (prod) | **3/3 pass** |

---

## Phase 6 — Admin console

### `/trucks` — Configuration, next to `/zones` and `/staff`

Name, bag capacity, reserved spaces, active toggle. `reserved_spaces` is
editable and the form says **"Not yet enforced"** on the field itself, because
a column quietly doing nothing is only safe if the screen that edits it admits
as much.

**Deactivating a truck that is out is refused, with the driver named.** Core's
reason, verbatim: "Van A is out with Nina Petrov. End that shift before taking
it out of service." Not a nicety — every read in `driver-selection.ts` filters
on `trucks.active`, so deactivating a truck under a driver would make them
vanish from every customer's shortlist while still holding bags.

**Capacity CAN be reduced below what is on board**, deliberately: the number is
being corrected, and refusing the correction would not unload the van.
Selection simply offers no more space from the new figure.

### `/shifts` — Operations, next to Bookings

Open shifts first (person, truck, `n of N` bag spaces, start time, force-end),
then recently finished ones — the question after "who is out" is "who just
finished", and a driver who clocked off ten minutes ago is still the person to
call about the run they just did.

A side panel grants and revokes **can-drive** per active agent, labelled with
the reasoning ("driving is a capability, not a role") and the honest caveat
that revoking takes effect on their next request and does not end a shift
already under way.

**Force-end is two-step**: the button opens a reason box rather than acting.
The reason is written into the custody trail of every booking it touches, and
the form says how many bags will go back in the pool before the operator
commits.

### Board and booking detail

- **New Driver column** (not sortable, deliberately: a driver is chosen minutes
  before the run, so ordering a whole board by it sorts mostly-empty against
  mostly-empty). Shows driver + truck, or "none yet" when the row is flagged.
- **The at-risk badge now says WHICH**: "needs an agent" or "needs a driver".
  It was one word for one meaning; a sealed booking with nobody coming for it
  was not flagged at all.
- **Overview** gained a fourth stat card, "sealed today, no driver on it",
  linking to `/shifts`, and the rail gained an `awaitingDriverToday` badge on
  the new Shifts item. `ConsoleBadgeKey`, `ConsoleBadgeCounts`, `OpsDashboard`
  and the layout were all edited together, as the preflight said they would
  have to be (§5.3).
- **Booking detail** gained a "Pickup run" card: who has it, in what, whether
  they have set off — and a reassign picker listing only OPEN shifts, each
  labelled with whether it would need the override.

### Reassignment reuses selection, on purpose

`adminReassignPickup` runs the **same transaction, the same single advisory
lock and the same capacity recount** as `selectDriver`. They are the same
operation with a different actor; letting them drift into two concurrency
stories is how a van ends up overloaded. What differs is written down:

- no customer-ownership check;
- the started-travel guard is RELAXED — a customer may not re-choose once a
  driver has set off, but ops may, because "the van broke down halfway" is
  exactly when a reassignment is needed. A booking already delivered is still
  refused: the bags are the airline's;
- zone and capacity can be waived with `override`, and each waiver is named on
  the custody event;
- a reassignment clears `started_at`, because the NEW driver has not set off
  and leaving it would make the customer's page claim somebody is on the way
  who is not.

### One real finding, caught by writing the test

An `override` waiver was **invisible on the console line**. `custody-copy.ts`
skips object-valued metadata (it belongs in the Raw data disclosure), and
`overrode` is an array — so the single fact explaining why a van left over
capacity or out of zone would only have shown to someone who expanded the JSON.
`pickup.reassigned` now has its own case rendering `OVERRIDE: zone and
capacity`, with three tests around it.

### And one flake, caught by running the suite again

`pickup.integration.test.ts`'s lifecycle test asserted a SEQUENCE of nine
custody events from a query with no `ORDER BY`. It passed by luck until the
heap reshuffled. Every event in that flow is written in its own transaction, so
`created_at` is a real ordering; the query now says so, and the test was re-run
three times to confirm.

### Phase 6 gate

| Gate | Result |
|---|---|
| `turbo typecheck` | **6/6 pass** |
| `turbo lint` | **6/6 pass** |
| `turbo test` (unit) | **614 pass** (admin 19 → 27) |
| `pnpm test:integration` | **180 passed, 3 skipped** |
| `turbo build` (prod) | **3/3 pass** |

---

## Phase 7 — Docs, the browser pass, and close-out

### Docs written

| Doc | What changed |
|---|---|
| [docs/features/driver-and-pickup-hosted-setup.md](../features/driver-and-pickup-hosted-setup.md) | **New.** TD's manual steps: what CI applies, the 0029 drop and its fail-closed guard, seeding, adding the real fleet, granting `can_drive`, zone rows, the three new Inngest functions, and the HTTPS requirement for geolocation. Ends with an explicit "what is deliberately NOT in this slice" list. |
| `docs/features/README.md` | Indexed the new doc. |
| `PROJECT-STATUS.md` | Snapshot entry; tracker rows **74–79**; **eight new §7 standing constraints** (below). |
| `docs/CODEBASE-MAP.md` | Schema table (three tables gone, four arrived), the dropped-tables note, `zip-centroids.ts`, four new data-model invariants, the `EtaEstimator` seam row + paragraph, the three new services, the pickup run and shifts in the agent chapter, GPS, the trip page's driver section, the admin console's two new routes, `atRiskReason`, and the jobs table (8 → 11). |
| `docs/MIGRATIONS.md` | History table brought up to date (0018–0029), plus two callouts: 0029 can fail by design and that is the safe outcome; 0028's backfill NOTICE and why a gap is not a failure. |

### New §7 standing constraints

Driving is a capability not a third role · `driver_positions` is not chain of
custody · a pickup task's two assignment columns must never disagree ·
selection takes exactly ONE advisory lock and that is why there is no lock-order
rule · agents are shift-blind by design · `agent_zones` is shared with the
discriminator at read time · the ETA seam returns a range and its bias is
deliberate · bookings do not store a scope, so take the strictest cutoff.

### Custody event names added

All in `packages/core/src/services/pickup-events.ts`, which exists so the three
writers and the two consoles share one spelling — `custody_events.event_type` is
free text, and a typo in an event name fails silently forever.

```
pickup.driver_selected     pickup.seal_scanned        pickup.shift_force_ended
pickup.driver_released     pickup.seal_mismatch       pickup.reassigned
pickup.travel_started      pickup.handover_confirmed
```

The four booking lifecycle events they sit beside — `booking.awaiting_pickup`,
`booking.in_transit`, `booking.delivered_to_bagdrop`, `booking.completed` —
already existed and now have production emitters for the first time. They are
written by `applyTransition` and must never be emitted by hand.

Domain events added: `booking/driver_selected`, `booking/delivered_to_bagdrop`,
`booking/driver_pool_empty`.

---

## The browser pass

**No Playwright harness exists in this repo** — no committed spec directory, no
config, no CI job. Standing one up is a slice of its own, so this went the way
RUN-REPORT-6 did: integration tests for behaviour, a driven browser for
rendering.

The Playwright MCP profile was locked by another session, so the pass ran
against the **bundled Chromium over raw CDP** — a separate profile, no lock
contention, console errors and exceptions subscribed so the run reports more
than pixels.

### What was exercised, not just loaded

| Surface | Result |
|---|---|
| Agent Today, off shift | Shift bar with the truck picker; job card reads "Collect & deliver — waiting on the customer to choose a driver" |
| **Start shift** (real submit) | Shift opened; bar switched to "DEV Truck A — 30 bags · On shift · 0 of 30 spaces used · started 5:39 PM EDT" |
| GPS banner | Headless Chromium denies geolocation → the permission-denied banner rendered, nothing blocked |
| Admin `/` | Fourth stat card, "sealed today, no driver on it" |
| Admin `/trucks` | "2 in service · 1 out right now · 42 bags of capacity"; the out-with-a-driver badge; "Not yet enforced" on reserved spaces |
| Admin `/shifts` | Open shift with bag load and force-end; the can-drive panel with per-person grant/revoke |
| Admin `/bookings` | Driver column, "needs a driver" badge, "none yet". `scrollWidth === clientWidth` — the 10th column did not overflow the 1512px frame (the memory's earlier 9-column overflow lesson) |
| Admin booking detail | Pickup-run card; custody trail rendering every new event in ops voice, including "ETA 20–45 min at the time of choosing" |
| Customer `/trips/<sealed>` | **"Choose your driver"** with the widening copy, avatar, truck, ETA badge, out-of-zone badge, capacity line, CTA |
| Customer `/trips/<completed>` | Driver card + the five-step progress track with the last step current |

Console: **zero errors or exceptions** across every page. The only warning is
Next.js's pre-existing `scroll-behavior: smooth` notice.

The end-to-end custody trail on `KOO-NZSKR` is the strongest evidence in the
report — nine events, in order, written by the real UI:

```
booking.verified_sealed → pickup.driver_selected (customer) → booking.awaiting_pickup
→ pickup.travel_started → pickup.seal_scanned ×3 → booking.in_transit
→ booking.delivered_to_bagdrop → booking.completed → pickup.handover_confirmed
```

### Three things the browser pass found

1. **A stale dev server, not a defect.** The running `pnpm dev` had been up
   since before migration 0029 and held a drizzle relational-schema snapshot
   without `can_drive`, so `db.query.staffMembers.findFirst` returned the row
   with the column missing → `startShift` refused a driver who was cleared. A
   fresh `tsx` process returned `canDrive: true` from the same query, which is
   what settled it. **The dev servers were restarted on their original ports.**
   Worth knowing: a schema change wants a dev-server restart, because the
   relational query API caches its column list.
2. **Five custody events rendered as raw tokens on the CUSTOMER's timeline** —
   `booking.payment_captured`, `booking.payment_refunded`,
   `booking.payment_auth_cancelled`, `booking.payment_unwind_failed`,
   `booking.agent_reassigned`. Nothing to do with drivers; they had simply
   never been labelled, and sat next to labelled ones on a page a customer
   reads. Fixed, with a comment saying where they were found.
3. **"pickup task done, on the way"** on the admin booking detail —
   `travelStartedAt` stays set after a run finishes, so it only means "on the
   way" while the task is still open. Now reads "run complete" / "run failed,
   handed to ops" / "on the way" / "not set off yet".

### A note on shared local state

Another session was driving the same local stack during this run (which is why
the Playwright profile was locked). Some of the dev-database rows this report
quotes were advanced by that session's clicks rather than mine. That does not
weaken the evidence — the custody trail records what the real UI did, whoever
clicked it — but it is the RUN-REPORT-6 §0 lesson in a new form: **a shared
checkout makes file state ambiguous, and a shared local database makes ROW
state ambiguous too.**

One shift was left open (Nina Petrov, DEV Truck A, 0 bags on board) so as not
to disturb the other session mid-run.

---

## Close-out

### Final gate

| Gate | Result |
|---|---|
| `turbo typecheck` | **6/6 pass** |
| `turbo lint` | **6/6 pass** |
| `turbo test` (unit) | **614 passed, 1 skipped** — core 404, web 86, ui 85, admin 27, agent 12 |
| `pnpm test:integration` (core, `koolee_test`) | **180 passed, 3 skipped, 20 files** |
| `turbo build` (prod) | **3/3 pass** |
| `pnpm db:status` (local) | **30 of 30, matched by content hash — in sync** |
| `scripts/test-env.sh verify` | **8/8 pass** — 27 tables and 228 columns, both databases |
| Browser pass | 10 surfaces, **0 console errors** |

Test counts at the start of the slice: 394 unit + 135 integration.
**+220 unit, +45 integration.**

### Deferred, with the reason

| Deferred | Why |
|---|---|
| Real geocoding / a routing provider | Out of scope by the prompt. `EtaEstimator` is the seam; `ensureAddress` already accepts precise coordinates, so the day it lands the centroid becomes the fallback with no call-site change. |
| The ETA's long-run pessimism | Named, tested and kept — it points the safe way for both consumers. A routing provider is the fix, not a constant tweak. TD's call. |
| A map on the trip page | Deliberate: a tile host inside a page rendering a private address, plus a library, for a question distance + ETA already answers. One component swap when wanted. |
| `reserved_spaces` enforcement | Column created, nothing reads it, and both `ops.ts` and the admin form say so. Wiring it is one subtraction in `listCandidateDrivers` plus a test. |
| Agent shift tracking | Decided against, with the reasoning at the auto-assign call site. Not a gap. |
| Position history | `driver_positions` is one mutable row per driver by design. History would be a different table with a different retention story. |
| Route optimisation, customer-facing driver profiles, SMS | Out of scope by the prompt; nothing was half-built toward them. |
| Background GPS | Foreground pings only. Background tracking is a battery, permission and privacy conversation of its own. |
| A Playwright harness | None exists; standing one up is its own slice. The CDP driver used here is throwaway scaffolding in the scratchpad, not committed. |
| `cutoffRiskMonitor` measuring from the DRIVER's position | It measures from the pickup address. `driver_positions` is right there and it is the obvious next step; left out so the function keeps working for a booking whose driver has GPS off. Noted in the function. |
| `agentNoShowCheck`'s pickup twin | Untouched. A driver no-show is the same problem with a tighter deadline (the airline cutoff) and wants the same unwritten reassignment machinery (preflight §7.18). |

### What TD does next

1. **Review the diff.** Nothing is committed — this session made no commits, by
   instruction.
2. **Push and open the PR** into `dev`. CI applies 0028 and 0029 to hosted dev
   on merge. **Read the 0029 note first** — it drops three tables and will abort
   loudly rather than quietly if any of them has grown a row.
3. **Then the manual steps**, in
   [driver-and-pickup-hosted-setup.md](../features/driver-and-pickup-hosted-setup.md):
   seed, add the real fleet at `/trucks`, take the two DEV trucks out of
   service, grant `can_drive` at `/shifts`, check zone coverage, and confirm
   Inngest Cloud picked up the three new functions.
4. **No new environment variables**, in any app or in core.
