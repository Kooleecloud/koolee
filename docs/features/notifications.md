# The notification matrix

> **Every moment Koolee tells somebody something, on which channel, and why
> the gaps are gaps.** Baseline: `feat/f2-live-ux`. ← [Features index](README.md)
>
> This is the living table. For how the jobs are wired and served read
> [jobs-and-notifications.md](jobs-and-notifications.md); for the live-update
> mechanism read [realtime-signals.md](realtime-signals.md).

---

## 1. The matrix

**In-app** means the screen updates itself through the realtime signal — no
reload, no tap. A ✱ marks the few that also raise a toast, because the screen
grew something that needs a decision. **Email** is the `Notifier` seam (Resend
in production, console in dev). **SMS** is parked.

| Moment | Customer in-app | Customer email | Agent / driver in-app | SMS |
|---|---|---|---|---|
| Booking confirmed (paid) | live | `booking-confirmation-email` | verification task appears | parked |
| Agent assigned | live | **`agent-assigned-email`** — "Nina is on your pickup" | — | parked |
| Agreement accepted | live card | — | gate unlocks ✱ | parked |
| Passport uploaded / confirmed | live card | — | gate unlocks ✱ | parked |
| Visit started (agent arrived) | live timeline | — | — | parked |
| Bags sealed → `verified_sealed` | live timeline + shortlist ✱ | **`bags-sealed-email`** — seal numbers + "choose your driver" | — | parked |
| Driver selectable | (same moment — see below) | (same email) | — | parked |
| Driver selected | live | `driver-selected-email` | pickup task is theirs ✱ | parked |
| Picked up / in transit | live timeline + moving ETA ✱ | — | — | parked |
| Delivered to bag drop | live ✱ | `bagdrop-delivered-email` | — | parked |
| Exception raised | live status ✱ | **`exception-customer-email`** — generic | live notice | parked |
| Exception raised (ops) | — | `exception-ops-alert-email` — full reason | — | — |
| No driver could be offered (ops) | — | `driver-pool-empty-ops-alert` | — | — |
| Running late / missed cutoff | live notice | — | live notice | parked |
| Pre-window reminder (T−2h) | — | `booking-pickup-reminder` | — | console until Twilio |

**Bold** rows are new in F2.

---

## 2. The decisions inside the table

### Sealed and selectable are ONE email

The matrix these rows came from listed "bags sealed — a summary" and "driver
selectable — a link" as two messages. They fire at the same instant:
`verified_sealed` is both the moment the last seal goes on and the moment
`DRIVER_SELECTABLE_STATUSES` opens the shortlist. Two emails seconds apart is a
worse product than one that says both things, so `bags-sealed-email` carries
the seal numbers **and** the "choose your driver" call to action.

The seal numbers are the reason the email exists at all. They are the
customer's evidence that the bag reaching the airline is the bag that left
their door; a summary without them is a status update.

### The customer's exception email carries no reason

`exception-ops-alert-email` gets the detail because ops can act on it.
`exception-customer-email` deliberately does not, and it is a **separate
function on the same event** rather than a second send inside the first.

Three reasons the internal reason must not travel:

1. It is written for an operator — "ID mismatch", "customer not home",
   "capture failed after retry" — and reads as an accusation, a confession, or
   gibberish depending on which fired.
2. It can name staff, a payment provider, or an internal state.
3. It is frequently **wrong in the first minute**, because an exception is
   raised before anybody has looked.

Two functions rather than one because Inngest retries a *function*: a combined
handler whose ops send failed would re-send the customer half on retry.

If no support address is configured the customer email is **skipped**, not sent
with a placeholder. Handing somebody an unmonitored address at the moment they
most need a reply is worse than saying nothing.

### The agent-assigned email carries no photo

The trip page shows the agent's face; the email does not. An avatar is a signed
URL into a private bucket with an hour's TTL, and an email is read whenever it
is read — an `<img>` would be a broken image more often than a face. The email
says the photo is on the trip page and links there.

### What has no notification, on purpose

- **Running late / missed cutoff.** These are computed from the clock
  (`services/actionability.ts`); nothing is written when they become true, so
  there is nothing to signal and nothing to trigger a send. Both surfaces show
  the notice on their next render, which the polling fallback guarantees within
  30 seconds. An email here would also be the product's least welcome message,
  sent by a timer, with no action attached.
- **Visit started.** The customer is standing next to the agent.
- **Driver selected, to the customer.** They just did it.

### SMS is parked, and the column stays

Twilio A2P registration is not complete. The column is kept rather than deleted
so the seam's future is explicit and the next person does not have to work out
whether SMS was considered. The only SMS path that exists today is the pickup
reminder's `NotificationDispatcher` call, which logs.

---

## 3. Idempotency

Every emit uses the established event-id pattern, and Inngest drops a repeated
id. The keys, and why each is shaped the way it is:

| Event | Id | Why |
|---|---|---|
| `booking/confirmed` | `booking-confirmed:<bookingId>` | Three paths reach `paid` and two of them race |
| `booking/agent_assigned` | `booking-agent-assigned:<bookingId>:<agentUserId>` | Coarser than the write ON PURPOSE: ops re-picking the same agent is not news, a different agent is |
| `booking/bags_sealed` | `booking-bags-sealed:<bookingId>:<custodyEventId>` | One custody row per sealing, ever |
| `booking/exception_raised` | `booking-exception:<bookingId>:<custodyEventId>` | One row per raise; a retried caller that moved nothing emits nothing |
| `booking/driver_selected` | `booking-driver-selected:<bookingId>:<custodyEventId>` | Re-choosing IS news, so it keys on the new event |
| `booking/delivered_to_bagdrop` | `booking-delivered:<bookingId>:<custodyEventId>` | One delivery |
| `booking/driver_pool_empty` | `booking-driver-pool-empty:<bookingId>:<utcHour>` | Raised from a render; the hour bucket IS the rate limit |

---

## 4. Where each event is raised

Emission lives beside the fact, never at a route handler — the rule the
exception alert had to learn when six of seven paths went silent for a slice.

| Event | Raised by |
|---|---|
| `booking/confirmed` | `apps/web/src/lib/booking-events.ts`, from every path to `paid` |
| `booking/agent_assigned` | `assignAgentToBooking` (dispatch.ts) — the one write path shared by the manual assign and `autoAssignBooking` |
| `booking/bags_sealed` | `applyTransition` on arrival at `verified_sealed` |
| `booking/exception_raised` | `applyTransition` and the webhook's `moveBooking` |
| `booking/driver_selected` | `selectDriver` (driver-selection.ts) |
| `booking/delivered_to_bagdrop` | `deliverToBagdrop` (pickup.ts) |
| `booking/driver_pool_empty` | the trip page render, via `reportEmptyDriverPool` |

`booking/agent_no_show_check` is still never sent — the one catalogued event
with no producer.

---

## 5. Copy rules, asserted

`emails.test.ts` runs every builder through the same gauntlet:

- **never** "check you in", in text or HTML, in any message;
- customer-facing messages say **"your airline's bag drop"**;
- every message carries a plain-text body (deliverability), HTML is the upgrade;
- **Tag Orange appears exactly once, on the CTA** — a message with no CTA has
  no orange anywhere;
- interpolated values are HTML-escaped;
- and, specific to F2: the customer exception email is checked against a list
  of internal phrases it must never contain.
