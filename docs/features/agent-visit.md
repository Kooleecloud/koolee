# Agent PWA — the verification visit

> The field app. Owns `agent_assigned` → `verified_sealed` → `in_transit`.
> App: `apps/agent` (`:3001`). Baseline: `dev` @ `5973047`.
> ← [Features index](README.md) ·
> Deeper: [verification-visit.md](../../apps/agent/docs/verification-visit.md)

---

## 1. Routes

| Route                                     | Role                           |
| ----------------------------------------- | ------------------------------ |
| `/`                                       | Entry                          |
| `/tasks`                                  | The agent's assigned task list |
| `/tasks/[taskId]`                         | The verification visit itself  |
| `/scan`                                   | Seal / bag scanning            |
| `/login`, `/login/reset`, `/set-password` | Invite-only staff auth         |
| `/offline`                                | PWA offline fallback           |

---

## 2. The hard rails

From [agent-visit.ts](../../packages/core/src/services/agent-visit.ts) — stated
in the source as "not up for style debates":

1. **Every step appends a `custody_events` row** with the **real agent user id**
   and timestamps; GPS and photo land in the columns the schema has.
2. **The verification/pickup task split stays.** This file only ever touches
   `verification_tasks`.
3. **Completing the visit does not touch money.** It advances the booking via
   `complete_verification`. This app holds no payment credentials; capture is
   swept from the web app (`captureDueBookings`).
4. **Authorization is assignment.** Every function resolves the task by
   `(id, assignee = session.userId)` — **someone else's task 404s.**

🧭 Rail 4 is the whole authorization model for this app. There is no separate
permission table: _having the task assigned to you_ is the permission.

---

## 3. The visit flow

| Step                      | Service                     | Custody event                      |
| ------------------------- | --------------------------- | ---------------------------------- |
| Arrive at the address     | `arriveAtVisit`             | `visit.arrived`                    |
| Verify passenger identity | `recordIdentityVerified`    | `visit.identity_verified`          |
| Seal each bag             | `recordBagSealed`           | `bag.sealed`                       |
| Complete                  | `completeVerificationVisit` | transition `complete_verification` |
| Something went wrong      | `reportVisitException`      | → `exception`                      |

`getVisitContext` assembles everything the visit screen needs in one read.

### 3.1 — Bags

Each bag gets a `seal_id`, optional weight, and photos. **Order and label bags
by `ordinal`, never array position** — a booking's bags share `created_at` to
the millisecond, so `ORDER BY created_at` is a non-deterministic tie that an
`UPDATE` can reshuffle. A sealed bag was observed moving from "Bag 1" to "Bag 3"
between two renders of the same page. Hence `UNIQUE (booking_id, ordinal)`.

`seal_id` is an **opaque string** — the seal technology (RFID vs printed QR) is
undecided. **Do not parse it or infer structure from it.**

---

## 4. Photo evidence

Uploaded to the **private `bag-photos` Supabase Storage bucket** (migrations
`0008`/`0009`).

⚠️ **This app deliberately holds no service-role key.** It uploads as the
signed-in agent, so **Storage RLS is the only authorization mechanism there
is**. The staff test runs through the SECURITY DEFINER function
`public.is_active_staff(uuid)` — granting `authenticated` a direct `SELECT` on
`staff_members` would expose the roster through PostgREST.

🧭 If you ever find yourself wanting a service-role key in this app to make
something easier, that is the signal to move the operation server-side into a
core service instead. A shared, frequently-lost field device must not carry one.

---

## 5. Custody events are the product

`custody_events` is the append-only chain of custody: who had which bag, where,
when, with what photographic evidence. **This is what Koolee answers a customer
with when a bag goes missing.**

Enforced twice — a database trigger raising on `UPDATE`/`DELETE`/`TRUNCATE`, and
a data-access layer exposing only `appendCustodyEvent`, `appendCustodyEvents`,
and `listCustodyEvents`. **No update or delete helper exists to call.**

Corrections append a **compensating event**, never an edit.

Event type strings are free-form by design — the writer is this module
(`VISIT_EVENT_TYPES`).

---

## 6. Assignment

Bookings reach an agent two ways:

- **Auto** — [auto-assign.ts](../../packages/core/src/services/auto-assign.ts),
  a naive v1 matching `agent_zones` against the pickup ZIP and airport day,
  balancing by current workload.
- **Manual** — an admin uses the dispatch board
  ([ops-console.md](ops-console.md)).

Agents read their own work through `listAssignedTasks` / `getAssignedTask`
([tasks.ts](../../packages/core/src/services/tasks.ts)).

---

## 7. Why two task tables

`verification_tasks` and `pickup_tasks` are separate **even though one person
often does both**. They have different SLAs and evidence requirements;
collapsing them would make _"verified but not yet collected"_ unrepresentable.

Assigning the same user to both is a **dispatch decision, not a schema one**.

---

## 8. Env

The smallest surface of the three apps: `NEXT_PUBLIC_APP_URL`, `DATABASE_URL`,
`DIRECT_DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `GOOGLE_MAPS_API_KEY` (stubbed — route ETA
falls back to a fixed estimate), `SENTRY_DSN`.

**No `SUPABASE_SERVICE_ROLE_KEY`, no Stripe keys.** Both absences are
deliberate.

The production boot gate refuses to start without the Supabase URL + anon key:
**staff sign-in _is_ this app**, and without them every page degrades to an
unusable login screen rather than an actionable error.
