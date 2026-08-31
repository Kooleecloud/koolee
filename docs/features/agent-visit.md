# Agent PWA — the verification visit

> The field app. Owns `agent_assigned` → `verified_sealed` → `in_transit` →
> `delivered_to_bagdrop`. App: `apps/agent` (`:3001`).
> Baseline: `dev` @ `5db21a4`. ← [Features index](README.md) ·
> Deeper: [verification-visit.md](../../apps/agent/docs/verification-visit.md)

---

## 1. Routes

| Route                                     | Role                                    |
| ----------------------------------------- | --------------------------------------- |
| `/`                                       | **Today, as a route** — the day's stops |
| `/tasks`                                  | The agent's assigned tasks              |
| `/tasks/[taskId]`                         | One task — the visit, or the pickup     |
| `/account`                                | Profile, avatar, notification opt-in    |
| `/login`, `/login/reset`, `/set-password` | Invite-only staff auth                  |
| `/offline`                                | PWA offline fallback                    |

---

## 1.5 The day is a route, not a list

The single most important thing about this app is that **the two task tables are
not what the driver sees.** `verification_tasks` and `pickup_tasks` stay exactly
as they are in the database; the grouping into one **job** per booking happens
in presentation, in [job.ts](../../apps/agent/src/lib/job.ts).

The reason is a phone screen. Rendered as two rows, the same customer, the same
window and the same address appeared twice, three lines apart. A driver does not
experience "a verification task and a pickup task" — they experience one trip to
one door with two things to do there: **Verify & seal** _at the door_, then
**Collect & deliver** _to the bag drop_.

Because the grouping is presentational, it stays reversible the day those two
halves go to different people. §7 is why the tables stay split.

**One rail, one open stop.**
[journey-list.tsx](../../apps/agent/src/components/job/journey-list.tsx) renders
the day as one connected rail with exactly one stop expanded — the one to do
next, with its controls; the rest are compact rows one tap away. What it
replaced was two headed sections ("Up next", "Later today") of standalone cards,
where every card looked equally like a starting point and the sequence had to be
reconstructed from four timestamps. One rail makes the order structural; one
open stop draws the distinction the old layout could not: *where I am* versus
*what is after this*.

🧭 **Stops are ordered by scheduled time, never by geography.** The customer
bought a window, and a route optimiser that reorders stops to save a mile
quietly breaks the promise that window is. Optimisation is deferred (P17); when
it lands it must reason about windows, and `JourneyList` will render whatever
order it produces without changing.

⚠️ **Overdue stops lead the route rather than being hidden**, and are marked as
late — a driver reading a rail top to bottom would otherwise take the first row
as "next" instead of "already missed".

### Navigate is what starts a leg

[navigate-action.tsx](../../apps/agent/src/components/job/navigate-action.tsx)
is a plain `<a target="_blank">`, **not a button that navigates**. The href is
real, so the browser opens the maps app synchronously from a genuine user
gesture — immune to popup blocking and to a dead kerbside signal.

The server action that marks the pickup as under way is fired and **deliberately
not awaited**. Awaiting it, or calling `preventDefault()` and navigating after,
would put a server round-trip between the driver's thumb and their map, on a
phone, in a van, on whatever signal a kerb has. `startPickupTravel` is idempotent
in core, so the double-fire this permits (tap Navigate, then tap "Set off") is a
no-op the second time.

**The bookkeeping waits, never the driver.**

### What the driver can see about the door

Two additions that both came down to the driver having less information than the
customer did.

- **The number to call**
  ([door-contact.ts](../../packages/core/src/services/door-contact.ts)). The app
  used to show a disabled "No number" button on most jobs, and it was not a bug
  — it read `bookings.contact_phone`, which is only ever set for **email-only**
  customers, since the funnel asks for a door number precisely when it has no
  verified phone. Every phone-OTP customer had their number on `users.phone`,
  deliberately never selected. That was the wrong call: a driver outside a
  building with no buzzer answer has exactly one useful action, and withholding
  the number strands both of them into a support call that reads it out anyway.
  **One field, and nothing else** — email and the rest of the user row stay
  unselected, and the number reaches only the assignee of a live task on that
  booking, the same relationship that already grants them the address, the name
  and the face. The booking's own `contact_phone` wins when present: it was typed
  *for this pickup* and may be a hotel desk rather than the traveller.
- **How far away it is**
  ([staff-travel.ts](../../packages/core/src/services/staff-travel.ts)), computed
  off the driver's own last GPS ping. Null is an ordinary answer — location off,
  no fix yet, an address without coordinates — and every caller renders nothing
  rather than a placeholder. It never throws: a driver standing at a door must
  not meet a 500 because a routing API is down.

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

