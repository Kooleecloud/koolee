# Tier 4 pre-flight — driver / pickup groundwork

**Run date:** 2026-08-29
**Read at:** branch `docs/reconcile-storage-avatars` @ `5deaf41`, clean working tree
(`git status --porcelain` → 0 lines). No commits, no migrations, no code changes.
**Databases touched:** LOCAL ONLY — `postgresql://…@127.0.0.1:54322/postgres`. Hosted was
never contacted. Two commands ran: `pnpm db:status` (documented read-only, §6.1) and one
throwaway SELECT-only probe script (`packages/db/probe-readonly.tmp.ts`, created, run,
deleted — see §6.6 for the queries). Nothing else executed SQL.

Every claim below names a `file:line` or the query that produced it. Where something does
not exist, it says **does not exist** rather than inferring.

---

## Headline for the design conversation

Five facts change how Tier 4 should be shaped. Details and evidence follow in the sections.

| #   | Fact                                                                                                                                                                                                                                                       | Where            |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | `drivers` and `routes` are **complete dead scaffolding** — tables exist, zero rows, **zero read or write call sites** anywhere outside `schema/` and `relations.ts`. So is the `agents` table.                                                             | §1.1, §1.2, §1.5 |
| 2   | `pickup_tasks` rows **are** created (by the on-paid auto-assign, same assignee as verification) but **nothing ever advances one**. All 14 local rows are `assigned`, 0 started, 0 completed.                                                               | §1.3             |
| 3   | The booking lifecycle **stops dead at `verified_sealed`**. `mark_awaiting_pickup`, `start_transit`, `deliver_to_bagdrop` and `complete` have **no production caller** — tests only. The only way past `verified_sealed` today is an admin manual override. | §4.3             |
| 4   | **No coordinates exist anywhere.** `addresses.lat/lng` are 0/8 populated, the funnel never writes them, and `airports` has **no lat/lng column at all**. A haversine ETA has neither endpoint.                                                             | §3               |
| 5   | There is **no `FOR UPDATE` in the codebase**. The house concurrency style is (a) unique index + catch `23505`, (b) compare-and-swap `WHERE status = <from>`, (c) `pg_advisory_xact_lock`.                                                                  | §6.3             |

---

## 1. Existing driver / pickup scaffolding

### 1.1 `drivers` — table exists, code does not use it

Schema: `packages/db/src/schema/identity.ts:97-118`.

| Column                  | Type             | Null | Notes                                                      |
| ----------------------- | ---------------- | ---- | ---------------------------------------------------------- |
| `id`                    | uuid             | NO   | PK (`primaryId()`)                                         |
| `user_id`               | uuid             | NO   | FK → `users.id` **ON DELETE RESTRICT**                     |
| `active`                | boolean          | NO   | default `true`                                             |
| `phone`                 | varchar(20)      | YES  |                                                            |
| `vehicle_make`          | text             | YES  |                                                            |
| `vehicle_model`         | text             | YES  |                                                            |
| `vehicle_color`         | text             | YES  |                                                            |
| `vehicle_plate`         | varchar(16)      | YES  |                                                            |
| `vehicle_capacity_bags` | double precision | YES  | comment: "How many bags this vehicle can carry in one run" |
| `created_at`            | timestamptz      | NO   |                                                            |

Verified against the live local DB (`information_schema.columns`) — matches the Drizzle
definition exactly.

Indexes (live): `drivers_pkey` (id), `drivers_user_id_key` UNIQUE (user_id),
`drivers_active_idx` (active). Created in `packages/db/drizzle/0000_init.sql:35-39`.

**FKs pointing at `drivers`** — exactly one, confirmed by
`information_schema.referential_constraints`:

| Referencing table | Column      | Constraint                       | Delete rule |
| ----------------- | ----------- | -------------------------------- | ----------- |
| `routes`          | `driver_id` | `routes_driver_id_drivers_id_fk` | RESTRICT    |

**Read/write call sites: none.** Repo-wide grep over `apps/` + `packages/` (excluding
`node_modules`, `.next`, `drizzle/meta`) finds `drivers` only in:

- `packages/db/src/schema/identity.ts:97,98,115,116,126,127` — the definition + types
- `packages/db/src/schema/relations.ts:10,27,52,53,190` — relation wiring
- `packages/db/src/schema/ops.ts:6,15` — the `routes.driverId` FK

No `select`, `insert`, `update` or `delete` against `drivers` exists in `packages/core`,
`apps/web`, `apps/admin`, `apps/agent`, or either seed. The `Driver` type is re-exported at
`packages/core/src/index.ts:38` and consumed by nothing.

**Live row count: 0** (probe: `select count(*) from drivers`).

### 1.2 `routes` — same story

