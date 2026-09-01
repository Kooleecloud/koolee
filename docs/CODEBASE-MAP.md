# Koolee — Codebase Map

> A teaching map of the repo, written chapter by chapter. Map level, not
> reference level: concepts, flows, and pointers to the files that hold the
> detail. For _what is shipped / what is next_, read
> [PROJECT-STATUS.md](../PROJECT-STATUS.md). For _how to run it_, read
> [README.md](../README.md).
>
> Baseline: `dev` @ `5db21a4`.

## Chapters

| #   | Chapter                                                             | Status |
| --- | ------------------------------------------------------------------- | ------ |
| 1   | [The product & its nouns](#chapter-1--the-product--its-nouns)       | ✅     |
| 2   | [Repo map & boundaries](#chapter-2--repo-map--boundaries)           | ✅     |
| 3   | [Data model & migrations](#chapter-3--data-model--migrations)       | ✅     |
| 4   | [Domain core I — the rules](#chapter-4--domain-core-i--the-rules)   | ✅     |
| 5   | [Domain core II — the seams](#chapter-5--domain-core-ii--the-seams) | ✅     |
| 6   | [Customer funnel](#chapter-6--customer-funnel)                      | ✅     |
| 7   | [Auth](#chapter-7--auth)                                            | ✅     |
| 8   | [Payments end-to-end](#chapter-8--payments-end-to-end)              | ✅     |
| 9   | [Agent PWA](#chapter-9--agent-pwa)                                  | ✅     |
| 10  | [Admin ops console](#chapter-10--admin-ops-console)                 | ✅     |
| 11  | [UI package & brand](#chapter-11--ui-package--brand)                | ✅     |
| 12  | [Testing & env matrix](#chapter-12--testing--env-matrix)            | ✅     |
| 13  | [Deployment picture](#chapter-13--deployment-picture)               | ✅     |

---

## Chapter 1 — The product & its nouns

**The claim.** Koolee picks luggage up at the customer's door in NYC and
delivers it to their airline's bag drop at JFK / LGA / EWR. Not check-in, not
TSA, not the aircraft — the bag drop counter. That boundary is a copy rule
enforced across marketing, UI, SMS and email ([README §Copy rules](../README.md#copy-rules)).

**The nouns**, and the table each one lives in:

| Noun                  | Table                                | What it is                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Booking               | `bookings`                           | One customer, one flight, one pickup window. The spine everything hangs off.                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Draft                 | `booking_drafts`                     | A booking-in-progress before auth/payment. Survives page reloads and anonymous → real-user upgrade.                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Bag                   | `bags`                               | One physical bag. Weight, photos, a `seal_id`, and an `ordinal` (`1..bag_count`) — the number a human reads off the tag. Order and label by `ordinal`, never by array position: a booking's bags share `created_at` to the millisecond.                                                                                                                                                                                                                                                                               |
| Seal                  | `bags.seal_id`                       | Opaque tamper-evident ID. Deliberately technology-agnostic (RFID vs printed QR is still undecided — no migration either way).                                                                                                                                                                                                                                                                                                                                                                                         |
| Custody event         | `custody_events`                     | Append-only chain of custody: who held which bag, where, when, with photo evidence.                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Pickup window         | _(none — computed)_                  | The hour the agent comes. **Not a row.** Every flight gets the same 24 clock-aligned one-hour windows, enumerated on demand; the booking stores the one it bought in `bookings.pickup_window_start/end`.                                                                                                                                                                                                                                                                                                              |
| Blackout              | `slot_blocks`                        | Ops hiding a span of windows at an airport (weather, no drivers). The only lever over what customers can book.                                                                                                                                                                                                                                                                                                                                                                                                        |
| Cutoff                | `airline_cutoffs`                    | Per airline × airport × domestic/international — the latest a bag can be dropped. One of the two deadlines that bound the window band.                                                                                                                                                                                                                                                                                                                                                                                |
| Task                  | `verification_tasks`, `pickup_tasks` | The unit of work an agent or driver sees.                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Payment               | `payments`, `payment_webhook_events` | Intent → authorize → capture. Webhook events table is the replay guard.                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Staff member          | `staff_members`                      | Invite-only agent/admin accounts.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Agreement version     | `agreement_versions`                 | The terms a customer accepts, versioned. **"Current" is DERIVED** — `max(version)` where `effective_from <= now()`. There is no `is_active` column and there must not be one. The body is markdown rendered by ONE component (`packages/ui/src/components/markdown.tsx`) everywhere it appears — the customer's inline card, the printable page, and the console's read-only version view. **Zero published versions is a total outage**: the identity gate fails closed for every booking, so the console banners it |
| Agreement acceptance  | `agreement_acceptances`              | Append-only evidence that a named person accepted a specific version for a specific booking, with whatever the request carried (`user agent`, `ip`) and nothing invented. UNIQUE `(booking_id, agreement_version_id)` makes re-accepting a no-op.                                                                                                                                                                                                                                                                     |
| Passport verification | `passport_verifications`             | One per booking. A private-bucket photo PATH and three statuses — and **nothing about the document**: no number, name, DOB, nationality or MRZ, ever. The row has to be worthless to anyone who can read it.                                                                                                                                                                                                                                                                                                          |
| Waitlist signup       | `waitlist_signups`                   | One (email, ZIP) pair — "this person wants service in this zone." Unique together; `notified_at` stamps the one promised "you're covered" email.                                                                                                                                                                                                                                                                                                                                                                      |
| Truck                 | `trucks`                             | A van, and how many bags it holds. `reserved_spaces` is **held back from booking capacity** — `bookableSpaces()` in `driver-selection.ts` is the one formula, and four readers share it.                                                                                                                                                                                                                                                                                                                              |
| Shift                 | `driver_shifts`                      | One person, in one truck, for one stretch of the day. Two partial unique indexes (`WHERE ended_at IS NULL`) make "one open shift per person, one per truck" true under concurrency.                                                                                                                                                                                                                                                                                                                                   |
| Driver position       | `driver_positions`                   | One **mutable** row per driver, overwritten every 20s while a driver is en route to a door and every 45s once the bags are aboard. Explicitly **not** chain of custody — a position is not evidence.                                                                                                                                                                                                                                                                                                                  |
| Booking signal        | `booking_signals`                    | The realtime **doorbell**: one mutable row per booking, three columns, the only table a browser may read. A change says "something moved"; the payload is never rendered.                                                                                                                                                                                                                                                                                                                                             |
| Push subscription     | `push_subscriptions`                 | One row per (person, browser install). Unique on `endpoint` **alone**, so a device that changes hands moves to its new owner instead of notifying the old one.                                                                                                                                                                                                                                                                                                                                                        |
| Agent zone            | `agent_zones`                        | Which ZIPs an agent covers — what auto-assign picks from.                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ZIP centroid          | `zip_centroids`                      | 837 US-Census ZIP → coordinate rows. Covers a **wider** area than coverage does, so an out-of-zone driver still resolves to a position.                                                                                                                                                                                                                                                                                                                                                                               |
| Pricing rule          | `pricing_rules`                      | The active price. Exactly one may be active (`0020`), and it is edited at the admin console, never in SQL.                                                                                                                                                                                                                                                                                                                                                                                                            |
| Ticket upload         | `ticket_uploads`                     | A customer's uploaded PDF and what extraction read from it. Feeds a **quarantined** prefill, never a booking field.                                                                                                                                                                                                                                                                                                                                                                                                   |
| OTP send log          | `otp_send_log`                       | Throttle rows keyed by a **hashed** destination (`OTP_LOG_HMAC_KEY`) — the log must be worthless to anyone who can read it.                                                                                                                                                                                                                                                                                                                                                                                           |

**The lifecycle.** Ten booking statuses, and the legal moves between them are
defined in exactly one place — [state-machine.ts](../packages/core/src/booking/state-machine.ts).
Postgres only guarantees the _set_ of values; ordering is core's job.

```
draft → paid → agent_assigned → verified_sealed → awaiting_pickup
      → in_transit → delivered_to_bagdrop → completed
```

with `exception` reachable from every live state and `cancelled` reachable
until the bags leave the customer.

Two rules worth memorising, because they shape a lot of downstream code:

1. **`cancel` disappears at `in_transit`.** Once a driver physically has the
   bags, cancellation is not a real-world event — that situation is an
   `exception` and needs a human in the admin console.
2. **`completed` and `cancelled` are terminal.** There is no reopen. A reopen
   is a new booking.

**Who touches what.** Three apps map onto three phases of that lifecycle:
`apps/web` (customer: draft → paid), `apps/agent` (field: agent_assigned →
verified_sealed → in_transit), `apps/admin` (ops: assignment, exceptions,
force-complete).

**The money moves once.** Payment is _authorized_ at booking, then _captured_
once the bags are in our custody — not before, and never on the agent's
device: the agent app holds no payment credentials, so a sweep in `apps/web`
does it within ~5 minutes of the visit completing. Cancellation before pickup
voids the auth or refunds. That's why `paid` in the state machine means
"authorized", not "we have the money".

---

## Chapter 2 — Repo map & boundaries

**The shape.** A pnpm + Turborepo monorepo: three Next.js apps over two shared
packages, plus a UI kit.

```
apps/web      customer: marketing site + booking funnel + account area
apps/agent    field PWA: the agent's task list and verification visit
apps/admin    ops console: dispatch, exceptions, blackouts, staff

packages/core  ALL domain logic. No Next.js, no env reads, no framework.
packages/db    Drizzle schema, migrations, seed, two connection helpers.
packages/ui    Shared components + the Tag-K brand primitives.
packages/config Shared eslint/tsconfig/tailwind bases.
```

**The one boundary that matters.** Apps may not import `@koolee/db`. The app
ESLint config forbids it. Every read and write goes through a `@koolee/core`
service, which is why row types are re-exported from
[core's index](../packages/core/src/index.ts) — an app can name a `Booking`
without being able to query one.

This is not ceremony. It is what makes three apps share one set of rules: the
cutoff maths, the state machine, and the ownership checks live in one place,
and no app can route around them by writing its own SQL.

**The second boundary.** `packages/core` takes its credentials as values and
imports nothing from Next.js. Apps resolve their own in a zod-validated
`env.ts` and hand the results to core as a `CoreConfig`
([config.ts](../packages/core/src/config.ts)). That is what makes core
testable without a process environment and reusable from a job runner.

There is exactly **one** exception to the no-`process.env` rule, named here
rather than left as a claim that is quietly false:
[auth/hash-destination.ts](../packages/core/src/auth/hash-destination.ts)
reads `OTP_LOG_HMAC_KEY` directly and throws when it is unset. Every other
seam — payments, notifications, extraction, events — is injected.

**Where a feature actually lives.** A typical change touches three layers in
this order — schema (`packages/db/src/schema/`), rule + service
(`packages/core/src/`), then a page and a server action in one app. If a
change needs no core edit, it is usually presentation; if it needs no app
edit, it is usually policy.

---

## Chapter 3 — Data model & migrations

**Schema files** live in [packages/db/src/schema/](../packages/db/src/schema/),
one file per concern, re-exported through `index.ts`:

| File             | Tables                                                |
| ---------------- | ----------------------------------------------------- |
| `identity.ts`    | `users`, `addresses`                                  |
| `geo.ts`         | `zip_centroids`                                       |
| `airports.ts`    | `airports`, `airline_cutoffs`                         |
| `bookings.ts`    | `bookings`, `bags`                                    |
| `slots.ts`       | `slots` _(legacy — see below)_                        |
| `slot-blocks.ts` | `slot_blocks`                                         |
| `custody.ts`     | `custody_events`                                      |
| `signals.ts`     | `booking_signals` _(the realtime doorbell)_           |
| `push.ts`        | `push_subscriptions` _(one row per browser install)_  |
| `tasks.ts`       | `verification_tasks`, `pickup_tasks`                  |
| `billing.ts`     | `payments`, `pricing_rules`, `payment_webhook_events` |
| `drafts.ts`      | `booking_drafts`                                      |
| `uploads.ts`     | `ticket_uploads`                                      |
| `staff.ts`       | `staff_members`                                       |
| `otp.ts`         | `otp_send_log`                                        |
| `ops.ts`         | `trucks`, `driver_shifts`, `driver_positions`         |
| `agreements.ts`  | `agreement_versions`, `agreement_acceptances`         |
| `passport.ts`    | `passport_verifications`                              |
| `waitlist.ts`    | `waitlist_signups`                                    |
| `zones.ts`       | `agent_zones` _(ZIP coverage auto-assign picks from)_ |

Four files in that directory hold no table: `columns.ts` (the shared column
builders — `timestamptz`, `primaryId`, `createdAt`, `updatedAt`), `enums.ts`,
`relations.ts`, and the `index.ts` barrel.

**Three tables were dropped, not renamed.** `agents`, `drivers` and `routes`
shipped in `0000_init` and were never used by anything — zero rows in every
environment, zero reads and zero writes outside `schema/` and `relations.ts`,
and `routes` never even gained a route↔booking link. Migration `0029` removed
them and `identity.ts` carries a note where they were. Staff identity is
`users` + an active `staff_members` row; nothing resolves an "agent id" or a
"driver id", which is why `AgentSession` no longer carries either.

Two non-table modules live beside the schema, both pure data with zero imports
and both reached through their own package subpath so a client bundle that
touches them never pulls the Postgres driver in behind it:

- `coverage-zips.ts` (`@koolee/db/coverage-zips`) — the service area, imported
  by core's coverage logic AND the seed. Data here, semantics in core: the seed
  needs the list and core depends on db, never the reverse.
- `zip-centroids.ts` (`@koolee/db/zip-centroids`) — 837 ZIP → coordinate rows
  from the **US Census 2023 ZCTA gazetteer**, the payload the seed loads into
  `zip_centroids`. RUNTIME READS THE TABLE, not the file; the file is what the
  seed reconciles the table to, and migration `0028` carries a snapshot of it so
  its address backfill has something to join against before any seed runs. It
  covers a WIDER area than coverage does on purpose, so an out-of-zone driver
  still resolves to a position.

**The legacy table.** `slots` predates virtual pickup windows. Nothing sells
from it; new bookings leave `slot_id` NULL and carry
`pickup_window_start/end` instead. It survives only so pre-cutover bookings
keep their foreign key. Do not add to it — see Chapter 4.

**Invariants worth memorising:**

- `custody_events` is append-only, enforced by a database trigger that
  rejects `UPDATE` / `DELETE` / `TRUNCATE`. Corrections are new rows. This is
  the evidentiary spine of the product; if it were mutable it would be
  worthless in a dispute. Since `0030` it also carries an AFTER INSERT trigger
  that touches `booking_signals` — the only write path that is not a service
  call, and deliberately so: ~20 services append custody events and none of
  them should have to know a realtime table exists.
- `booking_signals` is a DOORBELL, not data. One mutable row per booking, three
  columns, overwritten in place, and the ONLY table in the product a browser
  may read. A client learns that a booking changed and refetches through the
  ordinary server path; nothing in a realtime payload is ever rendered. Same
  "not evidence" rule as `driver_positions`, and for the same reason.
  `0031` grants `SELECT` to `authenticated` — a policy without the grant is
  silently dead, which cost this feature a whole verification pass. See
  [features/realtime-signals.md](features/realtime-signals.md).
- **Reuse before you build.** Check `packages/ui` before writing any input,
  control or layout piece, and lift one there as soon as a second app needs it.
  `DateTimeField` and `@koolee/ui/lib/photo` are the worked examples; see
  PROJECT-STATUS §7.
- `agreement_versions` rows are IMMUTABLE once `effective_from` has passed
  (trigger, migration `0024`). A future-dated version is editable because it
  cannot have been accepted — `acceptAgreement` only ever resolves the current
  version — which is why scheduling doubles as the draft mechanism.
- `agreement_acceptances` holds at most ONE row per booking (`UNIQUE
booking_id`, migration `0025`): the version a booking accepts pins for the
  life of that booking, so a second row would mean a booking bound to two
  documents. 0025 REFUSES to migrate if duplicates exist rather than deleting
  them — they are append-only evidence, and which acceptance governs is a
  human decision.
- `agreement_acceptances` is append-only too, by the same trigger mechanism
  and for the same reason: it is evidence that a named person agreed to
  specific terms at a specific instant, and there is no such thing as
  correcting that. A change of terms is a new version and a new acceptance.
- **A booking carries its own pickup address** (`0033`). Eight `pickup_*`
  columns are snapshotted onto `bookings` at creation; `pickup_address_id` is
  demoted to provenance and goes `NULL` when the customer deletes the saved
  address. This exists so an address CAN be deleted — before it, a saved
  address was permanent because a booking depended on it. Every reader takes
  the doorstep off the booking; a join to `addresses` is a bug that will look
  fine until the first deletion.
- `driver_shifts` carries TWO partial unique indexes (`WHERE ended_at IS NULL`)
  — one open shift per person, one per truck. They are the only thing between
  two taps on "Start shift" and two people dispatched to the same van;
  `startShift` catches `23505` and re-reads to say WHICH half collided, because
  "you already have a shift" and "that van is out with Nina" want different
  actions from a driver.
- `driver_positions` is the first HIGH-WRITE, MUTABLE, NON-EVIDENTIARY table in
  the schema, and it looks enough like custody data to be mistaken for it. One
  row per driver, overwritten every 20–45 seconds, no history. `custody_events`
  is the evidence; this answers "how far away is my driver right now" and
  nothing else. Its header says so — leave that there.
- `pickup_tasks` has two assignment columns and they must never disagree.
  `driver_shift_id` is the real target; `assignee_user_id` is kept because six
  readers key on it (`getAssignedTask`, `listAssignedTasks`,
  `agentHasTaskForBooking`, `listAgentBookingIds`, the auto-assign load count,
  `listAgentWorkload`). Every write sets both, in the same statement.
- `staff_members.role` is still CHECK-constrained to `agent | admin`, and the
  `user_role` enum still contains an unused `driver`. That is deliberate:
  driving is `can_drive`, a capability alongside the role. See PROJECT-STATUS §7.
- `passport_verifications` carries no field describing the passport. This is a
  hard rule, and an integration test asserts it against `information_schema`
  rather than against the TypeScript type — the catalog is what actually
  exists. A validity checker returns a STATUS, never the fields it read.
- A storage policy needing the staff roster calls
  `public.is_active_staff(auth.uid())` (migration `0009`), never an inline
  `EXISTS (… staff_members …)`: the subquery is evaluated as `authenticated`,
  which has no privilege on that table, and raises `permission denied`. Got
  wrong twice now — `0008` (fixed by `0009`) and `0022` (fixed by `0023`).
- Storage buckets are **declared, never created at runtime**. All four live in
  `BUCKETS` ([uploads/buckets.ts](../packages/core/src/uploads/buckets.ts)) and
  migration `0026` upserts them with `ON CONFLICT DO UPDATE`, so re-applying
  converges instead of no-op'ing. Every one is `public = false`, re-asserted on
  every apply. A test parses the SQL and fails on drift, and enforces the rule
  that a bucket's `file_size_limit` is never BELOW the app's own check — the
  inverse makes Storage reject a file the app accepted, and the customer reads
  a generic error instead of a size message. See
  [storage-and-avatars](features/storage-and-avatars.md).
- `uploads/buckets.ts` imports **nothing**, on purpose. Client components read
  those limits to size a file picker, and the module's one import used to reach
  `@koolee/db` → `postgres` → `fs`, which broke every app's build. Client code
  reaches it as `@koolee/core/uploads`, never the package barrel.
- `payments (provider, provider_ref)` is unique — the idempotency key that
  makes webhook redelivery a no-op.
- `bags.seal_id` is unique **partially** (`WHERE seal_id IS NOT NULL`,
  migration `0017`), scoped to the whole table rather than one booking: a
  tamper-evident seal is single-use stock, so its printed id identifies exactly
  one bag operation-wide. Partial because unsealed bags all hold `NULL` and must
  not collide. `bags (booking_id, ordinal)` is unique for the ordering reasons
  in Chapter 1.
- `bookings.price_breakdown` is a jsonb snapshot of what the pricing engine
  computed at booking time. `price_cents` is the authoritative charge; the
  snapshot is the receipt, and the raw material for pricing analysis.
- `verification_tasks` and `pickup_tasks` are separate tables even though one
  person often does both — different SLAs, different evidence. Collapsing
  them would make "verified but not yet collected" unrepresentable.

**Migrations** are Drizzle-generated SQL in
[packages/db/drizzle/](../packages/db/drizzle/), numbered and journalled in
`meta/_journal.json`. `pnpm db:generate` diffs the schema and writes one;
`pnpm db:migrate` applies pending ones over the **direct** connection.

Two rules, both learned the hard way:

1. **Never migrate over the pooler.** The migrator takes an advisory lock and
   issues DDL; both need a stable backend. `DIRECT_DATABASE_URL` (port 5432),
   never the Supavisor pooler (6543). `migrate.ts` prints the target host
   before it runs — read that line.
2. **`packages/db/.env` points at LOCAL** (changed 2026-08-22 — it used to
   point at hosted, and a bare `pnpm db:migrate`/`pnpm seed` silently
   targeting production is exactly the accident the flip prevents). Hosted is
   reached only by overriding `DIRECT_DATABASE_URL` inline; the shell always
   beats dotenv. Both tools print `Target host:` first — read it every time.

**Never trust prose for migration state, including this file's.** `pnpm
db:status` is the tool: read-only, safe against production, and it compares
CONTENT HASHES rather than row counts. See
[PROJECT-STATUS §3.1](../PROJECT-STATUS.md).

**The seed** ([seed.ts](../packages/db/src/seed.ts)) is idempotent reference
data only — airports (now with coordinates), 837 ZIP centroids, airline
cutoffs, one pricing rule, two dev trucks, and one booking agreement version
(v1, placeholder copy) so the identity gate can resolve. It seeds no bookings
and, since windows went virtual, no inventory. There is nothing in it that can
go stale with the calendar.

It also seeds **no shifts**, deliberately: an open shift asserts "somebody is
out driving right now", and seeding one puts phantom drivers in front of
customers on a machine nobody is driving from.

---

## Chapter 4 — Domain core I — the rules

Four rule modules carry essentially all of the product's liability. Every one
is pure: same inputs, same outputs, no I/O, no clock except an injected one.

### The state machine

[booking/state-machine.ts](../packages/core/src/booking/state-machine.ts) —
ten statuses × eleven events, and the matrix is the single source of truth
for which moves are legal. A transition returns both the new status and the
`custody_events` row that records it, so movement and evidence cannot drift
apart.

The two rules from Chapter 1 (`cancel` disappears at `in_transit`;
`completed`/`cancelled` are terminal) are encoded here, not enforced by
convention.

### Cutoff maths

[slots/cutoff.ts](../packages/core/src/slots/cutoff.ts) — the deadline
arithmetic:

```
latest pickup start = departure − airline cutoff − drive time − buffer
```

Two policies make this trustworthy. **All arithmetic is on absolute
instants** (`date-fns` `subMinutes`), which is DST-correct by construction;
wall-clock arithmetic would be off by an hour across a transition, in the
_unsafe_ direction on spring-forward. **Timezones enter only at the display
edge** — `formatWindowInAirportTz`, `formatTimeInAirportTz`, `airportLocalDay`,
`airportLocalInstant` are the only functions that know what a timezone is. The
full formatter table is in [TIME.md](TIME.md#how-to-render).

`resolveCutoffMinutes` throws when no cutoff is on record for an
airline × airport × scope. A guessed cutoff is worse than no sale: it is how
bags miss flights.

**The corollary for every UI that shows a time.** Production servers run in
UTC, so _server-local_ is not a neutral default — it is Eastern minus four or
five hours. A dispatcher reading a 6 PM window as 22:00, or a "today" bucket
that opens at 8 PM the previous evening, mis-plans a whole shift. Ops screens
therefore state their zone explicitly (`AIRPORT_TZ` in the admin app) and
bucket days with `airportLocalDayBounds`, never `setHours(0,0,0,0)`.

### Virtual pickup windows

[slots/windows.ts](../packages/core/src/slots/windows.ts) — windows are
**computed, not stored**. For a flight departing at T, the band is the 24
clock-aligned one-hour windows whose _end_ falls in
`(T − 30h, T − 6h]`. That half-open interval yields exactly 24 windows for
any departure time, on the hour or not.

What limits a customer is never stock:

| Fence              | Default | Why                                                                                                             |
| ------------------ | ------- | --------------------------------------------------------------------------------------------------------------- |
| Operations reserve | 6 h     | The final hours belong to sealing, driving, bag drop. Applied as the _stricter_ of this and the cutoff formula. |
| Band length        | 24 h    | Bags are collected close to the flight, not days ahead.                                                         |
| Booking notice     | 2 h     | A driver has to be dispatchable. Only bites for same-day bookers.                                               |
| Blackouts          | —       | `slot_blocks` rows; ops hiding hours without touching existing bookings.                                        |

There is deliberately **no capacity**. Two customers picking the same window
both succeed. That is a product decision, not an oversight — re-introducing
seat counts would need a new schema _and_ a new concurrency story.

`enumerateHourlyWindows` returns the whole band with a reason on each
unbookable entry; `evaluateHourlyWindow` is the acceptance check
`createBooking` runs. They share one classifier, which is what makes
_displayed implies accepted_ a property the test suite can assert rather
than a hope.

### Pricing

[pricing/engine.ts](../packages/core/src/pricing/engine.ts) — pure and total,
integer cents end to end:

```
subtotal = base + (perBag × bags) + round(centsPerKm × distanceKm)
timed    = round(subtotal × leadTimeMultiplier)
total    = max(0, timed − discounts)
```

The lead-time multiplier is the **dynamic-pricing seam**. Today
`resolveLeadTimeMultiplier` walks a step curve stored on the pricing rule
(launch: ≤10 h ×1.4, ≤16 h ×1.2, ≤24 h ×1.1, else ×1) keyed on
`pickupLeadMinutes` — minutes from the window's _end_ to departure. When the
real algorithm lands it replaces that one function; the breakdown shape, the
per-window display, and the booking snapshot already carry its output.

Because the multiplier depends only on (window, flight) and never on _when_
the customer books, the price shown on the picker is provably the price
charged at checkout. No quote-locking mechanism is needed.

### Coverage

[coverage/nyc-zips.ts](../packages/core/src/coverage/nyc-zips.ts) — a
hardcoded ZIP allowlist (all five NYC boroughs plus Hudson County, NJ;
widened for launch-demo completeness 2026-08). Hardcoded on purpose: the
service boundary is a commercial decision that changes rarely and should be
reviewable in a diff.

---

## Chapter 5 — Domain core II — the seams

Everything external is an interface with a fake implementation, so the whole
product runs and tests without a single third-party credential.

| Seam              | Interface                | Real                                                     | Fake / default                                                    |
| ----------------- | ------------------------ | -------------------------------------------------------- | ----------------------------------------------------------------- |
| Payments          | `PaymentProvider`        | Stripe adapter                                           | `FakePaymentProvider` (in-memory, dev)                            |
| Ticket extraction | `TicketExtractor`        | Claude (`ANTHROPIC_API_KEY`; **required in production**) | Heuristic text-layer parser — **dev only**, always low confidence |
| Email             | `Notifier`               | `ResendNotifier` (REST, injectable fetch)                | `ConsoleNotifier` (logs)                                          |
| SMS dispatch      | `NotificationDispatcher` | _(unbuilt — Twilio later)_                               | `NoopDispatcher` (logs)                                           |
| Ops alerts        | `OpsAlerter`             | _(unbuilt)_                                              | `ConsoleOpsAlerter`                                               |
| Drive-time ETA    | `EtaEstimator`           | _(unbuilt — a routing provider later)_                   | `HaversineEtaEstimator` (ZIP centroids)                           |
| Clock             | `Clock`                  | `systemClock`                                            | `fixedClock(instant)` for tests                                   |
| Sessions          | `SessionReader`          | Supabase per app                                         | injected per request                                              |
| Staff roles       | `assertRole`             | `requireStaffRole`                                       | injected                                                          |

Email selection mirrors the payments factory: apps resolve `RESEND_API_KEY` /
`RESEND_FROM` in their env and pass `createRuntime` a
`notifications: { kind: "resend" | "console", … }` config —
`createNotifier` builds the adapter, core reads no env. Templates are pure
builders in [notifications/emails.ts](../packages/core/src/notifications/emails.ts),
copy rules pinned by tests.

**`PushSender`** ([notifications/push.ts](../packages/core/src/notifications/push.ts))
mirrors `Notifier` exactly — interface, `ConsolePushSender` default,
`RecordingPushSender` for tests. Unlike the notifier it is passed as an
INSTANCE rather than a `{ kind }` config, for the same reason the Inngest
emitter is: the real one needs three VAPID values, which are environment.

⚠️ **The real sender is `@koolee/core/web-push`, a SUBPATH export, and it is
deliberately not in the package barrel**
([notifications/web-push.ts](../packages/core/src/notifications/web-push.ts)).
`web-push` is a Node-only crypto library and anything reachable from
`src/index.ts` can end up in a client bundle. Import it from an app's
server-only `lib/core.ts` and nowhere else.

It lived in `apps/web` first, and that cost a real bug worth remembering: the
agent and admin apps then had **no** real sender, silently fell back to
`ConsolePushSender` — which logs and **reports success** — and their "send me a
test notification" button cheerfully asked "did you see it?" about a
notification that had never been sent. One implementation, three consumers, is
the fix. Core still reads no environment; the three VAPID values arrive as
arguments.

The library does two things it would be reckless to hand-roll: it signs the
VAPID JWT that authenticates Koolee to the push service (FCM, Mozilla autopush,
APNs), and it encrypts the payload with AES128GCM against the subscription's own
keys, so the push service relays ciphertext it cannot read. TTL is 300s — a task
assignment is still worth showing five minutes late; an hour later it is worse
than nothing.

It NEVER throws — every caller is an Inngest step whose email is the
real notification — prunes only on 404/410 (a 5xx is a provider having a bad
afternoon, and pruning on it would unsubscribe people silently), and sets
VAPID details per send rather than at module scope, because that is global
mutable state in the library.

`services/push-subscriptions.ts` holds storage, authorization (**a user
manages only their own devices; the server derives the user from the session,
never from a body**) and the `pushToUsers` / `pushToTargets` fan-out. The ops
audience is DERIVED from active admin `staff_members` — no roster table.

`CoreConfig` ([config.ts](../packages/core/src/config.ts)) is the bundle: db,
payments, dispatcher, alerter, extractor, pushSender, clock, and `defaults`
(`CoreDefaults` — the window fences, `assignmentHorizonHours`, and currency).
Apps build it once per request in their `lib/core.ts`.

**Payments** ([payments/types.ts](../packages/core/src/payments/types.ts)) is
the richest seam: `authorize`, `getAuth`, `updateAuthAmount`, `capture`,
`refund`, `cancelAuth`, and webhook verification. `getAuth` exists because a
client-side success signal is never trusted — see Chapter 8.

**The ETA seam** ([geo/](../packages/core/src/geo/)) is the most opinionated.
`estimate({from, to})` returns a RANGE — `{minMinutes, maxMinutes}` — never a
point, because a drive time is not accurate to the minute and must not be
rendered as though it were. **It is `async`, and so is `estimateMany({from[],
to})`**, the many-origins-one-destination shape the driver shortlist and the
cutoff cron both use: a network provider behind the seam must never become N
serial round-trips inside a `.map`.

Two implementations:

- `HaversineEtaEstimator` — `haversine × 1.5 ÷ 18 km/h`, floored at 5 minutes,
  ±30% widened to whole 5-minute steps, resolving immediately. Its header
  documents a known bias: no notion of a highway, so long airport runs
  over-state. Kept, because it points the safe way for both consumers.
- `GoogleRoutesEtaEstimator` ([geo/routes.ts](../packages/core/src/geo/routes.ts))
  — one `computeRouteMatrix` POST, plain `fetch`, no SDK, key injected as a
  value (`GOOGLE_MAPS_SERVER_KEY`, resolved in `apps/web/src/lib/core.ts`).
  Traffic-aware duration mapped to −15%/+45%: the spread is asymmetric because
  a route can always take longer than predicted and essentially never takes
  dramatically less, and because `cutoffRiskMonitor` consumes the pessimistic
  end. **It never throws.** Any failure — quota, network, revoked key, an
  unroutable origin — falls back to the arithmetic, per origin, with one log
  line. ETA is not load-bearing anywhere.

`geo/eta.test.ts` pins the arithmetic and the seam; `geo/routes.test.ts` pins
the request shape, the mapping and every fallback.

**The pricing distance** ([geo/distance.ts](../packages/core/src/geo/distance.ts)

- [services/quote-distance.ts](../packages/core/src/services/quote-distance.ts))
  is a SEPARATE question from the ETA and answered differently on purpose:
  `quoteDistanceKm` is geometry — great-circle × a calibrated 1.2 road factor —
  and **never a network call**, because a booking is priced three times minutes
  apart (window picker, review page, `createBooking`) and a traffic-aware number
  would move between them. `resolveQuoteDistanceKm` resolves it against the
  database: precise address coordinates, else the ZIP centroid, else the
  per-airport typical (`TYPICAL_AIRPORT_DISTANCE_KM`, which the public pricing
  page imports rather than copies). It replaced the literal `20` at four funnel
  call sites that disagreed with the marketing page by up to $2.70.

**Places autocomplete** ([geo/places.ts](../packages/core/src/geo/places.ts)) is
the third Google adapter and the same shape as the other two: plain `fetch`,
no SDK, key as a value, never throws. `autocomplete(input, sessionToken)` and
`details(placeId, sessionToken)`; the session token is billing, not plumbing —
Google prices a whole typing session as one autocomplete plus one details call
only when every request carries the same token. **The key never reaches a
browser**: the funnel posts to [`/api/places`](../apps/web/src/app/api/places/route.ts),
which requires a draft cookie, enforces a length floor and holds the key
server-side. `details` returns null rather than guessing a missing component —
a suggestion with no ZIP cannot be reconciled against the quoted ZIP.

**Services** ([services/](../packages/core/src/services/)) are the app-facing
API: `create-booking`, `windows` (window listing + blackout CRUD), `quote`,
`quote-distance`, `pricing-rules` (publish a new rule, never edit the live one),
`airline-cutoffs` (the 128-row matrix, with the placeholder count that IS the
launch-readiness number),
`bookings` (transitions + session-scoped reads), `dispatch`, `payment-intent`,
`payment-lifecycle`, `agent-visit`, `pickup` (the driver's run),
`shifts` (clock on/off, the fleet, force-end), `driver-selection` (the
customer's shortlist, the assignment, GPS upsert), `customers`, `addresses`,
`booking-drafts`, `ticket-uploads`, `avatars`, `avatar-visibility` (whose face
a viewer may see — the control that replaced a comment), `booking-signals`
(the realtime doorbell's one explicit writer), `trips` (the customer's Upcoming
/ Past split and what each booking is waiting on THEM for),
`profile-completeness`, `staff-history` (derived counts, no bookkeeping),
`staff`, `tasks`, `webhooks`, `actionability`. Two more
modules sit beside `services/`: `waitlist/` (`recordWaitlistSignup` — the
idempotent (email, zip) upsert behind both capture surfaces — and
`notifyNewlyCoveredWaitlist`, the zone-opened sweep's engine) and
`auto-assign` in `services/` whose `autoAssignOnPaid` hook fires from every
path a booking takes to `paid` (webhook, return-page re-check, fake-provider
inline) — never throws, never fails the payment path; the 0019 unique
indexes referee the webhook/re-check race.

**Assignment waits for a horizon.** `autoAssignOnPaid` assigns immediately
only when the pickup window is within `defaults.assignmentHorizonHours`
(default 48, env `ASSIGNMENT_HORIZON_HOURS`); beyond it the booking rests in
`paid` with NO verification task and NO pickup task, and
`assignEnteringHorizon` — the `assignment-horizon-sweep` cron — picks it up
when the window comes into range. The predicate lives alone in
[services/assignment-horizon.ts](../packages/core/src/services/assignment-horizon.ts)
because three callers need it and two of them would otherwise form an import
cycle: the sweep, the on-paid hook, and `dispatch.ts`'s at-risk flag, which
must agree with the other two or the console shows red badges for work the
system is correctly not doing yet.

**`actionability` is the answer to "can this still be acted on?", and it is
the only one.** Before it, five services each carried their own status array
and none of them knew about time: a `paid` booking whose flight left an hour
ago is still `paid`, so it kept accepting agreements, taking passport uploads
and offering a driver shortlist. `getBookingActionability(db, booking, now)`
returns two independent axes — **standing** (`active` · `in_transit` ·
`handed_over` · `exception` · `terminal`) and **phase** (`before_window_end` ·
`running_late` · `missed_cutoff` · `departed`) — plus five named permissions
and the one sentence every surface renders. Collapsing the axes would lose the
case that matters: twenty minutes past the pickup window is late and
salvageable, twenty minutes past the bag-drop cutoff is not.

`assertActionable` is the enforcement, wired into `acceptAgreement`,
`recordCustomerUpload`, `listCandidateDrivers`, `selectDriver`, `arriveAtVisit`
and `startPickupTravel`. A blocked attempt past the deadline raises the
existing exception path **exactly once** — not by counting, but because
`applyTransition` guards on `WHERE status = from` and `raisesException` is
false once the row is already `exception`. Nothing is stored: every anchor is
already on the booking or in `airline_cutoffs`.

**In-flight physical work is carved out by construction.** The five gated
actions all belong to the phase before custody transfers; the driver's own
steps (`scanSealAtPickup`, `deliverToBagdrop`, `confirmAirlineHandover`) call
none of them, so a van already moving keeps moving with no exemption logic
anywhere. The one place it needed care is `startPickupTravel`, where the
idempotency check sits deliberately BEFORE the gate. Ops still sees it —
`cutoffRiskMonitor` already scans `in_transit` bookings every five minutes.

A service is where ownership is enforced. Session-scoped reads are
404-shaped on a foreign id — existence is itself a disclosure — and the
`…ForSession` suffix marks the functions that carry that guarantee.

**Jobs** are eleven Inngest functions, all served from apps/web
([api/inngest/route.ts](../apps/web/src/app/api/inngest/route.ts)) — nine in
[jobs/functions.ts](../packages/core/src/jobs/functions.ts) plus two defined in
[apps/web/src/lib/inngest.ts](../apps/web/src/lib/inngest.ts):

| function                      | trigger                              | live?                                            |
| ----------------------------- | ------------------------------------ | ------------------------------------------------ |
| `capture-due-bookings`        | `cron("*/5 * * * *")`                | yes — charges cards once bags are in custody     |
| `cutoff-risk-monitor`         | `cron("*/5 * * * *")`                | yes                                              |
| `cleanup-anonymous-users`     | daily 04:00 ET                       | yes                                              |
| `booking-confirmation-email`  | event `booking/confirmed`            | yes — real email via the Notifier seam           |
| `booking-pickup-reminder`     | event `booking/confirmed`            | yes — email real, SMS console until Twilio       |
| `exception-ops-alert-email`   | event `booking/exception_raised`     | yes — to `OPS_ALERT_EMAIL`, now required in prod |
| `waitlist-zone-opened-sweep`  | daily 10:00 ET                       | yes — the waitlist's promised email              |
| `agent-no-show-check`         | event `booking/agent_no_show_check`  | **never fires** — that event is still unsent     |
| `driver-selected-email`       | event `booking/driver_selected`      | yes — "your driver is on it", no ETA on purpose  |
| `bagdrop-delivered-email`     | event `booking/delivered_to_bagdrop` | yes — the bags reached the airline's bag drop    |
| `driver-pool-empty-ops-alert` | event `booking/driver_pool_empty`    | yes — to `OPS_ALERT_EMAIL`, one per booking/hour |
| `assignment-horizon-sweep`    | `cron("*/5 * * * *")`                | yes — assigns bookings entering the 48h horizon  |

**Push rides inside these functions, never beside them.** Eight moments send a
push in their own `step.run`, placed AFTER the email step and never inside it:
the email is the guaranteed channel, Inngest memoizes steps independently (so
a retried email does not re-send the push), and the function still returns the
email's result. Customer milestones all carry `booking:<id>` + `renotify`, so
the latest REPLACES the previous — one live notification per booking. Staff
work uses a per-task tag and stacks. Deep links come from
[notifications/links.ts](../packages/core/src/notifications/links.ts), the same
module the emails use.

The three driver functions are registered in **core's** shared factory, not in
the app that raises them. The agent app's Inngest client is send-only by design
(it serves no `/api/inngest` route), so a function added there would silently
never run.

`booking/driver_pool_empty` is raised from a RENDER — the trip page raises it
whenever it has nothing to offer — and its throttle is the **event id**,
bucketed by UTC hour. Inngest drops a repeated id, so that is the entire rate
limit: no table, no cleanup, nothing to get out of sync.

**Where the events come from.** `booking/confirmed` is emitted by apps/web
from [lib/booking-events.ts](../apps/web/src/lib/booking-events.ts): every
path to `paid` emits with a deterministic id, keyed on "this call performed
the move" so redeliveries and races never re-fire.

`booking/exception_raised` is emitted by **`packages/core`**, not by an app.
It used to come from the Stripe webhook route alone, which meant six of the
seven states that can raise an exception produced no ops alert — an agent
flagging a problem at the customer's door was silent. Emission now sits at the
two transaction choke points that are the only ways a booking row reaches
`exception`: `applyTransition`
([services/bookings.ts](../packages/core/src/services/bookings.ts)) and the
webhook handler's own `moveBooking`
([services/webhooks.ts](../packages/core/src/services/webhooks.ts)). A new
path into `exception` is therefore covered by construction.

Core stays queue-agnostic through the **`EventEmitter` seam**
([events/emitter.ts](../packages/core/src/events/emitter.ts)) — same shape as
the `Notifier` seam, defaulting to `NoopEmitter`. Each app builds the
Inngest-backed adapter in its own `lib/event-emitter.ts` and injects it via
`createRuntime`, because an event key is environment and core reads none.
apps/agent and apps/admin are **send-only**: they emit but serve no
`/api/inngest` route, since a second serve endpoint would double-register
every function. Emission never throws — the booking has already moved, and
failing the caller would report a transition that demonstrably happened as an
error. See
[features/jobs-and-notifications.md](features/jobs-and-notifications.md).

`booking/agent_no_show_check` is the one still-unsent event.

Inngest rather than a plain cron service because the reminder uses
`step.sleepUntil` — a durable per-booking delay (sleep until 2h before pickup,
then send). Cloud Scheduler / Vercel Cron / `pg_cron` cannot suspend and
resume a run; replacing that needs Cloud Tasks, EventBridge Scheduler, or a
Postgres-backed queue. The 5-minute crons are scheduler-agnostic: each has an
authenticated route (`/api/jobs/…` behind `CRON_SECRET`) that any scheduler
can drive.

---

## Chapter 6 — Customer funnel

**Four visible steps**, defined once in
[booking-steps.ts](../apps/web/src/lib/booking-steps.ts):

```
/book/flight  → /book/pickup → /book/slot → /book/pay
ZIP + flight    address+bags    window       review + verify + pay
```

`/book` itself is a route handler, not a page: it rehydrates the funnel cookie
from the server draft row and redirects to the first incomplete step, which is
what makes a draft resumable across devices.

**Out-of-coverage is a fork, not a dead end.** An uncovered ZIP at the flight
step swaps in an email-capture card, and the marketing `/waitlist` page offers
the same signup standalone (ZIP required there — the row IS the per-zone
demand signal). Both persist through core's `recordWaitlistSignup` into
`waitlist_signups`, idempotently — resubmitting never errors and never leaks
"already registered". The promised follow-up ("the one email that says you're
covered") is the daily zone-opened sweep in Chapter 5's jobs table.

**The unlock model** is pure and unit-tested: a step is unlocked when every
step before it is complete. Completed steps stay clickable so a customer can
jump back and edit; locked steps are neither linked nor named. Every submit
redirects to `nextIncompleteStep(draft)`, so an edit from step 4 lands back at
step 4 rather than re-walking the funnel.

**Draft state lives in two places, deliberately.** A signed cookie
(`booking-draft.ts`, validated by
[booking-draft-schema.ts](../apps/web/src/lib/booking-draft-schema.ts)) is the
working copy; a `booking_drafts` row mirrors it for cross-device resume, with
an inactivity TTL and a soft delete. Cookie writes happen in server actions,
which invalidates the router cache — that is why the stepper and the summary
rail re-render on every submit without any client state.

**The one cross-step dependency.** The chosen window was priced and validated
against a specific flight. If `submitFlight` sees a change that moves the band
(airport, departure time, airline, scope), it clears the window from the
draft, which re-locks the pay step and routes the customer back through the
window step. Nothing else in the funnel has an ordering constraint.

**Ticket upload** is a side path: `/api/ticket-uploads` stores the PDF in a
private bucket — created by migration `0026` like every other bucket, no
longer by the route itself — runs extraction, and writes the result into a
_quarantined_ `ticketPrefill` key. Only the flight review form reads it, as editable
defaults. Confirming that form is what promotes user-confirmed values into
real draft keys — extracted values never reach a booking field unseen.

**Which extractor runs is one env var, and it used to be invisible.** Both
adapters now stop at READING: they produce a `ReadItinerary` (every leg found,
plus the fields that were dropped and why), and
[read-result.ts](../packages/core/src/extraction/read-result.ts) turns it into
a result — `selectSegment` picks the leg, only a serviced origin may reach the
airport dropdown, and the alternatives offer is computed once for both. The
heuristic used to assemble its own result and never call `selectSegment` at
all, which is why it could not report a second leg or offer a swap. It is now
**never** `confidence: "high"`, and `ANTHROPIC_API_KEY` is a production boot
requirement so it cannot become the production reader by accident
([f1-hosted-setup.md](features/f1-hosted-setup.md) §1).

**The whole itinerary is shown back.** `TicketExtractionResult.legs` carries
every leg read, including the ones departing airports Koolee does not serve,
and the review form lists them — "we read 3 flights on this ticket", with the
prefilled one marked and the others explained. `alternativeSegments` stays the
one-click swap and stays restricted to New York departures: we cannot collect
bags at Heathrow.

**The address ZIP must be the ZIP that was quoted.** The funnel takes a ZIP on
the flight step (coverage + price) and a full address two steps later. They
were never reconciled — any covered ZIP was accepted and silently replaced the
quoted one, changing the `zip_centroids` coordinate every drive-time estimate
starts from and the `agent_zones` row that decides who is dispatched. The
pickup step now offers "update quote to <new ZIP>" or "use a different
address", and `createBooking` takes a **required** `quotedZip` and refuses a
mismatch with `QuoteZipMismatchError`.

**The address field autocompletes, and never gates.**
[address-autocomplete.tsx](../apps/web/src/components/address-autocomplete.tsx)
holds only what is specific to this field — debouncing, the Places session
token, the fetch, and turning a chosen suggestion into the five structured
fields the form already had. The list behaviour (open/closed, arrow keys, ARIA,
dismissal) is `AutocompleteField` in `@koolee/ui`.

⚠️ Every failure path — no key in this environment (the route answers `204`), a
network error, a suggestion whose details come back incomplete — leaves the
customer with exactly the text input they had before, and the form submits it.
**Nothing about the address step depends on Google being up.**

Two billing details are load-bearing, and both were bugs first:

- **One session token per typing session.** Minted client-side, sent with every
  suggest call and with the details call that ends it, then discarded — Google
  bills that as one autocomplete plus one details request instead of one per
  keystroke. A new token is minted after each selection, because the session is
  over.
- **Nothing is searched until somebody types.** The field is frequently mounted
  with a value already in it, and searching on mount billed a Places call per
  mount — ten expands of one saved address was ten identical billed
  autocompletes nobody ever saw.

**A prefilled field is never left unexplained.**
[ticket-prefill-copy.ts](../apps/web/src/lib/ticket-prefill-copy.ts) writes the
sentence above a ticket-filled review form. A round trip has two legs and we
picked one; a ticket out of SFO gets no airport at all — and before this both
cases looked identical to the customer: a form that had simply decided
something, with the airport dropdown sitting on its "JFK" default as though they
had chosen it.

**`/book/processing` makes no claim about the outcome.** It is where a payment
lands when Stripe is still settling (`processing`), or when the status could not
be checked just now. "Check again" re-runs `/book/return`'s server-side
re-check, **which is the only authority**; the draft cookie is untouched, so a
failure can still retry the pay step with everything intact.

**The window step** ([slot/page.tsx](../apps/web/src/app/book/slot/page.tsx))
calls `listBookableWindows`, which returns each window already priced through
the real engine. It renders a grid of time+price tiles grouped by airport-local
day, with one line of explanation. Unbookable windows are not rendered at all —
a greyed-out graveyard only raises questions the customer cannot act on.

**The pay step** shows the full review and price to _anonymous_ visitors, with
the verify gate behind the CTA. The price is never hidden behind auth. The hard
gates live in the server actions (`confirmBooking`, `preparePayment`), never in
the page.

### After the sale — the trip page

[trips/[bookingId]](../apps/web/src/app/trips/) is `force-dynamic` and is where
everything after payment surfaces: the agreement and passport actions, the
pickup card, the chain of custody, the bags and the payment.

Since the driver slice it also carries the **driver section**, which has three
states in the order a customer meets them: a shortlist of up to four drivers to
choose from; "we're assigning your driver" when there is nobody to offer (which
also pages ops behind the scenes — it deliberately does NOT say "no drivers
available", a staffing problem described to the customer as theirs); and, once
chosen, the driver, their distance, an updating ETA and a five-step progress
track.

**Live-ness belongs to the page, not to one card.**
[TripLive](../apps/web/src/components/trip-live.tsx) is a bare component that
renders nothing: it subscribes with `useBookingSignal` and calls
`router.refresh()`. Because the page is `force-dynamic`, that re-runs the whole
server component and everything comes back fresh — timeline, agreement and
passport cards, driver shortlist, ETA. **Nothing from the realtime payload is
read**, which is the rule that keeps authorization in core (Ch.3,
[realtime-signals.md](features/realtime-signals.md)).

It was an interval inside `DriverTracking` first, which meant the page only went
live once a driver had been chosen — an agent sealing bags on the doorstep
changed nothing on the screen the customer was watching. Interval polling
remains the fallback, and it is what the trips **list** runs on, since it has no
single booking to watch.

A deliberately short set of stages also raises a toast — sealed/choose a driver,
in transit, delivered, exception. A silent refresh is right for most changes; a
toast is for the two cases where the page has grown something that needs the
customer, or where staying quiet would be alarming.

**There is a map now**, and the note here used to say there deliberately was
not: "a distance and an updating ETA answer the actual question — how long until
somebody knocks". That was half right. The other question somebody sitting with
sealed bags is asking is **"is anything actually happening"**, and a number that
changes every 45 seconds answers it worse than a pin that moves.

[`LiveMap`](../packages/ui/src/components/live-map.tsx) is **MapLibre GL over
OpenFreeMap** vector tiles — no key, no account, no rate limit, attribution
automatic. Explicitly not Google Maps JS: that is a separate SKU from the Places
and Routes calls this product already makes (Dynamic Maps bills per map _load_
past 10,000/month) and it needs a browser-side referrer-restricted key, which is
a key anybody can read out of the bundle and spend. Today every Google key in
this repo is server-only, and that is worth keeping true. Swapping tile hosts
later is the `styleUrl` prop — one string, not a rewrite.

⚠️ **The map is never a gate.** It mounts lazily, and every failure — tile host
down, no WebGL, a browser that refuses the canvas — leaves the driver list and
the ETA beneath it untouched. Choosing a driver and watching one arrive depend
on nothing rendering.

**Choosing is still a list decision.** Pins are a second route to the same four
cards (click a pin, its card highlights and scrolls into view), because a name, a
van's remaining capacity and an ETA do not fit in a map pin — and those are what
somebody actually chooses on. A driver whose phone has stopped reporting simply
has no pin and keeps their card.

⚠️ **`maplibre-gl` 6 is ESM-only and exports no default.** Import
`{ Map as MapLibreMap, Marker, … }` by name; `import maplibregl from
"maplibre-gl"` type-errors, and under a bundler that papers over it you get
`undefined.Map is not a function` at runtime.

---

### Cancelling, and who did it

`packages/core/src/services/cancellation.ts`. `cancelBookingByCustomer` is
**policy around the existing cancellation, not a second one**: ownership, three
gates, then the same `cancelBookingWithRefund` the console runs — state
machine, slot release, custody event, authorization voided through the payment
seam.

Three gates, and `customerCancelEligibility` is what BOTH the trip page and the
server action call, so a rendered button and a server refusal cannot disagree:

| Gate    | Rule                                             | Why                                                                                                                                                                                                                                                        |
| ------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status  | `paid` or `agent_assigned`                       | Narrower than the state machine, which also accepts `cancel` from `verified_sealed` and `awaiting_pickup`. Those mean the visit HAPPENED — a passport checked, bags weighed, photographed and sealed with numbered stock. Ops can still cancel from there. |
| Window  | `now < pickup_window_start`; **no window fails** | Guessing wrong either cancels something in flight or charges somebody who asked in time.                                                                                                                                                                   |
| Capture | Nothing captured, across ALL providers           | An authorization is released; a capture is money that left an account.                                                                                                                                                                                     |

**Who cancelled it** is `cancellationFromTimeline`, read off a trail the caller
already has. `by` comes from the actor's ROLE, not from comparing the actor to
the booking's owner: an admin cancelling their own personal booking is still
Koolee cancelling it. Four surfaces render it — the customer's trip page, the
agent's task detail, the console's booking detail banner, and the console's
custody trail, which always carried it.

### The map

`packages/ui/src/components/live-map.tsx`. MapLibre GL over OpenFreeMap vector
tiles: **no key, no account, no per-load billing, and no environment variable
in any environment.** Google stays server-side (Places behind `/api/places`,
Routes behind the ETA seam) — see Chapter 5.

**Its worker is served by us, and that is not optional.** maplibre-gl 6 derives
the worker URL from `import.meta.url` and returns the EMPTY STRING when that is
not an `http(s):` URL — which under any bundler it is not — then constructs
`new Worker("")`. The style, TileJSON and sprites all fetch 200, no tile is
ever requested, `load` never fires, and nothing raises an error.
`scripts/copy-maplibre-worker.mjs` copies the worker **and the shared module it
imports** into `public/maplibre/` before every dev and build; `setWorkerUrl`
points at it. **An app that mounts `LiveMap` must run that script** — the
failure otherwise is completely silent.

The marker ROOT belongs to MapLibre, which rewrites its `transform` every
frame; every visual effect lives on a child. A `transition` touching `transform`
on that root is the pin flicker, and Tailwind's `transition-transform` covers
it.

Controls: recenter-when-panned (which also ends automatic re-framing —
somebody's pan is theirs to keep), cooperative gestures, fullscreen. **No
geolocate control**: the pickup address is the anchor, and somebody booking for
a friend across the city would be shown a dot that is irrelevant and looks
meaningful.

### Choosing a driver

Map-first, with the list as a full tab rather than a fallback
(`SegmentedControl`). `bestCandidate` in `driver-selection.ts` is "pick the
best": nearest by `eta.minMinutes` — the number the card leads with — tie-broken
on the lowest bag load, then shift id so two identical requests reach the same
driver. A driver with no ETA never wins and stays choosable by hand. It runs the
SAME `selectDriverAction`, so there is exactly one way to be assigned a driver
and one set of races.

**A candidate's position must be FRESH to be drawn.** `freshPosition` applies
the same `POSITION_FRESH_MS` window `getSelectedDriver` has always used, to the
pin AND to the ETA — `driver_positions` keeps one mutable row per driver with no
history, so a driver who finished a run yesterday still has yesterday's
coordinates. A stale ETA is the worse half: it is the number `bestCandidate`
ranks on. A driver with no fresh fix keeps their card and has no pin.

**Which is why the driver reports for the WHOLE SHIFT.** `GpsPinger` used to
run only while a pickup was `in_progress`, and a shortlist candidate is by
definition a driver who has not started anything — so no candidate ever had a
fresh fix and the map usually had nothing to draw. TD's call, taking the cost
knowingly: it now runs at 20 s en route to a door, 45 s carrying, 45 s idle on
shift. **45 s is a ceiling, not a preference** — two pings must fit inside the
90 s freshness window, or one dropped request drops that driver off every
customer's map.

It is mounted in the agent app's LAYOUT ([shift-location.tsx](../apps/agent/src/components/shift/shift-location.tsx)),
not on the Today page. Mounted on one page, opening a task — the moment a
driver is most likely to be moving — silently stopped reporting, and nothing
said so. Position is a fact about the person, not about the screen they are
looking at.

Off the clock nothing is sent: no shift means `phase` is null, and the pinger
never touches `navigator.geolocation` — no prompt, no request, nothing stored.
Still foreground-only; a phone in a pocket with the screen off stops reporting,
and the customer's page degrades to "Position updating" rather than to a stale
pin presented as current.

**The shortlist refreshes on a 12-second poll, not on realtime.**
`recordDriverPosition` signals only bookings already bound to that driver's
shift, and a booking still choosing has none. Widening that would make one
ping wake every customer currently choosing, each wake a full trip-page
re-render with an ETA round-trip per candidate.

## Chapter 7 — Auth

**Three session kinds**, one Supabase project per environment
([auth/types.ts](../packages/core/src/auth/types.ts)):

| Kind              | Who          | How                                                           |
| ----------------- | ------------ | ------------------------------------------------------------- |
| `CustomerSession` | Customers    | Phone or email OTP; anonymous sessions for in-progress drafts |
| `AgentSession`    | Field agents | Invite-only email + password, `staff_members.role = agent`    |
| `AdminSession`    | Ops          | Invite-only email + password, `staff_members.role = admin`    |

**The customer funnel is anonymous-first.** A draft creates an anonymous
Supabase user so the draft row has an owner; verifying a phone or email
upgrades that same user in place. The upgrade path is the most safety-critical
auth code here: `guardUpgradeOtpSend`
([auth/upgrade-guard.ts](../packages/core/src/auth/upgrade-guard.ts)) runs the
OTP throttle _and_ claim reconciliation inside ONE transaction under
user + destination advisory locks. Splitting them left a window where an
SMS-pumping attacker could outrun the throttle.

Destinations are never logged in plaintext — `otp_send_log` stores an HMAC
(`OTP_LOG_HMAC_KEY`).

**Staff auth is a per-request role check, not a signup rule.** Anonymous
sign-ins must stay enabled for the customer funnel, so _anyone_ can hold an
account; what gates the consoles is `requireStaffRole` on every request. That
is also what makes deactivation immediate — a deactivated admin's live session
fails its next request.

**Cookie names are per app.** All three apps share one Supabase project (per
environment — see Ch 13), and
`@supabase/ssr`'s default cookie name is host-scoped (ports are ignored), so on
localhost signing into one app logged the others out. Each app pins its own
name: `sb-koolee-web-auth`, `sb-koolee-admin-auth`, `sb-koolee-agent-auth`.

**CAPTCHA** (Turnstile) tokens are passed through to Supabase, which verifies
them. The app never calls siteverify itself, and the secret lives only in the
Supabase dashboard.

Detail: [setup-auth.md](../apps/web/docs/setup-auth.md),
[staff-auth.md](../apps/admin/docs/staff-auth.md).

---

## Chapter 8 — Payments end-to-end

**The shape:** authorize at booking, capture once the bags are in custody.
`paid` means the funds are _held_, not taken.

```
pay step        → ensureBookingPaymentIntent → one intent per draft
browser         → Stripe Payment Element confirms
/book/return    → reconcileBookingPayment (server-side re-read)
webhook         → handlePaymentEvent (same transition, replay-guarded)
agent completes → custody only — NO money moves on the agent's device
sweep (apps/web)→ captureDueBookings, every 5 min or POST /api/jobs/capture-due
cancel          → cancelBookingWithRefund (void or refund)
```

**Custody and money move on separate tracks** (since 2026-08-10). The agent
app holds no payment credentials by design, so it cannot capture; a sweep in
apps/web — the app that owns Stripe — charges any booking already in custody
whose payment is still `authorized` for that provider. The resulting
`booking.payment_captured` event has a NULL actor, because the charge is the
system's act and not the agent's.

**One intent per draft.** Re-visiting the pay step must not mint a second
intent. `ensureBookingPaymentIntent`
([payment-intent.ts](../packages/core/src/services/payment-intent.ts)) reuses
the booking the draft remembers, or — if the cookie lost it — the newest
`draft` booking whose fields fingerprint-match. Pure _amount_ drift (a promo
code, a rule change) is handled by `updateAuthAmount`; a _structural_ change
(different window, bags, flight, address, passenger) cancels the stale draft
booking and creates a fresh one. The fingerprint compares the pickup window
columns, so a legacy slot-era booking never matches.

**The client is never trusted.** Returning from Stripe hits `/book/return`,
which re-reads the intent through the seam and advances the booking through
the _same_ state-machine move the webhook uses. Whichever side gets there
first wins; the other treats "already paid" as success. That is why the flow
is correct locally with no webhook configured at all.

**Idempotency** is the unique `(provider, provider_ref)` on `payments` plus
the `payment_webhook_events` table. Stripe redelivers by design; both make a
repeat a no-op.

**Failure is compensated, not rolled back.** Authorization happens _after_ the
booking transaction commits — holding row locks across a third-party network
call is how a booking rush becomes a database pile-up. If authorization
fails, `compensateFailedAuthorization` cancels the booking and appends a
custody event. (Before virtual windows this also released a slot seat; with
no capacity there is nothing to release.)

**Dev has no Stripe.** With no `STRIPE_SECRET_KEY`, core builds
`FakePaymentProvider` and the pay step renders a one-click test button.
`stripeCheckoutState()` distinguishes `ready` / `fake` / `misconfigured`, and
the misconfigured case (secret key without publishable key) refuses to take
bookings rather than failing at confirm time.

Detail: [payments-lifecycle.md](../apps/web/docs/payments-lifecycle.md).

---

## Chapter 9 — Agent PWA

**What it is:** the field app an agent uses at the customer's door. Installable,
with an offline fallback page. Routes are few on purpose — `/` (today, as a
route), `/tasks`, `/tasks/[taskId]`, `/account`, plus auth.

### The day is a route, not a list

The single most important thing to understand about this app is that **the two
task tables are not what the driver sees.** `verification_tasks` and
`pickup_tasks` stay exactly as they are in the database; the grouping into one
**job** per booking happens in presentation, in
[agent/src/lib/job.ts](../apps/agent/src/lib/job.ts).

The reason is a phone screen. Rendered as two rows, the same customer, the same
window and the same address appeared twice, three lines apart. A driver does not
experience "a verification task and a pickup task" — they experience one trip to
one door with two things to do there: **Verify & seal** _at the door_, then
**Collect & deliver** _to the bag drop_. Because the grouping is presentational,
it stays reversible the day those two halves are assigned to different people.

On top of that, [journey-list.tsx](../apps/agent/src/components/job/journey-list.tsx)
renders the day as **one connected rail with exactly one open stop**. What it
replaced was two headed sections ("Up next", "Later today") of standalone cards,
where every card looked equally like a starting point and the sequence — the
most useful fact about a driver's day — had to be reconstructed from four
timestamps. One rail makes order structural; one open stop draws the distinction
the old layout could not: _where I am_ versus _what is after this_.

🧭 **Stops are ordered by scheduled time, never by geography.** The customer
bought a window, and a route optimiser that reorders stops to save a mile
quietly breaks the promise that window is. Optimisation is deferred (P17); when
it lands it must reason about windows, and `JourneyList` will render whatever
order it produces without changing.

⚠️ **Overdue stops LEAD the route rather than being hidden**, and they are
marked as late — because a driver reading a rail top to bottom would otherwise
take the first row as "next" instead of "already missed".

**Navigate is what starts a leg.**
[navigate-action.tsx](../apps/agent/src/components/job/navigate-action.tsx) is a
plain `<a target="_blank">`, not a button that navigates: the href is real, so
the browser opens the maps app synchronously from a genuine user gesture, immune
to popup blocking and to a dead kerbside signal. The server action that marks
the pickup as under way is fired and **deliberately not awaited** — awaiting it
would put a round-trip between the driver's thumb and their map. `startPickupTravel`
is idempotent in core, so the double-fire this permits (tap Navigate, then tap
"Set off") is a no-op the second time. **The bookkeeping waits, never the
driver.**

**Task-scoped authorization.** An agent is not a role with broad read access;
they can see exactly the tasks assigned to them. `getAssignedTask` carries the
assignee in the WHERE clause rather than checking after the fact, so an
unassigned task id simply does not resolve.

**The visit flow** ([agent-visit.ts](../packages/core/src/services/agent-visit.ts))
is a sequence of appended custody events, not a form submit: arrive → verify
identity → seal each bag → complete. Completing the visit moves the booking to
`verified_sealed`.

**The pickup run** ([pickup.ts](../packages/core/src/services/pickup.ts)) is the
other half, and it is what finally gives the last four state-machine
transitions a production caller: set off (`mark_awaiting_pickup`) → scan every
seal at the door → `start_transit` on the LAST bag, never earlier → at the bag
drop (`deliver_to_bagdrop`) → the airline has them (`complete`). Same
task-scoped authorization, same append-only custody, same refusal to touch
money.

Two things about it are worth remembering. **Which bags have been scanned is
DERIVED from `custody_events`, not stored in a column** — the scan IS the
evidence, and a second place to record it would be a second thing to keep in
step. And **every step is idempotent**: the agent app is an offline-prone PWA on
a phone in a van, a tap that times out gets tapped again, and the second tap
must return the current state rather than an error.

**Shifts** ([shifts.ts](../packages/core/src/services/shifts.ts)) gate all of
it. A driver clocks on from the top of Today (not a fourth tab — see the nav's
own comment), picking a truck; they cannot clock off while a pickup on the
shift is still open, and the refusal names the bookings. `driver_shifts`'
partial unique indexes are what make that safe under concurrency.

**Completing does _not_ take the money.** This app holds no Stripe credentials
by design; capture is a sweep (`captureDueBookings`) run from `apps/web`, which
is the app that has them. See
[Learning §1.8](learning/01-product-and-nouns.md#18--paid-means-authorized-not-collected).

**Sealing a bag takes all three of a unique `seal_id`, a weight, and a photo**
— enforced at the form, the server action, and core, with a partial unique
index on `bags.seal_id` (migration `0017`) as the actual guarantee. There is no
override; an agent who cannot weigh or photograph files an exception instead.
[agent-visit §3.2–3.3](features/agent-visit.md#32--sealing-takes-all-three-or-it-does-not-happen).

**Photos are downscaled in the browser** before upload
([@koolee/ui/lib/photo](../packages/ui/src/lib/photo.ts)): 3–8 MB phone captures blew
the 1 MB Server Action body limit and `413`'d before the action ran. Resize to
1600px / ~700 KB client-side, best-effort, with `serverActions.bodySizeLimit`
raised to `4mb` purely as a safety net.

Anything that goes wrong is a first-class outcome: `reportVisitException`
moves the booking to `exception` with a reason, which surfaces in the admin
console. The agent never edits history — corrections are new events.

**Task schedules** (`scheduled_start` / `scheduled_end`) are copied from the
booking's pickup window at assignment time. They are a snapshot for the
agent's list, not a live join.

**GPS** is foreground-only and deliberately disposable: `GpsPinger` posts
`navigator.geolocation` to `POST /api/driver-position` for as long as the shift
is open — 20 s while en route to a doorstep, 45 s otherwise — and
`driver_positions` keeps one mutable row per driver. A route handler rather than a server action, because a
server action would revalidate the page on every ping. Permission denied is not
an error — a non-blocking banner says the customer will not see them coming,
the pings stop, and everything else works. Nothing written here is chain of
custody.

**The number to call, and how far away the door is.** Two additions that both
come down to "the driver had less information than the customer did".

- [door-contact.ts](../packages/core/src/services/door-contact.ts) resolves the
  one number the person at the door can be reached on. The app used to show a
  disabled "No number" button on most jobs, and that was not a bug — it read
  `bookings.contact_phone`, which is only ever set for **email-only** customers
  (the funnel asks for a door number precisely when it has no verified phone).
  Every phone-OTP customer had their number on `users.phone`, deliberately never
  selected. That was the wrong call: a driver outside a building with no buzzer
  answer has exactly one useful action, and withholding the number strands both
  of them into a support call that reads it out anyway. **One field, and nothing
  else** — email and the rest of the user row stay unselected, and the number
  reaches only the assignee of a live task on that booking, the same
  relationship that already grants them the address, the name and the face. The
  booking's own `contact_phone` wins when present: it was typed _for this
  pickup_ and may be a hotel desk rather than the traveller.
- [staff-travel.ts](../packages/core/src/services/staff-travel.ts) gives the
  doorstep card a distance and an ETA, off the driver's **own last GPS ping**.
  The customer's page has had both since the driver-selection slice; the person
  actually driving had neither. Nothing here is load-bearing: null is an
  ordinary answer (location off, no fix yet, an address without coordinates)
  and every caller renders nothing rather than a placeholder. It never throws —
  a driver standing at a door must not meet a 500 because a routing API is down.

**The task list carries its bookings** (2026-08-16). `listAssignedTasks`
returns `{ task, tz, booking }` — the `booking` half is a `TaskBookingContext`
(pax, flight, airport, departure, bag count, pickup street/city) joined in the
service. Before that the query returned task rows alone, so `/tasks` could only
show a kind label, a time, and a status chip: every row looked identical and
none of them said which door to drive to. The page renders one task per row
under airport-local day headings, kind as a coloured chip.

Detail: [verification-visit.md](../apps/agent/docs/verification-visit.md).

---

## Chapter 10 — Admin ops console

**The information architecture is one file.**
[components/console/nav.ts](../apps/admin/src/components/console/nav.ts) is the
only place that knows what sections exist and how they group, and everything
else — the rail, the breadcrumb trail, the badge counts — derives from it.

Until 2026-08-29 these were seven flat links in the shared `AppHeader`. Two
structural problems, not cosmetic ones: a header has no room to grow past about
seven items, and a flat list hides that **"what am I doing today" (Operations)
and "how is this console configured" (Configuration) are different errands an
operator is on at different times.** The rail stays admin-only on purpose —
[DESIGN.md](../packages/ui/DESIGN.md) promotes a pattern into the shared package
when two apps repeat it, and neither web (two dashboard links) nor agent (a tab
bar) has a rail's worth of navigation.

`resolveConsoleRoute` resolves a pathname by **longest prefix**, so
`/bookings/<id>` lands under Bookings rather than under Overview, whose `/`
prefixes everything. Unknown paths return null and the chrome renders without a
trail rather than guessing.

**Pages**, each a server component + an `actions.ts` + a client form file:

| Route             | Group  | What it does                                                                                                                                                                                                                                                                                                                                    |
| ----------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`               | Ops    | Overview: **what needs a human**, ordered by consequence and collapsing to one green line when nothing does; then launch readiness, which deletes itself once it passes; then the day's shape                                                                                                                                                   |
| `/bookings`       | Ops    | Dispatch board: filter by status/airport/day, **search eleven fields** with a badge saying which matched, assign an agent, see at-risk bookings. Since 2026-08-23 assignment is automatic on `paid` (`autoAssignOnPaid`); the board's Assign button is the manual override, and an uncovered ZIP still falls through to it via the at-risk flag |
| `/bookings/[id]`  | Ops    | One booking end to end: custody trail, evidence photos, payment, the transition controls                                                                                                                                                                                                                                                        |
| `/shifts`         | Ops    | Who is out driving, in what, with how many bags; **start a shift on somebody's behalf** (the pair to force-end — same `startShift` guards, the admin stamped in `driver_shifts.started_by_user_id`); force-end with a required reason; grant or revoke `can_drive`                                                                              |
| `/exceptions`     | Ops    | Bookings in `exception`, with the three legal resolutions                                                                                                                                                                                                                                                                                       |
| `/pricing`        | Config | The active pricing rule and the lead-time curve — **a path to change a price that is not SQL**                                                                                                                                                                                                                                                  |
| `/cutoffs`        | Config | Airline bag-drop cutoffs per airline × airport × domestic/international. Every bookable window derives from these                                                                                                                                                                                                                               |
| `/blocks`         | Config | Window blackouts — the ops lever over what customers can book                                                                                                                                                                                                                                                                                   |
| `/zones`          | Config | Agent ZIP coverage, which auto-assign picks from                                                                                                                                                                                                                                                                                                |
| `/agreements`     | Config | Versioned booking agreements. "Current" is derived, never a flag — see Ch.3                                                                                                                                                                                                                                                                     |
| `/trucks`         | Config | The fleet: name, bag capacity, active toggle. `reserved_spaces` is editable and **enforced**; the card shows how many spaces are bookable                                                                                                                                                                                                       |
| `/staff`          | Config | Invite / list / deactivate agents and admins                                                                                                                                                                                                                                                                                                    |
| `/staff/[userId]` | Config | One staff member: their history, their zones, `can_drive`                                                                                                                                                                                                                                                                                       |

**The Overview's premise is that a calm system renders almost nothing.**
`buildAttention` ([apps/admin/src/lib/attention.ts](../apps/admin/src/lib/attention.ts))
returns items ordered `blocked` → `urgent` → `soon`, and an empty list is the
normal case. The page it replaced was four stat cards, three reading `0` on an
ordinary day — the same shape whether the day was fine or on fire. It lives in
the app rather than core because it is a decision about what to look at first,
not a fact about the domain. `getLaunchReadiness` (core) covers the four
conditions under which the product stops working with no error anywhere, and
its panel is not rendered once all four pass. Details and the traps:
[features/ops-console.md §9](features/ops-console.md#9-the-overview-page).

**The board's search is one predicate list with two jobs.**
`searchPredicates` builds both the `or(...)` filter and each row's
`matchedOn`, so a badge cannot name a field the filter did not match. Eleven
keys; **address and ZIP deliberately excluded**, pinned by a test. See
[features/ops-console.md §4.4](features/ops-console.md#44--search-reads-eleven-fields-and-the-row-says-which-one-hit).

Plus `/login`, `/login/reset` and `/set-password` — staff auth, outside the rail.

**Three badge counts ride on the rail**, and all three already existed on
`OpsDashboard`: `unassignedToday`, `awaitingDriverToday`, `exceptionsOpen`. The
rail surfaces numbers an operator previously had to navigate to the landing page
to see; it computes none of its own.

**Manual actions never edit history.** Every resolution is a state-machine
transition plus an appended compensating custody event carrying a **required**
reason and the admin's real user id. The three exception resolutions
(`cancel_and_refund`, `resume_transit`, `force_complete`) are exactly the
moves the matrix allows out of `exception` — the console cannot invent one.

**Blackouts matter more than they look.** With virtual windows there is no
inventory to withhold, so `slot_blocks` is the _only_ way ops can stop selling
a span of hours. A block hides every window it overlaps at that airport;
existing bookings inside the span are untouched, because a block stops new
sales, it does not cancel work.

**At-risk says WHICH now.** Until the driver slice there was one flag and one
word, and it only ever meant "paid, nobody assigned to verify" — every at-risk
surface read `verification_tasks` only, so a booking with its bags sealed on a
doorstep and nobody coming for them looked healthy. `BoardRow.atRiskReason` is
`no_agent | no_driver | null`, and `OpsDashboard.awaitingDriverToday` is a
SEPARATE count from `unassignedToday` because one needs an agent sent to a door
and the other needs a van.

**Reassigning a pickup reuses the customer's own path.** `adminReassignPickup`
runs the same transaction, the same single advisory lock and the same capacity
recount as `selectDriver` — they are one operation with two actors, and letting
them drift into two concurrency stories is how a van ends up overloaded. What
differs is written down at the function: no ownership check, a relaxed
started-travel guard (ops may move a run that has set off; a customer may not),
and a zone/capacity override that is RECORDED on the custody event with the
rule it waived.

**The board reads the booking, not a join.** Day filters and ordering use
`bookings.pickup_window_start` directly.

**Board sorting** is a closed set — `BOARD_SORT_KEYS` = `window`, `booked`,
`departure`, `status`, `agent` — resolved in `orderFor` and always tie-broken on
`bookings.id` so paging is stable. `booked` sorts `created_at` and is the only
key without a nulls clause. Time cells stack clock over date
(`formatTimeInAirportTz` + `formatDayInAirportTz`), and `BoardRow.assigneeName`
renders above the email, falling back to it when null.

Detail: [ops-console.md](../apps/admin/docs/ops-console.md).

---

## Chapter 10.5 — Observability (Sentry)

**Policy in core, SDK in the apps.** Three apps each carry their own
`@sentry/nextjs` instance reporting to their own project — that part cannot be
shared. What must not be three-of is the POLICY, so
[`packages/core/src/observability/sentry.ts`](../packages/core/src/observability/sentry.ts)
holds `sentryOptions()`, the tag names and the severity map, imports nothing
from Sentry, and is reachable as `@koolee/core/observability`.

⚠️ **That subpath is load-bearing.** `instrumentation-client.ts` pulls the app's
`lib/sentry.ts` into the BROWSER bundle; importing the `@koolee/core` barrel
there reaches `postgres`, `stripe` and `unpdf`, and the build fails with four
"Can't resolve 'fs' / 'net' / 'tls' / 'perf_hooks'" errors that never mention
Sentry.

Per app: `src/instrumentation.ts` (Node + edge, plus `onRequestError` — the
only thing that records an error thrown inside a server component, a route
handler or a server action), `src/instrumentation-client.ts`,
`src/sentry.server.config.ts`, `src/sentry.edge.config.ts`,
`src/lib/sentry.ts` (`options`, `tagBooking`, `captureHandled`), and
`src/app/global-error.tsx`.

**`global-error.tsx` is the root boundary and it did not exist anywhere.**
`error.tsx` renders INSIDE the root layout, so a failure in that layout escapes
it entirely. The global one renders its own `<html>`/`<body>` with inline
styles, because the stylesheet is part of what may have failed.

**The settings that are policy, not defaults:** `tracesSampleRate: 0` (an error
tracker, not an APM — and traces are the expensive half of the bill) and
`sendDefaultPii: false` (it would attach IPs, cookies and headers to every
event, on a product whose database deliberately holds no passport fields and
hashes OTP destinations). `booking_ref` and `user_id` are the correlation keys
and both are opaque — `tagBooking` sets them on the customer trip page, the
agent task page, the admin booking detail and the Stripe webhook, so one
`KOO-XXXXX` pulls a booking's errors across all three projects.

**`SentryOpsAlerter`** ([notifications/sentry-alerter.ts](../packages/core/src/notifications/sentry-alerter.ts))
replaces `ConsoleOpsAlerter` when a DSN is present, and logs to the console as
well — the console line is the record that survives a dead transport. It
**swallows its own failures, and that is a hard rule**: twelve of the
seventeen `opsAlerter.alert` call sites are unwrapped Inngest steps, so an
alerter that threw would turn "we could not tell ops about a failed email" into
a failing, retrying job.

**Terminal Inngest failures** are captured by one `inngest/function.failed`
handler in `apps/web/src/lib/inngest.ts` rather than an `onFailure` per
function, so a function added later is covered without anybody opting it in.

⚠️ **`withSentryConfig` wraps a config whose `headers()` is the only reason web
push works.** `scripts/check-sw-headers.mjs` imports each composed config and
asserts `/sw.js` still carries `no-cache` and `Service-Worker-Allowed: /`;
`pnpm check:sw-headers` runs it. Both failure modes are silent.

**The env manifest** ([scripts/env-manifest.json](../scripts/env-manifest.json))
is the other half of the same idea: the required-variable inventory per app,
derived from the boot gates in `apps/*/src/env.ts`, in four buckets — `always`,
`whenLive`, `whenPush`, `recommended` — plus a `forbidden` list (`apps/agent`
must never hold `SUPABASE_SERVICE_ROLE_KEY` or `STRIPE_SECRET_KEY`).
`pnpm env:verify` reads it and answers what a boot would answer, without
deploying: names only, never values, which is what makes
`vercel env ls | pnpm env:verify --stdin` work and its output safe to paste
anywhere. It matters because production runs `coming_soon`, which exempts
`apps/web` from most of its gates — flipping to `live` arms them all at once.

---

## Chapter 11 — UI package & brand

**`packages/ui`** holds every shared component — layout (`AppShell`,
`AppHeader`, `ContentColumn`, `Section`, `PageHeader`), primitives (Button,
Card, Input, Select, Dialog, Badge, Popover, Calendar, `VerifiedIndicator`, …),
form controls (`DateTimeField`, `NumberStepper`, `OTPInput`, `PhoneInput`,
`AutocompleteField`), and domain components (`CustodyTimeline`,
`ProgressTrack`, `StageDot`, `BookingStatusBadge`, `PriceEstimator`,
`SealMotif`).

**The one third-party widget in the package is `Calendar`** — a
`react-day-picker` v10 `DayPicker` (2026-08-23), styled entirely with Tailwind
against the theme tokens. Its own stylesheet is deliberately **not** imported:
a component whose colours live in a third-party CSS API cannot follow the brand
palette or dark mode without override fights. `@radix-ui/react-popover` came in
with it.

⚠️ **`DateTimeField` carries a timezone contract, not just a layout.** It
replaced the flight step's native `<input type="datetime-local">`, and its
submitted value is still a **wall-clock string** — byte-identical to what that
input posted — because the flight step feeds it the _airport's_ wall clock, not
the browser's. Every transformation inside is string-level; the single `Date`
exists so `DayPicker` has something to render and is built from, and read back
as, local calendar fields. `Intl.DateTimeFormat` is avoided (the repo's lint
rule bans it there), so the label comes from a fixed month/weekday table.
Changing any of that reintroduces the bug the wall-clock contract prevents —
see [TIME.md](TIME.md).

**Two components are deliberately shared across all three apps** rather than
reimplemented per app, because divergence there is a correctness problem, not a
cosmetic one:

- **`ConfirmDialog`** — every destructive confirmation in the product. A
  customer discarding a draft and an operator forcing a transition meet the
  same component. It owns its busy state and stays open until the action's
  promise settles. `window.confirm` is not an option anywhere; see
  [booking-funnel §2.3](features/booking-funnel.md#23--every-destructive-confirmation-is-ours).
- **`ImageLightbox`** (2026-08-15) — evidence photos are captured at ~1200px
  and were rendered at 78–190px with no way to enlarge them. Backs the agent's
  capture preview, the ops bags card, and `CustodyTimeline` — so the customer's
  trip page inherits it. Has Storybook stories.

**`StageDot` is the visual signature, and `CustodyTimeline` is its first
consumer** — the same motif on the marketing custody section (`horizontal`),
the live trip page and the ops trail (`vertical`), so the promise and the
product are literally the same drawing. State reads through the dot: **navy**
for a hand-off already banked, **seal orange, pulsing** for the one happening
now, **hollow** for what is ahead; the rail is always sky. Exactly one dot is
orange per timeline, which is what keeps orange meaning "this, now".

**`ProgressTrack`** (2026-08-30) is the second consumer: a short fixed
progression with a "you are here", used by the customer's driver run. It exists
because the trip page was drawing its OWN strip — smaller dots, a different
blue, a hairline rail and nothing at all marking the step in progress — on the
same screen as the custody trail. Two progressions, one page, two visual
languages, with the one describing what was happening right now the quieter of
the two. The marker moved into `stage-dot.tsx` so neither component owns it.
`ProgressTrack` is NOT `CustodyTimeline` (that renders a record of events that
happened, with timestamps and proof photos) and NOT `MilestoneTrack` (the
marketing chip row, which has no notion of a current position).

⚠️ Its dots rendered at **0×0 in the vertical orientation** until 2026-08-16: a
bare `<span>` is `display:inline`, and width/height do not apply to
non-replaced inline elements, so `size-3` was inert. The horizontal variant was
unaffected because its dot is a direct flex child and flex blockifies children
— so the marketing page looked right while every in-product timeline drew a
rail with nothing on it, for as long as the component had no story. Markers and
shape-only spans carry `block`.

**One structural rule worth knowing.** `AppHeader` is split into a server half
(renders all link markup) and a client half (`app-header-chrome.tsx` — the
mobile hamburger and its animation). Passing `Link` itself into a client
component throws; passing rendered markup does not. Any component that needs
both `linkComponent` and interactivity follows this pattern.

**`ContentColumn`** has four widths: `default` (header-width, for pages whose
content earns it — they arrange cards and lists in grids), `focused`
(max-w-3xl, guided step flows like the funnel and the agent visit), `narrow`
(max-w-md, auth screens), and `full` (full-bleed, no 1280px cap — dense
operational tables where every column matters more than the centered rhythm;
currently just the admin bookings board). `AppFooter` takes the same prop so
it lines up with the page above it.

Each variant owns its whole horizontal box, including whether it uses
`container` at all — `full` deliberately does not, because `container` caps at
1280px. Until 2026-08-10 `full` still applied it and was therefore a silent
alias of `default`.

**Brand** ([BRAND.md](../brand/BRAND.md)) is Tag-K: navy and sky as the system
colours, with orange reserved for scarcity/urgency — using it decoratively
breaks the contrast rule the funnel depends on. Fonts and tokens are pinned
there, and the launch-pricing caveat is fixed copy that must appear wherever
prices do.

**Storybook** runs from `packages/ui` (`pnpm storybook`, port 6006). Coverage
is partial and known to be: shell, primitives, feedback, the newer data
components (`LinkedTableRow`, `MultiSelect`), `ImageLightbox`, and
`CustodyTimeline`; most domain components do not yet. `src/index.ts` is the
authoritative component list — this chapter is a map, not an inventory.

**Elevation** is two tokens from `theme.css` and no others: `shadow-lift` for
any card-like surface (what `Card` ships since 2026-08-16 — it was
`shadow-xs`, which left app cards flatter than the marketing surfaces they sat
beside) and `shadow-lift-lg` for the raised/hover state. Tailwind's default
`shadow-sm`/`shadow-md` are a second scale and are not used.

---

## Chapter 12 — Testing & env matrix

**Three tiers**, and the difference is what they need:

| Tier            | Command                                       | Needs                                      |
| --------------- | --------------------------------------------- | ------------------------------------------ |
| Unit            | `pnpm test`                                   | Nothing. Pure logic, fakes for every seam. |
| Integration     | `pnpm --filter @koolee/core test:integration` | A Postgres (`TEST_DATABASE_URL`)           |
| Auth acceptance | same, with the local stack                    | Supabase GoTrue via `pnpm test:env:up`     |

Integration suites are opt-in: without `TEST_DATABASE_URL` they
`describe.skip` rather than fail, so a fresh clone's `pnpm test` is green.

**What is covered, and why those things.** The full state-machine matrix
(every legal move and all illegal ones); cutoff and window logic to the
minute, across both 2025 DST transitions, including the always-24-windows
band invariant and a _displayed-implies-accepted_ property between the
enumerator and booking acceptance; pricing additivity, monotonicity of the
lead-time curve, and integer-cent invariants; the auth upgrade guard under
real concurrent locks; and `createBooking` end to end, including the
`custody_events` trigger rejecting `UPDATE`/`DELETE`/`TRUNCATE`.

**The local stack** ([test-env.sh](../scripts/test-env.sh)) brings up Supabase
on 127.0.0.1 and writes `.env.test`. It has a hard local-host assertion with
no bypass — seeding known passwords into a hosted project would be a standing
backdoor.

**Day-to-day, use [local.sh](../scripts/local.sh) rather than calling
`test-env.sh` directly.** It is an orchestrator over the same script — it adds
the three things that used to be manual steps around it: starting Docker
Desktop and waiting for the daemon, seeding, and one status board covering
both infra and the app ports.

| Command             | Does                                                              |
| ------------------- | ----------------------------------------------------------------- |
| `pnpm local`        | Docker → Supabase → migrate → test DB → 8 verify checks → seed    |
| `pnpm local:dev`    | The above, then `pnpm dev`                                        |
| `pnpm local:status` | Read-only: what is running right now, including :3000/:3001/:3002 |
| `pnpm local:down`   | Stop the stack (data volumes persist)                             |
| `pnpm local:reset`  | Wipe + re-migrate the local DB, then force a reseed               |

Every step is idempotent, so `pnpm local` is also the right command when you
are not sure what is already up: a running stack is detected and skipped, and
the seed is skipped when `airports` and `staff_members` are both non-empty.
An exported `DATABASE_URL` pointing anywhere non-local aborts the run before
anything executes.

**One sharp edge.** `.env.test` points `TEST_DATABASE_URL` at the same local
Postgres the dev servers use, so an integration run truncates shared tables
underneath a running dev session. A vitest teardown re-seeds the dev roster
automatically; what it cannot restore is a _manually_ edited pricing rule, so
after an integration run the active rule is the test fixture.

Detail: [local-test-env.md](../packages/core/docs/local-test-env.md).

---

## Chapter 13 — Deployment picture

**Three Next apps, TWO Supabase projects, one Stripe account.** Each app
deploys independently and reads its own env, validated at boot by a
zod-parsed `env.ts`.

**The prod/dev split (2026-08-23).** `apps/web` is one Vercel project whose
branch decides everything: `main` → Production scope → `koolee.cloud` → the
prod Supabase project; every other branch → Preview scope → the dev Supabase
project, with the `dev` branch pinned to `dev.koolee.cloud`. `NODE_ENV` is
`production` in Preview too, so every boot gate below fires on dev exactly as
it does on prod — dev rehearses prod, deliberately. Full detail, including the
Supabase auth-email settings that are invisible in code and the reason
Deployment Protection has to stay off for Preview, is
[ENVIRONMENT.md §6.5–6.6](ENVIRONMENT.md).

**Production boot assertions** fail closed. `apps/web` asserts its security
config (`assertProductionSecurityConfig`) AND, on live-mode (non-coming-soon)
boots, `RESEND_API_KEY` — a missing email key would silently degrade booking
confirmations to console logs. The two staff apps assert their Supabase +
service-role wiring. A missing secret stops the app rather than silently
disabling a protection. The build phase is exempt, so a fresh clone still
builds.

**Email + jobs in production** need three more things beyond the code:
Resend domain verification (until it flips, sends only reach the Resend
account's own address), `RESEND_FROM` on the verified domain plus
`NEXT_PUBLIC_APP_URL` for the email CTAs, and the Inngest Cloud app synced
against `<origin>/api/inngest` with the **prod** event/signing keys —
without the sync, no cron or event function ever runs in production.

**Two database URLs, always.** `DATABASE_URL` is the pooled connection apps
use at runtime; `DIRECT_DATABASE_URL` (port 5432) is for migrations only.
Running migrations through the pooler produces
`prepared statement does not exist` errors in production that will not
reproduce locally.

**The webhook route is pinned.** `/api/webhooks/stripe` runs the nodejs
runtime and reads the raw body — signature verification needs both, and the
pins are asserted in a test so a refactor cannot quietly break them.

**Every PR is gated.**
[.github/workflows/ci.yml](../.github/workflows/ci.yml) runs on every pull
request to `dev`/`main` and every push to them: `format:check`, `typecheck`,
`lint`, the unit tiers, three production builds, and the core integration tier
against an **ephemeral `postgres:16` service container**. It holds no database
credential and cannot obtain one — `migrate.yml` remains the only workflow in
this repository that reaches a hosted database.

The container needs
[`scripts/ci-postgres-bootstrap.sql`](../scripts/ci-postgres-bootstrap.sql)
first: `packages/db/README.md` says the migrations run against a plain
Postgres and they do not — `0008` writes `storage.buckets` unguarded and the
run dies there. The migrations cannot be corrected (`db:status` compares by
content hash, so editing an applied one is permanent drift), so the
environment moves to meet them. Two integration suites need a real GoTrue,
refuse to skip without one, and are excluded by name — they are part of the
LOCAL pre-PR gate. See [SCRIPTS §9](SCRIPTS.md).

**Migrations apply themselves on merge.** A push to `main` or `dev` touching
`packages/db/drizzle/**` runs
[.github/workflows/migrate.yml](../.github/workflows/migrate.yml) against that
branch's Supabase project and then asserts with `db:status` that the applied set
matches the checkout by content hash. ⚠️ It runs **in parallel** with the Vercel
deploy of the same push — safe only while migrations stay backward compatible
(expand → deploy → contract). A migration the old code cannot run against needs
a manual, sequenced deploy.

**Deploy checklist**, in order — for first-time setup and recovery:

1. Apply pending migrations to the hosted project over the direct connection.
   _Never take the migration state from prose — this file's included, which
   said something false about `0012` for weeks. Run `pnpm db:status` against
   the target and read what it reports; it is read-only and safe against
   production. See [PROJECT-STATUS §3.1](../PROJECT-STATUS.md) for why
   content hash, and never row count, is the authority._
2. Seed reference data **only if the project is brand new**:
   `SEED_ALLOW_HOSTED=1 pnpm seed` with the hosted URL (airports, ZIP
   centroids, placeholder cutoffs, placeholder pricing rule). The seed refuses
   a non-local host without that variable because it OVERWRITES verified
   cutoffs and tuned prices — on a project already carrying real values, enter
   them at the console instead (`/cutoffs`, `/pricing`, `/agreements`). See
   [docs/runbooks/prod-bringup.md](runbooks/prod-bringup.md).
3. Set per-app env per the [README matrix](../README.md), including the
   Stripe webhook secret.
4. Point the Stripe webhook endpoint at the deployed web app.
5. `pnpm env:verify --app <app> --file <env>` — names only, never values,
   against [scripts/env-manifest.json](../scripts/env-manifest.json).
6. Verify the boot assertions pass — a failed assertion is the intended
   outcome of a missing secret, not a bug to work around.

Going live is tracked step by step in
[LAUNCH-CHECKLIST.md](LAUNCH-CHECKLIST.md), with the procedures in
[runbooks/](runbooks/).

Open items before a real launch are tracked in
[pre-launch-security.md](../apps/web/docs/pre-launch-security.md) and
[PROJECT-STATUS.md](../PROJECT-STATUS.md). What is genuinely still stubbed is
**AeroAPI** (flight lookup) and **custody-event SMS**; Google Places and Routes
are real integrations behind the `/api/places` proxy and the `EtaEstimator`
seam, and map rendering needs no vendor at all. The Inngest jobs' side effects
**shipped** in the dispatch/email slice — every function in the table above does
real work.