| Step                    | Service                     | Custody event                      |
| ----------------------- | --------------------------- | ---------------------------------- |
| Arrive at the address   | `arriveAtVisit`             | `visit.arrived`                    |
| Clear the identity gate | `confirmVisitIdentity`      | `passport.agent_confirmed`         |
| Seal each bag           | `recordBagSealed`           | `bag.sealed`                       |
| Complete                | `completeVerificationVisit` | transition `complete_verification` |
| Something went wrong    | `reportVisitException`      | → `exception`                      |

`getVisitContext` assembles everything the visit screen needs in one read,
`identityGate` included.

⚠️ **The identity step changed (2026-08-28).** It used to be a self-attested
checkbox writing `visit.identity_verified`; `recordIdentityVerified` no longer
exists in core. The step now requires BOTH the customer's acceptance of the
current booking agreement AND the assigned agent's passport confirmation, and
the sealing steps are refused in core until both hold. There is no override.
Full rules: [agreements-and-passport.md](agreements-and-passport.md).
`VISIT_EVENT_TYPES.identityVerified` survives as a constant because it is the
only record of every visit performed before that change.

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

[photo.ts](../../packages/ui/src/lib/photo.ts) resizes on the client before
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

⚠️ **A stored photo value is a storage PATH, not a URL** — `bags.photo_urls`
and `custody_events.photo_url` both hold keys into the **private** `bag-photos`
bucket, whatever their column names suggest. Rendering one means signing it
first (`createSignedUrls`, 5-minute TTL); fetching the bare path returns
HTTP 400. Ops did this from the start; the customer's trip page did not, and
showed a broken image for every hand-off photo until 2026-08-16. Web now signs
through [bag-photos.ts](../../apps/web/src/lib/bag-photos.ts) — service-role,
because the bucket's read policy admits active staff only, and safe there only
because `getBookingDetailForSession` has already established ownership before
any path reaches it. Any new surface that renders evidence must sign too.

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

`listAssignedTasks` returns each row as `{ task, tz, booking }`, where
`booking` is a `TaskBookingContext` — pax name, flight, airport, departure, bag
count, and the pickup street/city. **The booking travels with the task on
purpose** (2026-08-16): until then the query returned the task row alone, and
`/tasks` could only render a kind label, a time, and a status chip. Six tasks
looked like six copies of one task, and nothing on the screen told an agent
which door to drive to. A task is only meaningful in terms of the booking it
serves, so the join lives in the service rather than being re-fetched per row
by the page.

`/tasks` renders that as **one task per row**, grouped under airport-local day
headings, with the kind as a coloured chip (verify = seal orange, collect =
sky), the window time leading the line, then pax · bag count, and address ·
flight beneath. The day grouping is deliberate: an agent reads a shift, not a
queue. Sorting stays by absolute instant, never by rendered local time — with
two airports in one list, a 9 AM Pacific visit would otherwise sort above a
10 AM Eastern one that happens three hours earlier.

---

## 7. Why two task tables

`verification_tasks` and `pickup_tasks` are separate **even though one person
often does both**. They have different SLAs and evidence requirements;
collapsing them would make _"verified but not yet collected"_ unrepresentable.

Assigning the same user to both is a **dispatch decision, not a schema one**.

---

## 8. Env

The smallest surface of the three apps: `DATABASE_URL`,
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`,
`NEXT_PUBLIC_SENTRY_DSN`, and the four VAPID vars when push is on — all four or
none ([ENVIRONMENT §4.5](../ENVIRONMENT.md#45--web-push-all-four-vapid-vars-or-none--all-three-apps)).

⚠️ **No Google key here, and that is not an omission.** Distance and ETA are
computed in `@koolee/core` behind the `EtaEstimator` seam, on the server, using
the one server-restricted key that lives in `apps/web`. This app never holds a
Maps credential and never calls Google directly.

**No `SUPABASE_SERVICE_ROLE_KEY`, no Stripe keys.** Both absences are
deliberate, and the service-role one is `forbidden` in the env manifest rather
than merely absent: a shared, frequently-lost field device must not carry a key
that bypasses every policy in the database. Completing a visit does **not** take
the money — capture is a sweep run from `apps/web`, which is the app that holds
the Stripe credentials.

The production boot gate refuses to start without the Supabase URL + anon key:
**staff sign-in _is_ this app**, and without them every page degrades to an
unusable login screen rather than an actionable error.