Schema: `packages/db/src/schema/ops.ts:9-31`. Columns (live-verified): `id`, `driver_id`
(FK → drivers, RESTRICT), `date` (`date`, not timestamptz — "a route belongs to a day, not
an instant", `ops.ts:16`), `airport_code` (FK → airports, RESTRICT), `status`
(`route_status` enum: `planned | active | completed | cancelled`,
`packages/db/src/schema/enums.ts:59-65`), `created_at`, `updated_at`.

Indexes (live): `routes_pkey`, `routes_driver_date_idx` (driver_id, date),
`routes_date_airport_idx` (date, airport_code), `routes_status_idx` (status).

**No call sites** outside `schema/ops.ts` and `schema/relations.ts:11,54,61,189-195`.
**Live row count: 0.** There is **no `route_stops` / route-leg table** — a route today
cannot be associated with a booking at all.

### 1.3 `pickup_tasks` — created, never advanced

Schema: `packages/db/src/schema/tasks.ts:50-75`. Structurally identical to
`verification_tasks` (`tasks.ts:19-47`): `id`, `booking_id` (FK → bookings, **CASCADE**),
`assignee_user_id` (FK → **`users.id`**, SET NULL — _not_ `staff_members`, not `drivers`),
`status` (`task_status`: `pending | assigned | in_progress | done | failed`,
`enums.ts:32-39`), `scheduled_start`, `scheduled_end`, `started_at`, `completed_at`,
`notes`, `created_at`, `updated_at`.

Indexes (live): `pickup_tasks_booking_id_key` **UNIQUE (booking_id)**,
`pickup_tasks_assignee_status_idx` (assignee_user_id, status),
`pickup_tasks_scheduled_start_idx`. The unique index arrived in
`packages/db/drizzle/0019_jazzy_overlord.sql:37-49`, which first de-duplicates then swaps
the plain index for a unique one. The comment at `tasks.ts:69-71` is explicit that this
index is the referee for the on-paid race.

**Who INSERTs it — exactly one place:** `packages/core/src/services/dispatch.ts:174-180`,
inside `assignAgentToBooking`'s transaction:

```ts
await tx.insert(pickupTasks).values({
  bookingId: booking.id,
  assigneeUserId: input.agentUserId, // the SAME user as the verification task
  status: "assigned",
  scheduledStart, // booking.pickupWindowStart ?? null
  scheduledEnd, // booking.pickupWindowEnd   ?? null
});
```

`scheduledStart/End` come straight off the booking's pickup window
(`dispatch.ts:132-133`). **Yes — the on-paid auto-assign creates it:**
`autoAssignBooking` → `assignAgentToBooking` (`auto-assign.ts:246-249`), and
`autoAssignOnPaid` (`auto-assign.ts:283-297`) is the hook every path to `paid` calls. So a
pickup task is born with the verification task, assigned to the same agent, in one
transaction.

**Who UPDATEs it — exactly one place:** `dispatch.ts:166-172`, reassignment only
(`assigneeUserId` + `status: "assigned"`, skipped when already `done`).

**Nothing ever sets `status: "in_progress"`, `status: "done"`, `started_at`, or
`completed_at` on a pickup task.** Confirmed by grep (`update(pickupTasks)` has one hit)
and by the data:

```
pickup_tasks by status:      assigned  n=14  assigned=14  scheduled=13  started=0  completed=0
verification_tasks by status: assigned n=7 · in_progress n=3 · done n=4 (completed=4)
```

Note `completeVerificationVisit` (`packages/core/src/services/agent-visit.ts:495-536`)
closes the **verification** task (`agent-visit.ts:530-533`) and moves the booking to
`verified_sealed` — and deliberately leaves the pickup task untouched.

**Who READs it:**

| Reader                       | Location                                            | What for                                                |
| ---------------------------- | --------------------------------------------------- | ------------------------------------------------------- |
| `getAssignedTask`            | `packages/core/src/services/tasks.ts:41-47`         | agent app task detail, assignee-scoped                  |
| `listAssignedTasks`          | `tasks.ts:152-159`                                  | agent app queue (joined to booking + airport + address) |
| `agentHasTaskForBooking`     | `packages/core/src/services/bookings.ts:117-124`    | the agent authorization lookup                          |
| `listAgentBookingIds`        | `bookings.ts:153,157`                               | list scoping                                            |
| `loadFor` (auto-assign load) | `packages/core/src/services/auto-assign.ts:119,121` | counts pickup tasks as agent load                       |
| `listAgentWorkload`          | `dispatch.ts:600,616`                               | admin workload strip                                    |

**UI that renders pickup tasks:**

- **Agent — list:** yes. `apps/agent/src/lib/job.ts:59-117` groups the two task rows into
  one "job" card per booking; the pickup half renders as a phase labelled
  **"Collect & deliver" / "to the bag drop"** (`job.ts:28-36`). Card at
  `apps/agent/src/components/job/job-card.tsx`; it links to
  `/tasks/<taskId>?kind=pickup` (`job-card.tsx:99`).
- **Agent — detail:** **a deliberate placeholder.**
  `apps/agent/src/app/tasks/[taskId]/page.tsx:192-230` branches on `kind === "pickup"`,
  verifies assignment, and renders a dashed card headed **"Not in the app yet"** telling
  the driver to do it manually and message ops. `kind` comes from a _query string_
  (`page.tsx:175-176`), defaulting to `verification` — there is no separate route.
- **Admin:** **no**. The board query left-joins `verification_tasks` only
  (`dispatch.ts:542`), so `assigneeUserId` / `taskStatus` on every board row are the
  _verification_ task's. `getBookingAssignment` (`dispatch.ts:228-243`) likewise reads
  `verification_tasks` only. The only admin mentions of pickup tasks are prose:
  `apps/admin/src/app/page.tsx:260` ("Open verification and pickup tasks per active
  agent" — the combined `listAgentWorkload` count) and
  `apps/admin/src/app/bookings/[bookingId]/page.tsx:508` ("One agent covers the
  verification visit and the pickup run in v1").
- **Customer:** **no**. `BookingDetail.assignedAgent`
  (`packages/core/src/services/bookings.ts:194-215`) carries one agent with one
  `taskStatus`; the trip page renders it under the heading "Agent"
  (`apps/web/src/app/trips/[bookingId]/page.tsx:241-267`).

### 1.4 `agents` — a third dead table

`packages/db/src/schema/identity.ts:79-94`. `id`, `user_id` (UNIQUE, FK → users RESTRICT),
`active`, `phone`, `created_at`. **Live row count: 0.** Referenced only by
`relations.ts:10,26,48-50` and the `Agent` type export at `packages/core/src/index.ts:26`.

Every "agent" in running code is a `users` row + an active `staff_members` row; nothing
resolves an _agent id_. `AgentSession.agentId` / `AgentSession.driverId`
(`packages/core/src/auth/types.ts:31,33`) are **never populated** — the only construction
site is `apps/agent/src/lib/session.ts:69`, which builds
`{ kind: "agent", role: "agent", userId }` and nothing else.

### 1.5 Other truck / vehicle / shift remnants

- **`truck`** — **does not exist.** Zero case-insensitive matches across `apps/`,
  `packages/`, `docs/`.
- **`vehicle`** — only the five `drivers.vehicle_*` columns (§1.1), marketing copy
  (`apps/web/src/app/(marketing)/how-it-works/page.tsx:79`,
  `about/page.tsx:172`, `privacy/page.tsx:16`, `lib/faq.tsx:98`), one test fixture string
  (`state-machine.test.ts:309`), and the ETA TODO at
  `packages/core/src/jobs/functions.ts:377`.
- **`shift`** — **no shift entity anywhere.** Every hit is prose or an unrelated
  identifier. The closest thing to an acknowledgement is `packages/db/src/schema/zones.ts:14`:
  _"If territories ever get names and shifts of their own, that is the migration to write
  then."_
- **Seeds:** `packages/db/src/seed.ts` writes `airports`, `airline_cutoffs`,
  `pricing_rules`, `agreement_versions`, `users`, `staff_members`, `agent_zones` — and
  **nothing else**. No drivers, no routes, no agents rows.
  `packages/db/src/seed-local.ts` is a 28-line wrapper that pins the local URL and
  delegates.

---

## 2. Staff identity + roles

### 2.1 `staff_members`

`packages/db/src/schema/staff.ts:25-46`:

| Column                     | Type             | Notes                                                                                                                     |
| -------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `id`                       | uuid PK          |                                                                                                                           |
| `user_id`                  | uuid NOT NULL    | FK → `users.id` CASCADE; **UNIQUE** (`staff_members_user_id_key`) — one row per user                                      |
| `role`                     | `user_role` enum | **CHECK `role in ('agent','admin')`** — `staff_members_role_check`, added in `packages/db/drizzle/0004_common_post.sql:9` |
| `active`                   | boolean NOT NULL | default true; deactivation, never deletion                                                                                |
| `invited_by_user_id`       | uuid             | FK → users, SET NULL                                                                                                      |
| `created_at`, `updated_at` | timestamptz      |                                                                                                                           |

Index: `staff_members_role_active_idx` (role, active).

The `user_role` enum **already contains `driver`** —
`enums.ts:7`: `["customer","agent","driver","admin"]`. The CHECK constraint is what
currently forbids a driver staff row, and the schema comment says so out loud
(`staff.ts:23-24`): _"`driver` joins the enum's allowed set only when the dispatch model
ships."_

**Live data:** 11 rows — 7 `agent`/active, 1 `agent`/inactive, 3 `admin`/active.
`users` by role: 4 customer, 8 agent, 3 admin. **Zero users carry `role = 'driver'`.**

### 2.2 How a staff user maps to an "agent"

It doesn't map to the `agents` table — that table is dead (§1.4). The chain is:

```
supabase auth user.id  ==  public.users.id  ==  staff_members.user_id
                                            ==  agent_zones.agent_user_id
                                            ==  verification_tasks.assignee_user_id
                                            ==  pickup_tasks.assignee_user_id
```

Role/capability is expressed **only** as `staff_members.role` + `staff_members.active`.
There are no capability columns, no skills table, and no per-airport assignment. Zones
(§2.4) express _territory_, not capability.

Two code-level gates encode the `agent | admin` universe and would both need editing for a
`driver` role:

- `packages/core/src/services/staff.ts:34` — `STAFF_ROLES = ["agent","admin"] as const`,
  and `getActiveStaffRole` (`staff.ts:42-51`) returns `null` for anything else, so a
  `driver` row would fail authorization even with the CHECK relaxed.
- `packages/core/src/auth/require-role.ts:11-15` — `assertRole` is a pure allowlist check;
  it needs no change.

Worth knowing: the storage policy helper `public.is_active_staff(uid)`
(`packages/db/drizzle/0009_staff_check_function.sql:8-19`) checks **`active` only, not
role** — so bag-photo and passport-photo bucket policies would admit a driver-role staff
account with no migration.

### 2.3 Agent app auth — session mechanism and the ownership clause

**Session mechanism** (`apps/agent/src/lib/session.ts`):

1. Supabase email/password session read server-side via `getSupabaseServerClient()` →
   `supabase.auth.getUser()` (`session.ts:51-57`).
2. `requireStaffRole(core.db, user.id, ["agent"])` (`session.ts:62`) — a **per-request**
   `staff_members` lookup; this is the security boundary, and it is what makes
   deactivation immediate (`session.ts:14-24`).
3. Wrapped in React `cache()` (`session.ts:50`) so it runs once per request.
4. `AgentSession` is built at `session.ts:69` as `{ kind: "agent", role: "agent", userId }`.

**The logged-in agent is resolved to a `users.id`, never to an agent id.** There is no
agent-entity resolution step to extend.

**The exact ownership WHERE-clause pattern** — `getAssignedTask`,
`packages/core/src/services/tasks.ts:28-48`:

```ts
// tasks.ts:32-40 (verification)
const task = await db.query.verificationTasks.findFirst({
  where: and(
    eq(verificationTasks.id, input.taskId),
    eq(verificationTasks.assigneeUserId, input.assigneeUserId),
  ),
});
// tasks.ts:41-47 (pickup) — identical shape against pickupTasks
```

The assignee is **in the WHERE clause, not checked after the fact** — an unassigned task id
simply does not resolve (`tasks.ts:16-19`). The same pattern is repeated verbatim at:

- `packages/core/src/services/agent-visit.ts:170-176` (`getVisitContext`) — every visit
  mutation re-derives context through it
- `packages/core/src/services/bookings.ts:109-125` (`agentHasTaskForBooking`) — the
  database half of `sessionCanActOnBooking` (`bookings.ts:133-142`), which
  `canActOnBooking` (`auth/types.ts:97-106`) returns `false` for agents by design

### 2.4 `agent_zones` — attached to the staff identity, not to an agent entity

`packages/db/src/schema/zones.ts:20-38`:

| Column          | Type                 | Notes                       |
| --------------- | -------------------- | --------------------------- |
| `id`            | uuid PK              |                             |
| `agent_user_id` | uuid NOT NULL        | **FK → `users.id` CASCADE** |
| `zip`           | varchar(10) NOT NULL | five-digit US ZIP           |
| `created_at`    | timestamptz          |                             |

Indexes: `agent_zones_agent_zip_key` UNIQUE (agent_user_id, zip),
`agent_zones_zip_idx` (zip). Live rows: **198**.

**Zones attach to the user id** — flat `user × ZIP` rows, not to `agents` and not to a named
zone entity. The schema comment (`zones.ts:8-19`) says the flat shape is deliberate at NYC
scale and names the migration to write if territories ever gain names and shifts.

Consequence for Tier 4: driver zones can **share this exact table with no schema change** —
the FK is to `users`, and the only thing making a row "an agent's" is the column _name_ plus
the `staffMembers.role = 'agent'` join in the consumer. That join is at
`packages/core/src/services/auto-assign.ts:190-201`:

```ts
.innerJoin(staffMembers, eq(staffMembers.userId, agentZones.agentUserId))
.where(and(
  eq(agentZones.zip, pickup.zip),
  eq(staffMembers.role, "agent"),
  eq(staffMembers.active, true),
))
```

`addAgentZones` also hard-guards `role !== "agent"` (`auto-assign.ts:366-369`). So sharing
the table means either (a) relaxing that guard and filtering by role at read time, or (b) a
`role` discriminator column on the zone row. Both are cheap; the choice is design, not
constraint.

---

## 3. Geocoding reality check — **there are no coordinates**

### 3.1 The address table has the columns

`packages/db/src/schema/identity.ts:52-76`:

| Column       | Type                 | Null                     |
| ------------ | -------------------- | ------------------------ |
| `id`         | uuid PK              | NO                       |
| `user_id`    | uuid                 | NO (FK → users, CASCADE) |
| `label`      | text                 | YES                      |
| `line1`      | text                 | NO                       |
| `line2`      | text                 | YES                      |
| `city`       | text                 | NO                       |
| `state`      | varchar(2)           | NO                       |
| `zip`        | varchar(10)          | NO                       |
| **`lat`**    | **double precision** | **YES**                  |
| **`lng`**    | **double precision** | **YES**                  |
| `place_id`   | text                 | YES (Google Places)      |
| `created_at` | timestamptz          | NO                       |

Indexes: `addresses_user_id_idx`, `addresses_zip_idx`. Present since
`packages/db/drizzle/0000_init.sql:16-18`.

### 3.2 Nothing populates them

Live probe:

```sql
select count(*) total, count(lat) with_lat, count(lng) with_lng, count(place_id) with_place_id
from addresses;
-- total: 8   with_lat: 0   with_lng: 0   with_place_id: 0
```

**Every address row in the local database has NULL lat, NULL lng, and NULL place_id.**

**Why, structurally:** there is exactly one address-insert path.
`grep 'insert(addresses)'` returns **zero** matches outside
`packages/core/src/services/customers.ts:288-301` (`ensureAddress`). It accepts
`lat`/`lng`/`placeId` (`customers.ts:254-256`) and defaults each to `null`
(`customers.ts:297-299`). Its callers:

| Caller                                                                            | Passes coords?                                  | Evidence                         |
| --------------------------------------------------------------------------------- | ----------------------------------------------- | -------------------------------- |
| **Booking funnel** (`apps/web/src/lib/checkout.ts:100-106`)                       | **No** — `line1, line2?, city, state, zip` only | the object literal has five keys |
| Dashboard "add address" (`apps/web/src/app/dashboard/addresses/actions.ts:80-87`) | **No**                                          | same five + `label`              |
| Dashboard "edit address" (`actions.ts:119-126`)                                   | **No**                                          | same                             |
| 11 integration tests                                                              | No                                              | —                                |

The funnel's address step is `apps/web/src/components/pickup-step-form.tsx`, plain text
inputs, with the gap written down at `pickup-step-form.tsx:147-148`:

> `{/* TODO(maps): Google Places autocomplete, which also gives us the lat/lng and place_id the drive-time estimate needs. */}`

The server-side draft carries no coordinates either — the funnel draft schema
(`apps/web/src/lib/booking-draft-schema.ts:110-114`) has `line1, line2, city, state, zip`
and no lat/lng/placeId field. The draft row itself is an opaque `jsonb` payload
(`packages/db/src/schema/drafts.ts:28-31`).

### 3.3 The airport end has no coordinates either

`packages/db/src/schema/airports.ts:23-40` — the whole table is
`code` (PK, varchar(3)), `name` (text), `tz` (text), `created_at`.
**No lat/lng column exists on `airports`.** There is also no bag-drop location entity of
any kind.

### 3.4 What _does_ exist to work with today

- Raw address strings: `line1`, `line2`, `city`, `state`, `zip`.
- ZIP as the only structured geo key — it is what auto-assign matches on
  (`auto-assign.ts:180-201`) and what the coverage allowlist is written in
  (`packages/db/src/coverage-zips.ts`, consumed via `@koolee/db/coverage-zips`).
- `place_id`, when it ever gets populated: already threaded to both the agent job card
  (`apps/agent/src/lib/job.ts:140-146`) and the visit page
  (`apps/agent/src/app/tasks/[taskId]/page.tsx:82-86`) to build a Google Maps deep link.
  Both handle NULL by falling back to a free-text query.
- **Distance is a hardcoded constant.** The pricing engine takes `distanceKm`
  (`packages/core/src/pricing/engine.ts:97`) and every real caller passes **20**:
  `apps/web/src/lib/checkout.ts:123`, `apps/web/src/app/book/actions.ts:387`,
  `apps/web/src/app/book/pay/page.tsx:66`, `apps/web/src/app/book/slot/page.tsx:78`.
  (The marketing calculator uses a per-airport table, `pricing/actions.ts:66`.)
  `packages/core/src/services/quote.ts:24` says it plainly: _"Door-to-bag-drop distance.
  Maps is stubbed, so callers estimate."_
- **Drive time is a hardcoded constant.** `DEFAULTS.driveTimeMinutes = 60`
  (`packages/core/src/config.ts:59`), used by the cutoff-risk monitor at
  `packages/core/src/jobs/functions.ts:432-436` behind
  `// TODO(maps): replace with a live driver ETA from the route.`
- **GPS is captured at the door, per event.** `custody_events.lat/lng`
  (`packages/db/src/schema/custody.ts:43-44`) are written best-effort from the browser
  (`apps/agent/src/app/tasks/[taskId]/visit-flow.tsx:88-110`, `actions.ts:51-56`). This is
  a point-in-time evidence stamp on an append-only table — **not** a position feed, and it
  is only ever written on visit events.

---

## 4. Seals + custody

### 4.1 Seal serials

Stored **per bag**, one column: `bags.seal_id` (`text`, nullable) —
`packages/db/src/schema/bookings.ts:204`. Deliberately opaque: the schema comment
(`bookings.ts:175-181`) says the technology (RFID vs printed QR) is undecided and
_"No code should parse or infer structure from this value."_

**Uniqueness — a PARTIAL unique index**, `bookings.ts:220`:

```sql
CREATE UNIQUE INDEX bags_seal_id_key ON public.bags USING btree (seal_id)
  WHERE (seal_id IS NOT NULL);
```

(live-verified via `pg_indexes`; added by `packages/db/drizzle/0017_unique_seal_id.sql`).
Partial because unsealed bags all hold NULL and must not collide. Scope is
**operation-wide**, not per booking. Also `bags_booking_ordinal_key` UNIQUE (booking_id,
ordinal).

Live: 42 bags, 7 sealed, 7 distinct seals.

### 4.2 Agent-side capture and validation

**Capture is a plain text input — there is no scanner.**
`apps/agent/src/app/tasks/[taskId]/visit-flow.tsx:557-571`:

```tsx
<Label htmlFor={`seal-${bag.id}`}>Seal id</Label>
<Input id={`seal-${bag.id}`} name="sealId" placeholder="type the printed id"
       autoComplete="off" required />
<p>Unique to this bag — never reuse a number.</p>
{/* TODO(agent-flow): QR/RFID scan via the camera — manual entry ships first;
    the seal id stays an opaque string. */}
```

Submitted through `sealBagAction` (`apps/agent/src/app/tasks/[taskId]/actions.ts`) →
`recordBagSealed` (`packages/core/src/services/agent-visit.ts:393-472`).

**How a scanned value is validated today** — `agent-visit.ts:404-442`, in order:

1. `assertIdentityGate(context)` (`:404`) — passport confirmed + agreement accepted, or the
   seal step is refused server-side regardless of what the UI renders (`:401-403`).
2. Bag belongs to this visit (`:406-407`).
3. Bag not already sealed → `ConflictError` naming the existing seal (`:408-413`).
4. `sealId.trim()` non-empty (`:414-415`). **That is the entire format validation** — no
   length, charset, checksum or prefix rule.
5. `weightKg > 0` (`:416-418`) and `photoPath` present (`:419-421`).
6. **Advisory duplicate read** (`:430-442`): `select … from bags where seal_id = $1 limit 1`,
   producing a different sentence for same-booking vs cross-booking reuse. The comment at
   `:423-429` is explicit that this read **races and that is fine** — the partial unique
   index is the real guarantee and the insert surfaces it.
7. Then one transaction (`:444-469`): update the bag, append `bag.sealed` with lat/lng,
   the photo path, and `metadata: { taskId, sealId, weightKg }`.

Photo capture pieces worth reusing: `BagPhotoField`
(`visit-flow.tsx:121-190`) — `<input type="file" accept="image/*" capture="environment">`
plus an inline preview and a form-reset listener; `downscalePhoto` from
`@koolee/ui/lib/photo` shrinks before the Server Action body (`visit-flow.tsx:321-334`,
`:501-515`) because an untouched phone photo 413s.

### 4.3 Custody event catalog

**Append mechanism.** `custody_events` is APPEND-ONLY, enforced twice
(`packages/db/src/schema/custody.ts:8-21`): a migration-0001 trigger that RAISEs on UPDATE
and DELETE, and a data-access layer that exposes only appends —
`appendCustodyEvent` / `appendCustodyEvents` in `packages/db/src/custody.ts:23-39`. There is
no update or delete helper. **In practice most writers call
`tx.insert(custodyEvents).values(...)` directly** inside their own transaction (18 such
sites); the helper is exported but the state machine path does not use it. Corrections are
compensating events, never edits.

**The full catalog currently emitted** (constants + literals, all verified in code):

| Event type                             | Emitted by                                                     |
| -------------------------------------- | -------------------------------------------------------------- |
| `booking.created`                      | `create-booking.ts:283`                                        |
| `booking.payment_authorized`           | `EVENT_TYPES.authorize_payment`, `state-machine.ts:166`        |
| `booking.payment_captured`             | `payment-lifecycle.ts:76`                                      |
| `booking.payment_refunded`             | `payment-lifecycle.ts:269`                                     |
| `booking.payment_auth_cancelled`       | `payment-lifecycle.ts:294`                                     |
| `booking.payment_unwind_failed`        | `payment-lifecycle.ts:309`                                     |
| `agreement.accepted`                   | `AGREEMENT_EVENT_TYPES.accepted`, `agreements.ts:62`           |
| `passport.customer_uploaded`           | `PASSPORT_EVENT_TYPES`, `passport.ts:42`                       |
| `passport.agent_captured`              | `passport.ts:43`                                               |
| `passport.agent_confirmed`             | `passport.ts:44`                                               |
| `booking.agent_assigned`               | `state-machine.ts:167` (via `assign_agent`)                    |
| `booking.agent_reassigned`             | `dispatch.ts:213` (no status change)                           |
| `visit.arrived`                        | `VISIT_EVENT_TYPES.arrived`, `agent-visit.ts:46`               |
| `visit.identity_verified`              | `agent-visit.ts:55` — **superseded as a gate**, kept as a name |
| `bag.sealed`                           | `agent-visit.ts:56`                                            |
| `booking.verified_sealed`              | `state-machine.ts:168`                                         |
| **`booking.awaiting_pickup`**          | `state-machine.ts:169` — **no production caller**              |
| **`booking.in_transit`**               | `state-machine.ts:170` — **no production caller**              |
| **`booking.delivered_to_bagdrop`**     | `state-machine.ts:171` — **no production caller**              |
| **`booking.completed`**                | `state-machine.ts:172` — **no production caller**              |
| `booking.exception_raised`             | `state-machine.ts:173`                                         |
| `booking.exception_resolved_resumed`   | `state-machine.ts:174`                                         |
| `booking.exception_resolved_completed` | `state-machine.ts:175`                                         |
| `booking.cancelled`                    | `state-machine.ts:176`, also `create-booking.ts:402`           |
| `booking.correction`                   | admin copy map only (`custody-copy.ts:140`); no emitter        |

Live confirmation — `select event_type, count(*) from custody_events group by 1` returned
**19 distinct types**, and the four bolded rows above are **absent** from the data, matching
the code finding.

**`applyTransition` — the full transition table.** `packages/core/src/booking/state-machine.ts:49-90`:

| From                       | Event                                                     | To                                                         |
| -------------------------- | --------------------------------------------------------- | ---------------------------------------------------------- |
| `draft`                    | `authorize_payment` / `cancel` / `raise_exception`        | `paid` / `cancelled` / `exception`                         |
| `paid`                     | `assign_agent` / `cancel` / `raise_exception`             | `agent_assigned` / `cancelled` / `exception`               |
| `agent_assigned`           | `complete_verification` / `cancel` / `raise_exception`    | `verified_sealed` / `cancelled` / `exception`              |
| **`verified_sealed`**      | **`mark_awaiting_pickup`** / `cancel` / `raise_exception` | **`awaiting_pickup`** / `cancelled` / `exception`          |
| **`awaiting_pickup`**      | **`start_transit`** / `cancel` / `raise_exception`        | **`in_transit`** / `cancelled` / `exception`               |
| **`in_transit`**           | **`deliver_to_bagdrop`** / `raise_exception`              | **`delivered_to_bagdrop`** / `exception` — **no `cancel`** |
| **`delivered_to_bagdrop`** | **`complete`** / `raise_exception`                        | **`completed`** / `exception`                              |
| `completed`                | —                                                         | terminal                                                   |
| `exception`                | `resume_transit` / `force_complete` / `cancel`            | `in_transit` / `completed` / `cancelled`                   |
| `cancelled`                | —                                                         | terminal                                                   |

Two stated rules (`state-machine.ts:43-47`): `cancel` disappears from `in_transit` onward —
once a driver has the bags, that situation is an exception needing a human; and
`completed`/`cancelled` are terminal.

**The four bolded transitions are the Tier 4 slot, and they have no production caller
today.** Grep across `apps/` + `packages/` for `mark_awaiting_pickup`, `start_transit`,
`deliver_to_bagdrop`, `complete_verification`, and the `"complete"` event returns only
`state-machine.test.ts` hits for the first four. The single live `in_transit` booking in the
local DB got there through the admin exception path (`resume_transit`), not through a
pickup.

**How a transition is written** — `packages/core/src/services/bookings.ts:394-466`:

- pure `transition()` first (`:405-415`) → typed `IllegalTransitionError`, returned not thrown
- one transaction (`:419-437`) doing a **compare-and-swap update**
  `WHERE id = $1 AND status = <from>` (`:423`) plus the custody insert; a concurrent
  transition loses cleanly (`:439-446`)
- the custody event id doubles as the dedupe key for the emitted domain event (`:428-436`)
- `raise_exception` emits `booking/exception_raised` **after** commit and only when this
  call performed the move (`:452-463`)

The session-guarded wrapper is `applyTransitionForSession` (`bookings.ts:469-488`).

---

## 5. Surfaces the slice will touch

### 5.1 Agent app

**Route structure** (`apps/agent/src/app/`):

| Route                                                       | File                      | Purpose                                                    |
| ----------------------------------------------------------- | ------------------------- | ---------------------------------------------------------- |
| `/`                                                         | `page.tsx`                | "Today" — current job large, rest below (`page.tsx:15-26`) |
| `/tasks`                                                    | `tasks/page.tsx`          | Schedule, grouped by airport-local day                     |
| `/tasks/[taskId]?kind=verification\|pickup`                 | `tasks/[taskId]/page.tsx` | one route, branched on a query param (`:175-176`)          |
| `/account`                                                  | `account/page.tsx`        | identity + avatar                                          |
| `/login`, `/login/reset`, `/set-password`, `/auth/callback` |                           | Supabase email/password                                    |
| `/offline`                                                  | `offline/page.tsx`        | service-worker fallback                                    |
| `/api/avatars`                                              | `api/avatars/route.ts`    | avatar upload                                              |

Nav is three bottom tabs, `apps/agent/src/components/shell/nav.ts:27-46` — and
`nav.ts:16-17` states three is a deliberate ceiling ("what am I doing now, what is coming,
who am I signed in as"). Adding a fourth "Drive" tab argues against that comment.

**Task list rendering:** `listAssignedTasks` (`tasks.ts:120-163`) returns
`{ verification[], pickup[] }`, each row carrying `{ task, tz, booking }` — the booking
context travels _with_ the task (`tasks.ts:54-76`) so the queue never renders identical
rows. `groupJobs` (`apps/agent/src/lib/job.ts:59-117`) collapses the two arrays into one
`Job` per booking with ordered `phases`, `startsAt`, `next`, and a
`problem | active | upcoming | done` state. **A driver task view fits this model without
changing it** — a third phase kind, or a filter on which phases this user owns.

**PWA / camera pieces available for reuse:**

- `apps/agent/public/manifest.webmanifest`, `apps/agent/public/sw.js`,
  `apps/agent/public/icons/`, registered by
  `apps/agent/src/components/service-worker-registrar.tsx` (production only, `:12`)
- `useGps()` + `<GpsFields>` — `visit-flow.tsx:88-110`; best-effort
  `getCurrentPosition`, 5 s timeout, degrades to null, posted as hidden form fields
- `BagPhotoField` — `visit-flow.tsx:121-190` (capture + preview + reset handling)
- `downscalePhoto` — `@koolee/ui/lib/photo`
- `mapsUrl()` / `addressText()` — `apps/agent/src/lib/job.ts:120-146`, cross-platform
  Maps deep link with `query_place_id` when available
- `usePreservedFormValues` — used at `visit-flow.tsx:500,662` to survive React 19's
  post-action form reset

**Inngest send-only wiring** (`apps/agent/src/lib/event-emitter.ts:1-36`): a
`createInngestClient({ eventKey, isDev })` at module scope plus an `InngestEmitter`
implementing `EventEmitter`. The header comment (`:8-20`) is emphatic: **this app registers
no functions and serves no `/api/inngest` route** — `apps/web` owns the registry and a
second serve endpoint would double-register everything. No signing key (that is for
receiving). So a driver-phase event raised from the agent app **sends** fine; anything that
must _handle_ it belongs in `apps/web`'s registry
(`apps/web/src/lib/inngest.ts:78-85`, served at `apps/web/src/app/api/inngest/route.ts:21-24`).

Current registry — 8 functions: `bookingConfirmationEmail`, `pickupReminder`,
`exceptionOpsAlertEmail`, `waitlistZoneOpenedSweep`, `cutoffRiskMonitor`, `agentNoShowCheck`
(`packages/core/src/jobs/functions.ts:558-565`), plus `cleanupAnonymousUsersCron` and
`captureDueCron` (`apps/web/src/lib/inngest.ts:83-84`).

### 5.2 Customer trip page

`apps/web/src/app/trips/[bookingId]/page.tsx`, 378 lines,
`export const dynamic = "force-dynamic"` (`:39`). Section order:

1. `BackLink` → `/trips` (`:171-173`)
2. `PageHeader` — flight · airport, ref, departure, bag count, pax, status badge (`:175-185`)
3. `CutoffCountdown`, when a cutoff is on record and the booking is active (`:187-193`)
4. `TripActionNeeded` — agreement + passport, only pre-visit (`:195-200`)
5. **"Your pickup" card** — Window / Address / **Agent** in a 3-col `<dl>` (`:202-270`).
   The Agent cell (`:241-267`) renders one avatar, a given name, and a status phrase from
   `AGENT_STATUS_COPY` (`:73-79`).
6. Two-column grid (`:272-375`): **Chain of custody** (`CustodyTimeline`, `:273-281`) beside
   **Bags** (per-bag photo, seal, weight, `:284-336`) and **Payment** (`:338-373`)

**Where driver selection and tracking would mount:** the "Your pickup" card is a fixed
three-cell `<dl>` — a driver cell is a fourth item, or a sibling card. `BookingDetail`
(`packages/core/src/services/bookings.ts:206-223`) is the shape that would have to grow;
it currently carries exactly one `assignedAgent: AssignedAgent | null`
(`:194-204`: `givenName`, `taskStatus`, `avatarStoragePath`) — **there is no second slot for
a driver, and `taskStatus` is singular**.

**Polling/refresh mechanism: there is none.** `dynamic = "force-dynamic"` means fresh on
navigation only. The one interval on the page is `CutoffCountdown`
(`apps/web/src/components/cutoff-countdown.tsx:25-30`), a 30-second **local re-render** of a
server-computed instant — it fetches nothing (`:8-11` explains why no arithmetic happens in
the browser). `revalidatePath('/trips/<id>')` fires only after the customer's own actions
(`apps/web/src/app/trips/[bookingId]/actions.ts:66`), and `router.refresh()` after upload
(`components/trip-action-needed.tsx:225`, `components/ticket-upload.tsx:69`). **Live driver
tracking would be the first thing on this page needing a server-push or poll.**

### 5.3 Admin

**Board:** `apps/admin/src/app/bookings/page.tsx` (list) →
`bookings/[bookingId]/page.tsx` (detail, with `dispatch-forms.tsx` and `custody-trail.tsx`).
Data comes from `listBookingsBoard` (`packages/core/src/services/dispatch.ts`, query at
`:530-547`): `bookings` LEFT JOIN `verification_tasks` LEFT JOIN `users` INNER JOIN
`airports`, filtered by `BoardFilter` (`:393-419`: statuses, airports, day+tz, free-text
search over ref/phone/seal, sort, limit 200 default).

**Overview** (`apps/admin/src/app/page.tsx`) shows `getOpsDashboard` counts
(`dispatch.ts:322-366`) and `listAgentWorkload` (`dispatch.ts:594-626`).

**Navigation — where Trucks and Shifts would fit:**
`apps/admin/src/components/console/nav.ts:59-114`, two groups:

- **Operations:** Overview `/`, Bookings `/bookings` (badge `unassignedToday`),
  Exceptions `/exceptions` (badge `exceptionsOpen`)
- **Configuration:** Window blocks `/blocks`, Agent zones `/zones`, Agreements
  `/agreements`, Staff `/staff`

A **Trucks CRUD** is a Configuration sibling of `/zones` and `/staff` — those two are the
closest existing shape (`zones/page.tsx` + `zone-forms.tsx` + `zones/actions.ts` is a
three-file CRUD template). A **Shifts view** is an Operations item next to Bookings; the
nearest existing precedent is the Overview's workload strip
(`apps/admin/src/app/page.tsx:32-33`, `NEXT_UP_LIMIT = 6`). Nav badges are typed to a closed
union — `ConsoleBadgeKey = "unassignedToday" | "exceptionsOpen"` (`nav.ts:30`) and
`ConsoleBadgeCounts` (`nav.ts:54-57`) — so a new live count means editing both plus
`OpsDashboard` (`dispatch.ts:305-312`) and `getConsoleDashboard`
(`apps/admin/src/lib/console-dashboard.ts:22-26`).

**The at-risk flag for unassigned bookings:**

- Horizon constant: `packages/core/src/services/dispatch.ts:434` —
  `const AT_RISK_HORIZON_MS = 12 * 60 * 60 * 1000;`
- Per-row derivation: `dispatch.ts:557-561`

  ```ts
  atRisk:
    row.booking.status === "paid" &&
    !row.assigneeUserId &&
    row.slotStart !== null &&
    row.slotStart.getTime() - now.getTime() < AT_RISK_HORIZON_MS,
  ```

- Documented as _"Simple derived flag, not a scheduling engine"_ (`dispatch.ts:386-390`)
- The dashboard counterpart is the `unassignedToday` count,
  `dispatch.ts:340-351` — `status = 'paid'` AND window starts inside the airport-local day
  AND `verification_tasks.assignee_user_id IS NULL`

**Both read `verification_tasks` only.** An unassigned _pickup_ or an undispatched driver
is invisible to every at-risk surface in the console today.

---

## 6. Constraints inventory

### 6.1 Migration count + `db:status` (local)

**28 migrations**, `0000_init` → `0027_avatars_bucket`
(`packages/db/drizzle/meta/_journal.json`, 28 entries; newest `0027`, `when=1788028436443`).

```
$ pnpm db:status                    # cwd packages/db, read-only by construction
Target host: 127.0.0.1
Applied:  28 of 28 (matched by content hash)

In sync — nothing pending.
```

No orphans, no stranded migrations, no RLS gaps. The tool prints an RLS note whenever the
`ensure_rls` event trigger is absent (`packages/db/src/status.ts:173-178`) and printed none,
so **the trigger is present locally and every public table has RLS on** — independently
confirmed by the probe (all 26 public tables report `relrowsecurity = true`).

Practical consequence: a new Tier 4 table gets RLS automatically here, but the trigger needs
superuser and Supabase's `postgres` role lacks it (`status.ts:170-171`) — so the migration
should still `ALTER TABLE … ENABLE ROW LEVEL SECURITY` explicitly, as
`packages/db/drizzle/0016_uniform_rls_baseline.sql` does. Note also that authorization does
**not** live in RLS: app queries run on a `rolbypassrls` connection (`0016…sql:30-38`).

### 6.2 Partial / unique indexes already present on the tasks tables

Live `pg_indexes` on `verification_tasks` / `pickup_tasks`:

| Table                | Index                                    | Definition                 |
| -------------------- | ---------------------------------------- | -------------------------- |
| `verification_tasks` | `verification_tasks_pkey`                | UNIQUE (id)                |
| `verification_tasks` | `verification_tasks_booking_id_key`      | **UNIQUE (booking_id)**    |
| `verification_tasks` | `verification_tasks_assignee_status_idx` | (assignee_user_id, status) |
| `verification_tasks` | `verification_tasks_scheduled_start_idx` | (scheduled_start)          |
| `pickup_tasks`       | `pickup_tasks_pkey`                      | UNIQUE (id)                |
| `pickup_tasks`       | `pickup_tasks_booking_id_key`            | **UNIQUE (booking_id)**    |
| `pickup_tasks`       | `pickup_tasks_assignee_status_idx`       | (assignee_user_id, status) |
| `pickup_tasks`       | `pickup_tasks_scheduled_start_idx`       | (scheduled_start)          |

**No partial index on either tasks table.** The two partial indexes in the whole schema are:

- `bags_seal_id_key` — `UNIQUE (seal_id) WHERE (seal_id IS NOT NULL)`
- `pricing_rules_one_active_key` — `UNIQUE (active) WHERE active`

The second is the exact idiom a "one open shift per driver" or "one active assignment per
truck" constraint would copy.

### 6.3 Row locks — **`FOR UPDATE` does not exist in this codebase**

Grep for `for update` / `forUpdate` / `SKIP LOCKED` across `apps/` + `packages/`: **zero
hits.** The three patterns actually in use:

1. **Unique index + catch `23505`.** `packages/core/src/services/dispatch.ts:79-87`
   (`pgErrorCode` walks `.cause` because drizzle ≥ 0.44 wraps driver errors) and
   `:183-196`, which turns the loser of the on-paid race into
   `{ ok: false, conflict: true }` rather than an error.
2. **Compare-and-swap.** `applyTransition`'s `WHERE id = $1 AND status = <from>`
   (`packages/core/src/services/bookings.ts:423`); a null result means someone else moved it
   (`:439-446`).
3. **Transaction-scoped advisory locks.** `packages/core/src/auth/otp-throttle.ts:62-71`:

   ```ts
   await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${userId}, 0))`);
   await tx.execute(
     sql`select pg_advisory_xact_lock(hashtextextended(${destinationHash}, 0))`,
   );
   ```

   with a written rule about **fixed lock order to avoid deadlock** (`:49-61`); the
   companion at `packages/core/src/auth/reconcile-claims.ts:109` takes only the destination
   lock and documents why that stays deadlock-free.

22 `db.transaction(...)` sites exist across core; none takes a row lock.

**For "transactional truck/driver selection", (1) and (3) are the two house-consistent
options.** A `FOR UPDATE`/`SKIP LOCKED` claim queue would be the first of its kind here.

### 6.4 Test infrastructure and the concurrency pattern

Integration suites are gated on an env var, not a config flag —
`packages/core/src/services/auto-assign-on-paid.integration.test.ts:43-50`:

```ts
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const describeIntegration = TEST_DATABASE_URL ? describe : describe.skip;
```

Setup (`:80-118`): one `postgres()` client with `max: 1` for DDL/cleanup, `migrate()` from
`packages/db/drizzle` (`:52-55`), a separate `createDb({ max: 8 })` pool for the code under
test — **the 8-connection pool is what makes real concurrency possible.** `beforeEach` wipes
with `SET session_replication_role = replica` around the DELETEs (`:98-118`), which is the
only way to clear append-only `custody_events`.

Two databases, per `.env.test`: `TEST_DATABASE_URL` → **`koolee_test`** (disposable, wiped
freely); `GOTRUE_TEST_DATABASE_URL` → `postgres` (the dev DB), used only by the three suites
that drive the real GoTrue API and therefore preserve pre-existing rows via
`packages/core/src/test-utils/preserve-existing-rows.ts:35-57`.

**The two-concurrent-paid test** —
`auto-assign-on-paid.integration.test.ts:207-230`,
_"two concurrent transitions to paid produce exactly one task pair and one assignment"_:

```ts
// :216-219 — the production race, verbatim: webhook delivery and return-page re-check
const [webhook, recheck] = await Promise.all([
  handlePaymentEvent(config, provider.verifyWebhook(payload, signature)),
  reconcileBookingPayment(config, { bookingId: intent.bookingId, userId }),
]);
// :223-229
expect(state.booking?.status).toBe("agent_assigned");
expect(state.vTasks).toHaveLength(1);
expect(state.pTasks).toHaveLength(1);
expect(state.assignEvents).toHaveLength(1);
```

**Pattern:** `Promise.all` over the _real_ entry points (not the internal function),
against a real Postgres, then assert on cardinality via a single `assignmentState()` reader
(`:192-205`) that pulls booking + both task tables + custody events at once. A stronger
variant is at `:232-258` — a **4-way burst** of `autoAssignOnPaid` after first reaching
paid-unassigned, asserting one task pair, one custody event, and
`actorUserId === null` (the system actor).

This is the template a Tier 4 "two dispatchers claim the same truck" test should copy.

### 6.5 Live data snapshot (local `postgres`)

| Table                | Rows                                     |
| -------------------- | ---------------------------------------- |
| `addresses`          | 8                                        |
| `agent_zones`        | 198                                      |
| `agents`             | **0**                                    |
| `bags`               | 42 (7 sealed)                            |
| `bookings`           | 20                                       |
| `custody_events`     | 108 (19 distinct event types)            |
| `drivers`            | **0**                                    |
| `pickup_tasks`       | 14 (all `assigned`)                      |
| `routes`             | **0**                                    |
| `staff_members`      | 11                                       |
| `verification_tasks` | 14 (7 assigned / 3 in_progress / 4 done) |

Bookings by status: `agent_assigned` 9, `cancelled` 5, `draft` 2, `in_transit` 1,
`exception` 1, `completed` 1, `verified_sealed` 1.

### 6.6 Exactly what was executed against a database

1. `nc -z 127.0.0.1 54322` — reachability check, no SQL.
2. `pnpm db:status` in `packages/db` — the repo's own read-only drift report
   (`packages/db/src/status.ts:10-17`: _"Writes nothing, takes no locks, runs no DDL"_).
3. One temporary script, `packages/db/probe-readonly.tmp.ts`, run with `npx tsx` and then
   deleted (`git status --porcelain` → clean). It issued **SELECT statements only**:
   `pg_class`/`pg_namespace` (tables + RLS), `count(*)` per table, address coordinate
   counts, task/booking/custody/staff/user group-bys, seal coverage,
   `pg_indexes`, `information_schema.columns` for `drivers` and `routes`, and
   `information_schema` FK lookups. No INSERT/UPDATE/DELETE/DDL, no transaction, no lock.

---

## 7. Gaps and risks — my judgment, against the agreed Tier 4 design

Facts are §1–§6. Everything below is opinion, each line carrying its evidence.

### Blocking or near-blocking

1. **The haversine ETA seam has no coordinates at either end.** `addresses.lat/lng` are
   0-of-8 populated and never written by any caller (§3.2); `airports` has no lat/lng column
   at all (§3.3). Haversine needs two points and today there are zero — the seam ships as an
   interface with nothing behind it unless geocoding lands first.
2. **Geocoding is a prerequisite, not a follow-up.** The single insert path is
   `ensureAddress` (`customers.ts:288-301`), which already accepts coords — so the change is
   a _funnel_ change (`pickup-step-form.tsx:147-148` TODO, plus a `lat/lng/placeId` field on
   the draft schema at `booking-draft-schema.ts:110-114`), plus a backfill decision for the
   8 existing rows. It touches a customer-facing conversion step; that is not a Tier 4-shaped
   change.
3. **Bag-count capacity has no denominator.** `drivers.vehicle_capacity_bags` exists and is
   NULL-able with zero rows (§1.1); the only real bag count is `bookings.bag_count`. Nothing
   aggregates bags per route because **there is no route↔booking link** — no `route_stops`
   table exists (§1.2). Capacity enforcement needs that join table before it needs a
   capacity column.

### Design-shaping

4. **A `trucks` table plus `drivers.vehicle_*` is two homes for one fact.** Five vehicle
   columns already sit on `drivers` (`identity.ts:106-111`). Tier 4 should either drop them
   in the same migration or state that `drivers` becomes person-only — leaving both is how
   the plate on the dispatch board and the plate on the driver record diverge.
5. **`driver_shifts` is the first temporal-availability entity in the schema.** `zones.ts:14`
   explicitly deferred it (_"If territories ever get names and shifts of their own, that is
   the migration to write then"_), and nothing today — not auto-assign, not
   `listAgentWorkload` — asks whether a person is working. Auto-assign's only inputs are ZIP
   coverage and open-task counts (`auto-assign.ts:22-39`), so shifts arrive as a **new
   concept for agents too**, and a shift-aware driver selector next to a shift-blind agent
   selector will read as a bug within a week.
6. **Capability flags collide with `staff_members.role` being one column with a CHECK.**
   `role` is a single `user_role` value constrained to `('agent','admin')`
   (`staff.ts:44` / `0004_common_post.sql:9`), and one person doing both jobs is the stated
   v1 reality (`dispatch.ts:91`, `bookings/[bookingId]/page.tsx:508`). Flags mean deciding
   whether `driver` is a _third role_ (relax the CHECK + `STAFF_ROLES` at `staff.ts:34` +
   `getActiveStaffRole` at `:42-51`) or a _capability alongside_ `agent`. The second is
   truer to how the operation works and is the bigger migration.
7. **`agent_zones` is reusable but its name and its guards say "agent".** The FK is to
   `users.id` (`zones.ts:26`), so a driver row fits with no DDL — but the auto-assign read
   hard-joins `staffMembers.role = 'agent'` (`auto-assign.ts:196`) and `addAgentZones`
   rejects non-agents (`:366-369`). Sharing needs a discriminator or a role filter at read
   time; renaming the table is a wider diff than it looks (198 live rows, admin CRUD at
   `apps/admin/src/app/zones/`).
8. **Transactional selection has no in-house `FOR UPDATE` precedent to match.** There is
   none in the codebase (§6.3); the established idioms are unique-index-plus-`23505` and
   `pg_advisory_xact_lock` with a documented lock order (`otp-throttle.ts:49-71`). A
   `SELECT … FOR UPDATE SKIP LOCKED` claim loop would be the first, and it wants an explicit
   note saying why the two existing patterns were not enough.
9. **Latest-position GPS wants a mutable row, and the only GPS store today is append-only.**
   `custody_events.lat/lng` sit on a table with an UPDATE/DELETE trigger
   (`custody.ts:8-21`) and are written only on visit events
   (`visit-flow.tsx:88-110`). A `driver_positions` latest-row table is therefore a genuinely
   new _kind_ of table here — high-write, mutable, non-evidentiary — and should say in its
   comment that it is explicitly **not** part of the chain of custody, or the next reader
   will assume it is.

### Sequencing / scope

10. **The pickup half of the lifecycle is unimplemented, not merely unpolished.** Four
    transitions have no production caller (§4.3), nothing ever advances a `pickup_tasks` row
    (§1.3), and the agent detail screen is an explicit placeholder
    (`apps/agent/src/app/tasks/[taskId]/page.tsx:192-230`). "Driver assignment" without
    `mark_awaiting_pickup` → `start_transit` → `deliver_to_bagdrop` → `complete` produces
    assignable drivers who cannot record having done anything.
11. **Every at-risk surface is blind to pickup and would stay blind.** `atRisk`
    (`dispatch.ts:557-561`) and `unassignedToday` (`dispatch.ts:340-351`) both key on
    `bookings.status = 'paid'` + a NULL `verification_tasks.assignee_user_id`. A sealed
    booking with no driver is at risk of the _cutoff_, and no console surface would say so.
12. **`cutoffRiskMonitor` under-alerts today and Tier 4 does not automatically fix it.** It
    subtracts a flat `driveTimeMinutes: 60` (`config.ts:59`, used at `functions.ts:432-436`)
    and assumes `scope: "domestic"` for every booking (`functions.ts:414-417`). A real ETA
    changes the first; the second is an independent bug that will keep the alert wrong.
13. **`pickup_tasks.assignee_user_id` FK targets `users`, not a driver entity**
    (`tasks.ts:57-59`). That is convenient — a driver assignment needs no FK change — but it
    also means nothing at the database level prevents assigning a pickup task to a customer.
    Today the app-layer guard is `getActiveStaffRole(...) !== 'agent'`
    (`dispatch.ts:113-116`); a driver path needs its own equivalent or the guard silently
    weakens.
14. **The agent nav ceiling is a stated design rule, not an oversight.**
    `apps/agent/src/components/shell/nav.ts:16-17` argues three tabs is the maximum. A driver
    surface should extend the existing job/phase model
    (`apps/agent/src/lib/job.ts:17-52`) rather than add a fourth tab, or the rule needs an
    explicit reversal.
15. **The trip page has no live-update mechanism at all** (§5.2) — `force-dynamic` plus a
    local-only 30-second countdown. "Customer sees the driver moving" is a new capability
    (poll route, SSE, or Supabase realtime), not a rendering change, and it is easy to
    under-scope because the page already _looks_ live.
16. **Seal capture is manual text entry with `.trim()` as its only format rule**
    (`agent-visit.ts:414-415`, `visit-flow.tsx:562`). If the pickup handover is meant to
    re-verify seals at the bag drop, a second manual-entry step doubles the typo surface on
    the one identifier that is operation-wide unique (`bags_seal_id_key`) — worth deciding
    whether the driver _re-scans_ or merely _confirms a count_.
17. **A driver-raised exception reaches ops only from apps that can send.** The agent app is
    send-only by design (`apps/agent/src/lib/event-emitter.ts:8-20`); any Tier 4 job that must
    _handle_ a driver event has to be registered in `apps/web`
    (`apps/web/src/lib/inngest.ts:78-85`). A function added to
    `createKooleeFunctions` will be served correctly, but one added to the agent app will
    silently never run.
18. **`agentNoShowCheck` has no pickup twin, and its TODO is the Tier 4 reassignment
    question.** `functions.ts:494-501` polls `verification_tasks` only, and
    `functions.ts:508-510` says reassignment is out of scope and should "try the next
    available agent before paging a human". A driver no-show is the same problem with a
    tighter deadline (the airline cutoff), and it will want the same unwritten machinery.

---

## Appendix — quick file index for the slice

| Concern                                 | File                                                                         |
| --------------------------------------- | ---------------------------------------------------------------------------- |
| Task tables                             | `packages/db/src/schema/tasks.ts`                                            |
| Driver / vehicle / address / agent      | `packages/db/src/schema/identity.ts`                                         |
| Routes                                  | `packages/db/src/schema/ops.ts`                                              |
| Zones                                   | `packages/db/src/schema/zones.ts`                                            |
| Staff roles                             | `packages/db/src/schema/staff.ts`                                            |
| Custody table + append helpers          | `packages/db/src/schema/custody.ts`, `packages/db/src/custody.ts`            |
| State machine + event names             | `packages/core/src/booking/state-machine.ts`                                 |
| Transition writer                       | `packages/core/src/services/bookings.ts` (`applyTransition`, `:394`)         |
| Assignment / board / workload / at-risk | `packages/core/src/services/dispatch.ts`                                     |
| Auto-assign + zone admin                | `packages/core/src/services/auto-assign.ts`                                  |
| Agent task reads                        | `packages/core/src/services/tasks.ts`                                        |
| Visit flow (seals, gate, GPS)           | `packages/core/src/services/agent-visit.ts`                                  |
| Address creation                        | `packages/core/src/services/customers.ts` (`ensureAddress`, `:266`)          |
| Jobs registry + ETA stub                | `packages/core/src/jobs/functions.ts`, `apps/web/src/lib/inngest.ts`         |
| Agent session                           | `apps/agent/src/lib/session.ts`                                              |
| Agent job grouping / maps link          | `apps/agent/src/lib/job.ts`                                                  |
| Agent visit UI                          | `apps/agent/src/app/tasks/[taskId]/visit-flow.tsx`                           |
| Pickup placeholder                      | `apps/agent/src/app/tasks/[taskId]/page.tsx:192-230`                         |
| Customer trip page                      | `apps/web/src/app/trips/[bookingId]/page.tsx`                                |
| Funnel address step                     | `apps/web/src/components/pickup-step-form.tsx`                               |
| Console nav                             | `apps/admin/src/components/console/nav.ts`                                   |
| Concurrency test template               | `packages/core/src/services/auto-assign-on-paid.integration.test.ts:207-258` |
