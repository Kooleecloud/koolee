# Chapter 1 — The product & its nouns

> **Verified against `dev` @ `2fe3a2b`.** ← [Learning track index](README.md)
> · Next: Chapter 2 — Repo map & boundaries
>
> **What this chapter buys you.** The vocabulary. Every later chapter names
> these things without re-explaining them. If a term in Chapter 6 is unfamiliar,
> it was defined here.

---

## 1.1 — The claim, and why it is a hard boundary

Koolee picks bags up at a NYC door and delivers them to **the airline's bag
drop counter** at JFK / LGA / EWR.

Not check-in. Not TSA. Not the aircraft.

That line is a written, enforced copy rule
([README § Copy rules](../../README.md#copy-rules)), binding on marketing copy,
product UI, transactional SMS and email alike:

- **Say:** "delivered to your airline's bag drop."
- **Never say:** "we check you in" (the customer does that with the airline),
  "handed to TSA" (we hand bags to the airline), "loaded onto your aircraft"
  (the airline does that).
- **No fabricated statistics.** No "10,000+ customers", no invented ratings, no
  made-up on-time percentages. If a number is not measured, it does not ship.

🧭 **Decision hook.** Treat this as a _product constraint_, not a style
preference. It is the reason nothing in the codebase models a boarding pass, a
seat, or a TSA interaction. Any feature that would require Koolee to represent
what happens _after_ the bag drop counter is out of scope by construction — and
you would be adding the first such model, not extending an existing one.

---

## 1.2 — The nouns and the tables they live in

| Noun                | Lives in                                      | What it is                                                                                                                                                                                                      |
| ------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Booking**         | `bookings`                                    | One customer, one flight, one pickup window. The spine everything hangs off.                                                                                                                                    |
| **Draft**           | `booking_drafts`                              | A booking-in-progress before auth/payment. Survives reload and anonymous → real-user upgrade.                                                                                                                   |
| **Bag**             | `bags`                                        | One physical bag: weight, photos, a `seal_id`, and an `ordinal`. Sealing requires all three of seal/weight/photo — see [1.4](#14--why-bagsordinal-exists) and [1.9](#19--a-seal-id-belongs-to-exactly-one-bag). |
| **Seal**            | `bags.seal_id`                                | Opaque tamper-evident ID, **unique operation-wide**. Technology-agnostic — RFID vs printed QR is undecided, and neither needs a migration. See [1.9](#19--a-seal-id-belongs-to-exactly-one-bag).                |
| **Custody event**   | `custody_events`                              | Append-only chain of custody: who held which bag, where, when, with photo evidence.                                                                                                                             |
| **Pickup window**   | _(none — computed)_                           | The hour the agent comes. **Not a row.** See [1.3](#13--windows-are-not-inventory).                                                                                                                             |
| **Blackout**        | `slot_blocks`                                 | Ops hiding a span of windows at an airport (weather, no drivers).                                                                                                                                               |
| **Cutoff**          | `airline_cutoffs`                             | Per airline × airport × domestic/international — the latest a bag can be dropped.                                                                                                                               |
| **Task**            | `verification_tasks`, `pickup_tasks`          | The unit of work an agent or driver sees.                                                                                                                                                                       |
| **Payment**         | `payments`, `payment_webhook_events`          | Intent → authorize → capture. The second table is the webhook replay guard.                                                                                                                                     |
| **Staff member**    | `staff_members`                               | Invite-only agent/admin accounts.                                                                                                                                                                               |
| **Agreement**       | `agreement_versions`, `agreement_acceptances` | The terms, versioned, and the evidence a named person accepted one. **"Current" is DERIVED** — `max(version)` where `effective_from <= now()`. There is no `is_active` column and there must not be one.        |
| **Truck / shift**   | `trucks`, `driver_shifts`                     | A van and its bag capacity; one person in one truck for one stretch of the day.                                                                                                                                 |
| **Driver position** | `driver_positions`                            | One **mutable** row per driver, overwritten every ~45s. Explicitly **not** chain of custody — a position is not evidence.                                                                                       |
| **Booking signal**  | `booking_signals`                             | The realtime **doorbell**: one mutable row per booking, the only table a browser may read. It says "something moved"; the payload is never rendered.                                                            |

The nouns above are the ones you need to reason about the product. The
remaining tables are supporting cast, listed in
[CODEBASE-MAP Ch.1](../CODEBASE-MAP.md#chapter-1--the-product--its-nouns):
`push_subscriptions`, `agent_zones`, `zip_centroids`, `pricing_rules`,
`ticket_uploads`, `otp_send_log`, `waitlist_signups`, `passport_verifications`,
`addresses`, `airports`, `users`, and the legacy `slots`.

Schema lives one-file-per-cluster in
[packages/db/src/schema/](../../packages/db/src/schema/); the status/role/tier
value sets are all in
[enums.ts](../../packages/db/src/schema/enums.ts).

---

## 1.3 — Windows are not inventory

Every flight gets the **same 24 clock-aligned one-hour windows**, ending
between 30 and 6 hours before departure. They are enumerated on demand and have
**no capacity**. The booking stores the one it bought in
`bookings.pickup_window_start` / `pickup_window_end`.

Slot inventory used to exist and was **retired** (2026-08-09). The `slots` table
still has a schema file and `bookings.slot_id` still exists, but the picker no
longer sells stock.

🧭 **Decision hook.** Two consequences worth holding onto:

1. **"We are full" is not expressible.** There is no row to decrement, so
   there is no natural place to express supply. The _only_ lever ops has over
   what customers can book is a **blackout** (`slot_blocks`) — covered in
   Chapter 8. If you ever need real capacity limits, that is a new concept,
   not a config change.
2. **Price, not stock, is the demand lever.** The picker prices each of the 24
   windows through the real pricing engine — closer to departure costs more.
   That lead-time curve is the mechanism that shapes demand. (Chapter 4.)

---

## 1.4 — Why `bags.ordinal` exists

A booking's bags are inserted in the same transaction and share `created_at`
**to the millisecond**. So insertion order is not recoverable from timestamps,
and array position is not stable across queries.

`ordinal` (`1..bag_count`) is the stable, human-facing number — the one an agent
reads off a tag and says out loud.

⚠️ **Sharp edge.** Order and label bags by `ordinal`, never by array position or
`created_at`. Anywhere you see bags rendered or matched, this is the key.

---

## 1.5 — The lifecycle: ten statuses, one authority

Ten booking statuses are declared in Postgres
([enums.ts](../../packages/db/src/schema/enums.ts)), but Postgres guarantees
only that a value is _in the set_. The **legal moves between them live in
exactly one file**:
[packages/core/src/booking/state-machine.ts](../../packages/core/src/booking/state-machine.ts).

```
draft → paid → agent_assigned → verified_sealed → awaiting_pickup
     → in_transit → delivered_to_bagdrop → completed
```

`exception` is reachable from every live state. `cancelled` is reachable until
the bags leave the customer.

🧭 **Decision hook.** Ordering is core's job, not the database's. A new status
or a new transition is a **core** change first; the enum migration is the
follow-on. If you ever find transition logic written in an app or a SQL
constraint, that is a bug — it means one of the three apps can now do something
the other two cannot.

---

## 1.6 — Three rules of the state machine

Worth memorising, because they shape a lot of downstream code:

1. **`cancel` disappears at `in_transit`**
   ([state-machine.ts:44-46](../../packages/core/src/booking/state-machine.ts#L44-L46)).
   Once a driver physically has the bags, "cancel" is not a thing that can
   happen in the real world. That situation is an `exception` and needs a human
   in the admin console.
2. **`exception` can still cancel**
   ([state-machine.ts:87](../../packages/core/src/booking/state-machine.ts#L87)).
   This is the escape hatch rule 1 creates: the path out of a
   bags-already-collected mess runs _through_ `exception`, with a human and a
   recorded reason, not around it.
3. **`completed` and `cancelled` are terminal.** There is no reopen. A reopen is
   a new booking.

⚠️ **Sharp edge.** Rules 1 and 3 together mean there is no "undo" anywhere in
this system. Every correction is a _forward_ move: a new transition plus an
appended compensating custody event. Nothing edits history — see Chapter 3.

---

## 1.7 — Three apps = three phases of the lifecycle

| App          | Owns                                                       |
| ------------ | ---------------------------------------------------------- |
| `apps/web`   | Customer: `draft` → `paid`                                 |
| `apps/agent` | Field: `agent_assigned` → `verified_sealed` → `in_transit` |
| `apps/admin` | Ops: assignment, exceptions, force-complete                |

🧭 **Decision hook.** When deciding where a feature goes, ask **which lifecycle
phase it belongs to** before asking which app has a convenient page. The apps
are phases, not audiences that happen to share a database.

---

## 1.8 — `paid` means authorized, not collected

Money is **authorized** at booking and **captured only once bags are in
Koolee's custody**.

The capture is a sweep, not an inline call: `captureDueBookings`
([payment-lifecycle.ts:149](../../packages/core/src/services/payment-lifecycle.ts#L149))
runs on an Inngest cron every 5 minutes, exposed at
[apps/web/src/app/api/jobs/capture-due/route.ts](../../apps/web/src/app/api/jobs/capture-due/route.ts)
and protected by `CRON_SECRET` (it **refuses to run** without one, so it can
never be triggered anonymously).

**Why a sweep and not "capture when the agent taps done":** the sweep lives in
`apps/web` because that is the app that holds Stripe credentials. The agent app
deliberately holds **none** — so it _cannot_ take the money at the moment it
completes a visit, and that is the point, not a limitation
([agent-visit.ts:275](../../packages/core/src/services/agent-visit.ts#L275)).

Cancellation before pickup voids the authorization or refunds.

🧭 **Decision hook.** This is why `paid` in the state machine means "we have an
authorization", not "we have the money". Any revenue reporting that reads
`status = 'paid'` is counting _promises_, not cash. Cash is in `payments`.

---

## 1.9 — A seal id belongs to exactly one bag

> Added 2026-08-15 (`2fe3a2b`). Numbered after 1.8 rather than beside 1.4
> because section numbers here never shift.

**The rule:** a bag is sealed only with **a unique seal id, a weight, and a
photo**. All three, or the bag is not sealed.

That trio _is_ the custody record — what was sealed, how heavy it was, what it
looked like at the door. It is what [1.1](#11--the-claim-and-why-it-is-a-hard-boundary)'s
promise is actually made of: a bag without it cannot be defended in a damage or
loss claim, and a claim is exactly when anyone looks.

**Uniqueness is operation-wide, not per booking.** Seals come off a single
numbered stock, so the id is globally unique by construction. Enforced by a
partial `UNIQUE` index on `bags.seal_id` (migration `0017`) — partial because
every unsealed bag holds `NULL` and those must not collide.

⚠️ **Sharp edge, and it already bit.** In agent testing, three bags in one
booking accepted the **same printed seal number**, and weight and photo were
both optional. Nothing in the app objected. The seal id is the thing that ties a
sealed bag to a custody event; two bags answering to one id makes the whole
record undefendable.

⚠️ **There is no override** — not even for a broken scale. An agent who cannot
weigh or photograph flags an exception instead of sealing. A "skip" button gets
used on the worst day, which is the day the evidence matters.

🧭 **Decision hook — where a rule like this belongs.** The guarantee is the
_index_. `recordBagSealed` also reads for a clash first, but only so the agent
sees an actionable sentence instead of a driver error, and it tells them which
case it is (same booking → "each bag needs its own seal"; another booking →
"check the number on the seal"). That read **races**, and that is accepted by
design.

The general shape: **app checks are for the message, constraints are for the
truth.** When you find yourself adding a validation that matters, ask what
holds when two requests arrive in the same millisecond. If the answer is
"nothing", the check belongs in the schema too — see
[MIGRATIONS.md §8](../MIGRATIONS.md#8-migration-history) for the same pattern in
`UNIQUE (booking_id, ordinal)` ([1.4](#14--why-bagsordinal-exists)) and
`payments (provider, provider_ref)`.

---

## Where to go next

- **Chapter 2** — Repo map & boundaries: the two import rules that keep three
  apps honest.
- Denser reference for this material:
  [CODEBASE-MAP.md §Chapter 1](../CODEBASE-MAP.md#chapter-1--the-product--its-nouns).
