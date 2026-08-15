# Chapter 1 — The product & its nouns

> **Verified against `origin/dev` @ `b17a7de`.** ← [Learning track index](README.md)
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
([README.md:153-171](../../README.md#L153-L171)), binding on marketing copy,
product UI, transactional SMS and email alike:

- **Say:** "delivered to your airline's bag drop."
- **Never say:** "we check you in" (the customer does that with the airline),
  "handed to TSA" (we hand bags to the airline), "loaded onto your aircraft"
  (the airline does that).
- **No fabricated statistics.** No "10,000+ customers", no invented ratings, no
  made-up on-time percentages. If a number is not measured, it does not ship.

🧭 **Decision hook.** Treat this as a *product constraint*, not a style
preference. It is the reason nothing in the codebase models a boarding pass, a
seat, or a TSA interaction. Any feature that would require Koolee to represent
what happens *after* the bag drop counter is out of scope by construction — and
you would be adding the first such model, not extending an existing one.

---

## 1.2 — The nouns and the tables they live in

| Noun              | Lives in                             | What it is                                                                                   |
| ----------------- | ------------------------------------ | -------------------------------------------------------------------------------------------- |
| **Booking**       | `bookings`                           | One customer, one flight, one pickup window. The spine everything hangs off.                  |
| **Draft**         | `booking_drafts`                     | A booking-in-progress before auth/payment. Survives reload and anonymous → real-user upgrade. |
| **Bag**           | `bags`                               | One physical bag: weight, photos, a `seal_id`, and an `ordinal`. See [1.4](#14--why-bagsordinal-exists). |
| **Seal**          | `bags.seal_id`                       | Opaque tamper-evident ID. Deliberately technology-agnostic — RFID vs printed QR is still undecided, and neither needs a migration. |
| **Custody event** | `custody_events`                     | Append-only chain of custody: who held which bag, where, when, with photo evidence.            |
| **Pickup window** | _(none — computed)_                  | The hour the agent comes. **Not a row.** See [1.3](#13--windows-are-not-inventory).             |
| **Blackout**      | `slot_blocks`                        | Ops hiding a span of windows at an airport (weather, no drivers).                              |
| **Cutoff**        | `airline_cutoffs`                    | Per airline × airport × domestic/international — the latest a bag can be dropped.               |
| **Task**          | `verification_tasks`, `pickup_tasks` | The unit of work an agent or driver sees.                                                      |
| **Payment**       | `payments`, `payment_webhook_events` | Intent → authorize → capture. The second table is the webhook replay guard.                    |
| **Staff member**  | `staff_members`                      | Invite-only agent/admin accounts.                                                              |

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
   there is no natural place to express supply. The *only* lever ops has over
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
only that a value is *in the set*. The **legal moves between them live in
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
   bags-already-collected mess runs *through* `exception`, with a human and a
   recorded reason, not around it.
3. **`completed` and `cancelled` are terminal.** There is no reopen. A reopen is
   a new booking.

⚠️ **Sharp edge.** Rules 1 and 3 together mean there is no "undo" anywhere in
this system. Every correction is a *forward* move: a new transition plus an
appended compensating custody event. Nothing edits history — see Chapter 3.

---

## 1.7 — Three apps = three phases of the lifecycle

| App          | Owns                                                          |
| ------------ | ------------------------------------------------------------- |
| `apps/web`   | Customer: `draft` → `paid`                                     |
| `apps/agent` | Field: `agent_assigned` → `verified_sealed` → `in_transit`     |
| `apps/admin` | Ops: assignment, exceptions, force-complete                    |

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
deliberately holds **none** — so it *cannot* take the money at the moment it
completes a visit, and that is the point, not a limitation
([agent-visit.ts:275](../../packages/core/src/services/agent-visit.ts#L275)).

Cancellation before pickup voids the authorization or refunds.

🧭 **Decision hook.** This is why `paid` in the state machine means "we have an
authorization", not "we have the money". Any revenue reporting that reads
`status = 'paid'` is counting *promises*, not cash. Cash is in `payments`.

---

## Where to go next

- **Chapter 2** — Repo map & boundaries: the two import rules that keep three
  apps honest.
- Denser reference for this material:
  [CODEBASE-MAP.md §Chapter 1](../CODEBASE-MAP.md#chapter-1--the-product--its-nouns).
