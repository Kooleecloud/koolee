# Agent PWA — the verification visit

> The field app. Owns `agent_assigned` → `verified_sealed` → `in_transit`.
> App: `apps/agent` (`:3001`). Baseline: `dev` @ `2fe3a2b`.
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

**Order and label bags by `ordinal`, never array position** — a booking's bags
share `created_at` to the millisecond, so `ORDER BY created_at` is a
non-deterministic tie that an `UPDATE` can reshuffle. A sealed bag was observed
moving from "Bag 1" to "Bag 3" between two renders of the same page. Hence
`UNIQUE (booking_id, ordinal)`.

`seal_id` is an **opaque string** — the seal technology (RFID vs printed QR) is
undecided. **Do not parse it or infer structure from it.**

### 3.2 — Sealing takes all three, or it does not happen

A bag is sealed only with **a unique seal id, a weight, and a photo**. All three
are required — `SealBagInput.weightKg` and `.photoPath` are non-optional, and
`recordBagSealed` rejects a missing or non-positive weight and a missing photo
before it opens the transaction.

They are the custody record: _what_ was sealed, _how heavy_ it was, and _what it
looked like_ at the door. A bag sealed without them is undefendable in a damage
claim.

⚠️ **There is no override** — not even for a broken scale. An agent who cannot
weigh or photograph a bag files `reportVisitException` instead of sealing it. A
"skip" button would be used on the worst day, which is exactly the day the
evidence is needed.

### 3.3 — A seal id identifies exactly one bag, operation-wide

`bags.seal_id` carries a **partial `UNIQUE` index** (`bags_seal_id_key`, migration
`0017`), partial because unsealed bags all hold `NULL` and must not collide.

The scope is the **whole table, not one booking** — seals come off a single
numbered stock, so the id is globally unique by construction. A repeat means
either a typo or a physically reused seal, and both are custody incidents.

⚠️ Found in agent testing: three bags in one booking accepted the same printed
seal number. The seal id is what ties a sealed bag to a custody event in a loss
or damage dispute; two bags answering to one id makes that record undefendable.

`recordBagSealed` also does a **pre-check read** before the insert, purely so the
agent gets an actionable sentence rather than a driver error — and it says which
case it is:

- same booking → _"each bag needs its own seal"_;
- another booking → _"check the number on the seal"_.

🧭 That read **races** (two agents, same id, same instant) and that is fine by
design. The index is the real guarantee; the read is a UX affordance. Don't
"fix" the race by removing the index or by adding a lock — the correct layering
is already in place.

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

### 4.1 — Photos are downscaled in the browser first

Phone cameras hand us 3–8 MB JPEGs. Server Actions cap the request body at
**1 MB** by default, so an untouched capture `413`s **before the action ever
runs** — no error boundary, no custody event, nothing to debug from.

[photo.ts](../../apps/agent/src/lib/photo.ts) resizes on the client before
upload: longest edge `1600px`, target `700 KB`, JPEG quality stepped down
`0.8 → 0.6 → 0.45` until it fits. `createImageBitmap(..., { imageOrientation: "from-image" })`
applies EXIF orientation so portrait captures don't come out sideways once the
re-encode drops the tag.

Everything there is **best-effort**: a file already under target is passed
through untouched (no pointless re-encode), and any decode/encode failure
returns the original for the server-side size and type checks to judge.

⚠️ `serverActions.bodySizeLimit` is raised to `4mb` in
[next.config.mjs](../../apps/agent/next.config.mjs) as the **safety net only**,
for browsers where the canvas re-encode fails. It cannot go much higher —
Vercel hard-caps the serverless request body at ~4.5 MB and no Next config
raises that.

### 4.2 — Viewing evidence

Photos are captured at ~1200px and were being rendered at 78–190px with no way
to enlarge them. `ImageLightbox` ([packages/ui](../../packages/ui/src/components/image-lightbox.tsx))
is the shared viewer, used by the agent's capture preview, the ops bags card,
and the custody trail — so the customer's trip page gets it too.

The agent's capture preview supports **retake**, and **clears on form reset** so
a stale thumbnail can never imply an attached file.

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
