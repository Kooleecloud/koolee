# Cancellation — who may call it off, and who is recorded as having done it

> **How a booking stops, from the button a customer presses to the sentence an
> agent reads on the doorstep task that is no longer happening.** Baseline:
> `feat/f5-cancellation-map-ux`.
>
> For the state machine itself read
> [../CODEBASE-MAP.md](../CODEBASE-MAP.md#the-state-machine). For the money read
> [payments.md](payments.md).

---

## 1. There is one cancellation, and three ways in

Everything that cancels a booking ends in the same function —
`cancelBookingWithRefund` in `services/payment-lifecycle.ts` — which runs the
state machine's `cancel` event, releases the slot, writes the custody event and
unwinds the money through the payment seam: a captured payment refunded in
full, an uncaptured authorization voided.

| Who                  | Entry point                                           | Gates before it                         |
| -------------------- | ----------------------------------------------------- | --------------------------------------- |
| The customer         | `cancelBookingByCustomer`                             | Ownership, then three policy gates (§2) |
| Ops, on an exception | `resolveExceptionBooking("cancel_and_refund")`        | A required reason                       |
| Ops, directly        | `applyTransition(… "cancel")` via the manual override | The state machine's own matrix          |

**A second implementation is the thing this avoids.** The customer's path is
policy _around_ the console's call, not a parallel one — so the transition, the
slot compensation, the custody event and the refund behaviour cannot drift
between them. The only differences are who the actor is and which gates had to
pass first.

---

## 2. The customer's three gates

`customerCancelEligibility` in `services/cancellation.ts`, and **both the trip
page and the server action call it**. A button rendered against one rule and a
server refusing against another is how somebody ends up pressing something that
cannot work.

### Status: `paid` or `agent_assigned` only

Deliberately narrower than the state machine, which accepts `cancel` from
`verified_sealed` and `awaiting_pickup` as well. Those two mean **the visit has
happened** — an agent stood at a door, checked a passport against a face,
weighed and photographed bags and put numbered seals on them. Undoing that is a
conversation, and the seals have to be accounted for by somebody. Ops can still
cancel from there; the customer is pointed at support.

### Window: `now < pickup_window_start`, and no window fails

Free self-cancel ends when the window opens: up to that point nobody has been
dispatched to a door on this booking's account, and after it an agent may
already be outside.

A booking with **no window at all** (the column is nullable) fails this gate.
Refusing to guess is the only safe reading — guessing wrong either cancels
something already in flight or charges somebody who asked in time.

### Capture: nothing captured, across every provider

An authorization is released and nobody is out of pocket. A **capture** is
money that has left the customer's account, and giving it back is a refund
decision with a fee policy this product does not have yet (see the
`TODO(fee-policy)` on `cancelBookingWithRefund`). Ops refunds; a button does
not.

The lookup is deliberately wider than `cancelBookingWithRefund`'s, which scopes
to the configured provider: a capture recorded under a provider we no longer
configure is still money gone.

> **The gate is re-checked server-side**, always. A Server Action stays a
> reachable POST whatever the page drew — the same reasoning that keeps the
> identity gate in core rather than in the agent app.

---

## 3. Who cancelled it

`custody_events` has recorded `actor_user_id` and `actor_role` on the
`booking.cancelled` event since the state machine was written. **Nothing
rendered it until F5**, so "was this them or us?" — the first question a
support call about a cancelled booking opens with — meant reading a
twenty-event timeline to the row that happens to say `booking.cancelled`.

`cancellationFromTimeline` reads it off a trail the caller already has (no
second query), and `by` is derived from the actor's **role**, not by comparing
the actor to the booking's owner: an admin cancelling their own personal
booking is still Koolee cancelling it, and the customer should read it that way.

| Surface                | What it says                                                                                                                                             |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Customer trip page     | "Cancelled by you on `<date>`" — the hold was released, nothing charged; or "Cancelled by Koolee on `<date>`", with support offered and the reason shown |
| Agent task detail      | "Cancelled by the customer · `<when>`", above the record of what happened before it stopped                                                              |
| Console booking detail | A banner under the actionability notice: who, their role, the timestamp and the reason                                                                   |
| Console custody trail  | Actor name, face and role on the event itself — this always worked                                                                                       |

A cancellation with **no actor** came from a job or a webhook. The customer sees
the Koolee wording rather than a third variant: "cancelled automatically" is a
fact about our plumbing that answers nothing they asked.

---

## 4. What a cancelled booking stops offering

Cancelling **touches no task row**. `applyTransition` writes one booking row and
one custody event; the verification and pickup tasks keep whatever status they
had. Every derivation that reads _task_ status therefore had to be taught about
it separately, and each one was a separate bug.

- **The agent's day** (F4): a cancelled booking kept its `pending` verification
  task and rendered as an ordinary stop with a working "Start & navigate".
- **The agent's task DETAIL** (F5): opening that card was untouched — the page
  still drew a live Navigate link, a live Call button and the whole guided
  flow. It now asks `bookingActionability(...).standing === "terminal"`, the
  same service the card consults and core enforces with.
- **The day's counts** (F5): `isFinished` is `state === "done"` only, so every
  count using "not done" to mean "work" included cancelled stops — "3 to do",
  "· 1 late", "Your route · 3 stops", and the current-stop slot.
  `isOutstanding` is that predicate, kept separate from `isFinished` because
  History lists work somebody _did_.
- **Assignment** (F5): three call sites each carried their own status list and
  none mentioned `cancelled`. `assignmentGate` is now the one answer.

**The stop stays visible** throughout — dimmed, badged, struck through, never
late, never counted, and still openable. A schedule that quietly loses stops is
one nobody can reconcile against what they actually did, and the detail page
behind it is the only place that says who cancelled it.

---

## 5. Honest refusals

A domain refusal and a dropped connection are different failures, and the agent
app used to answer both with the same sentence. A driver on a cancelled pickup
read **"Couldn't start pickup. Check your connection and retry."** — an
instruction to keep trying, about a job that no longer existed.

`actionErrorMessage` (`apps/agent/src/lib/action-error.ts`) matches
`CoreError`, the **base class**: every domain refusal is one, and every one
carries a message written to be read. A list of subclasses is what caused the
bug — the handler matched two, so `BookingNotActionableError` fell through.
Transport failures still say "check your connection", and only they are logged:
a console full of correct refusals is a console nobody reads.

---

## 6. No ops email, by design

Cancellations emit no ops alert. A customer cancelling before their window is
routine, and an inbox that receives routine events is one nobody reads when
something is wrong. The console's board and the booking's own status carry it.

The console has no "recent activity" feed, so none was built — adding a surface
to hold one notification would be building the feed the brief said not to.
