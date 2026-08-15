# Booking funnel

> The customer path from landing page to a `draft` booking with an authorized
> payment. App: `apps/web` (`:3000`). Baseline: `dev` @ `2fe3a2b`.
> ← [Features index](README.md)

---

## 1. The marketing site

Route group `(marketing)` in [apps/web/src/app/(marketing)/](<../../apps/web/src/app/(marketing)/>):
home, `pricing`, `how-it-works`, `faq`, `airports`, `about`, `terms`,
`privacy`, `waitlist`.

⚠️ **Copy is constrained, not free.** Koolee delivers to the **airline's bag
drop** — never "we check you in", "handed to TSA", or "loaded onto your
aircraft". No fabricated statistics. This binds marketing, product UI, SMS and
email alike. The launch-pricing caveat is **pinned copy that must appear
wherever prices do**.

`waitlist` exists for out-of-coverage capture — see §3.

---

## 2. The funnel: four steps

Defined once in [booking-steps.ts:13](../../apps/web/src/lib/booking-steps.ts#L13),
shared by the client stepper _and_ the server guards:

| #   | Route          | Label        | Collects                                                        |
| --- | -------------- | ------------ | --------------------------------------------------------------- |
| 1   | `/book/flight` | Flight       | ZIP, flight number, airport, departure, passenger name          |
| 2   | `/book/pickup` | Pickup       | Address (line1/city/state) + bag count                          |
| 3   | `/book/slot`   | Window       | The chosen virtual pickup window                                |
| 4   | `/book/pay`    | Review & pay | Price quote + payment. **The auth gate lives inside this step** |

`/book` itself is a **route handler**, not a page
([book/route.ts](../../apps/web/src/app/book/route.ts)): it resumes the draft
wherever it left off.

### 2.1 — Retired routes still resolve

The funnel was compressed from seven pages to four (2026-08-09). Old links
redirect rather than 404:

| Retired         | Now                                           |
| --------------- | --------------------------------------------- |
| `/book/zip`     | → `/book` (ZIP folded into the flight step)   |
| `/book/address` | → `/book/pickup`                              |
| `/book/bags`    | → `/book/pickup`                              |
| `/book/price`   | → `/book/pay` (quote became the review panel) |

### 2.2 — The unlock model

A step is **unlocked when every step before it is complete**
([booking-steps.ts:41](../../apps/web/src/lib/booking-steps.ts#L41)).

- **Completed steps stay clickable** — a customer can jump back from pay to fix
  the flight without re-walking the funnel, and lands back at the frontier.
- **Locked steps are neither linked nor named** in the stepper.
- **The final step never reads complete** — finishing it creates a booking,
  which clears the draft ([booking-steps.ts:24](../../apps/web/src/lib/booking-steps.ts#L24)).

🧭 Because completion is derived from _draft field presence_, adding a required
field to an earlier step retroactively un-completes in-flight drafts. That is
usually correct — but it will bounce customers backward, so it is a migration
concern, not just a form change.

### 2.3 — Every destructive confirmation is ours

`ConfirmActionForm` ([confirm-action-form.tsx](../../apps/web/src/components/confirm-action-form.tsx))
wraps every draft-discarding surface — the stepper's "Start over", the dead-end
window card, My Trips "Discard" — in the shared `ConfirmDialog`, the same one
admin uses for custody overrides.

⚠️ **Do not reach for `window.confirm`.** It was used here and was replaced: the
popup is the browser's, not ours — unstyled, unbranded, worded differently on
every platform, impossible to test, and on mobile it renders as a system sheet
that looks like the OS interrupted the page.

The action is invoked **directly on confirm**, not through a real form submit:
`ConfirmDialog` owns the busy state and stays open until the promise settles,
which a form submit cannot report back. Props are `title` / `description` /
`confirmLabel` / `destructive` (default `true` — every use is a discard today,
but the prop exists for non-destructive reuse).

---

## 3. Coverage

NYC ZIP service area lives in
[packages/core/src/coverage/nyc-zips.ts](../../packages/core/src/coverage/nyc-zips.ts).
`assertInCoverage` is enforced again at booking creation, not only in the form —
the funnel check is UX, the core check is the rule.

Out-of-area entries are captured (`out-of-area-capture.tsx` → waitlist) rather
than dead-ended.

---

## 4. Pickup windows — computed, never stocked

[packages/core/src/slots/windows.ts](../../packages/core/src/slots/windows.ts)

For a flight departing at **T**, the bookable band is the 24 clock-aligned
one-hour windows whose **end** falls in `(T − reserve − band, T − reserve]` —
at the defaults, ends in **`(T − 30h, T − 6h]`**. That half-open interval
yields **exactly 24 windows for any T**, whether or not T is on the hour.

What limits choice is never stock:

| Limit                  | Default | Why                                                                                                                                   |
| ---------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **Operations reserve** | 6h      | The final hours belong to sealing, driving, bag drop. Applied as the **stricter** of the fixed reserve and the airline-cutoff formula |
| **Booking notice**     | 2h      | A window may not start sooner than this after booking — a driver must be dispatched                                                   |
| **Ops blackouts**      | —       | `slot_blocks` rows hide windows **without touching existing bookings**                                                                |

**There is deliberately no capacity.** Every window accepts unlimited bookings.

### 4.1 — Cutoffs

[cutoff.ts](../../packages/core/src/slots/cutoff.ts) resolves the per
airline × airport × domestic/international bag-drop deadline from
`airline_cutoffs`.

⚠️ **The system refuses to sell without a known airline cutoff**
(`CutoffUnknownError`). Adding an airline means seeding a cutoff, not just a
name.

### 4.2 — Timezone policy

All arithmetic is on **absolute instants**. "Clock-aligned" means aligned to
epoch hour boundaries, which coincide with local clock hours in every
whole-hour-offset zone — `America/New_York` qualifies year-round, including
DST. Each window is 60 _elapsed_ minutes by construction, so **DST transitions
cannot stretch or shrink one**; rendering the repeated or skipped wall-clock
hour is the display layer's problem. See [../TIME.md](../TIME.md).

---

## 5. Pricing

[packages/core/src/pricing/engine.ts](../../packages/core/src/pricing/engine.ts) —
**pure and total**: same inputs, same cents, no I/O, no clock, no env.

```
subtotal = base + (perBag × bags) + round(centsPerKm × distanceKm)
timed    = round(subtotal × leadTimeMultiplier)
total    = max(0, timed − discounts)
```

Money is **integer cents end to end**. The only floating point is intermediate
multiplier arithmetic, rounded once per stage at a defined point.

### 5.1 — The lead-time multiplier is the dynamic-pricing seam

Today it is a **step curve** over `pickupLeadMinutes` (how far the window's end
sits from departure), configured on the pricing rule: smallest matching step
wins, no match means ×1. **Closer to departure costs more.**

🧭 With no inventory to withhold, **price is the demand lever**. The window
picker prices all 24 windows through this real engine. A future dynamic-pricing
algorithm replaces `resolveLeadTimeMultiplier` only — the breakdown shape,
snapshot, and display already carry its output.

⚠️ `pricing_rules.slot_tier_multiplier` is **deprecated and read by nothing**.
It survives so pre-cutover rule rows keep their history.

### 5.2 — Discounts are stubs

`percent_off` and `flat_off_cents` are typed and wired; senior/family are
**placeholders for a commercial policy that has not been decided**. The seam
shape is fixed so callers can be written against it.

---

## 6. Drafts

`booking_drafts` holds a booking-in-progress before auth and payment.
Files: [booking-draft.ts](../../apps/web/src/lib/booking-draft.ts),
[booking-draft-schema.ts](../../apps/web/src/lib/booking-draft-schema.ts),
[draft-sync.ts](../../apps/web/src/lib/draft-sync.ts).

A draft must survive: page reload, tab close, **and the anonymous → real-user
upgrade** at the verify gate. There is a cookie fallback for when anonymous
sign-in is unavailable. Details in [auth.md](auth.md).

---

## 7. Creating the booking

[create-booking.ts](../../packages/core/src/services/create-booking.ts) is the
single entry point. In one transaction it:

1. Re-validates coverage (`assertInCoverage`).
2. Resolves the cutoff and re-evaluates the chosen window
   (`evaluateHourlyWindow`) — **a window shown is not trusted to still be
   sellable**; `SlotNotSellableError` if it is not.
3. Re-checks `slot_blocks`.
4. Prices through the real engine and snapshots the breakdown into
   `bookings.price_breakdown` (`price_cents` stays the authoritative charge;
   the breakdown is the receipt).
5. Inserts `bookings` + `bags` (with `ordinal` 1..n).
6. Authorizes payment through the `PaymentProvider` seam.
7. Moves `draft → paid` via `transitionOrThrow` and appends a custody event.

🧭 **Displayed-implies-accepted** is a tested property between the window
enumerator and booking acceptance — anything the picker shows must be
acceptable at creation.

### 7.1 — `bookedFromTz`

The browser-reported IANA zone is sanitized via `Intl`, and is **deliberately
permissive about failure**: a VPN or hardened browser costs us the analytics
field, never the booking.

---

## 8. After payment

| Route                          | Role                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------- |
| `/book/verify`                 | The auth gate — inside step 4, highlighted as "Review & pay"                    |
| `/book/return`                 | Route handler: the provider's redirect lands here and **re-checks server-side** |
| `/book/processing`             | Waiting state while confirmation settles                                        |
| `/book/confirmed`              | Success                                                                         |
| `/trips`, `/trips/[bookingId]` | The customer's bookings, with live custody timeline                             |

⚠️ **A client-side success signal is never trusted.** The booking moves only
through the state machine, driven by server-side reconciliation and webhooks.
See [payments.md](payments.md).

---

## 9. Ticket upload (partial)

`/api/ticket-uploads` + `ticket-upload.tsx` accept a ticket PDF; extraction is
seamed in [packages/core/src/extraction/](../../packages/core/src/extraction/)
with `heuristic/`, `claude/`, and `fake.ts` behind a factory.

Status: the seam is real, the Claude integration is **not wired for production**
(`ANTHROPIC_API_KEY` is documented as out of scope for the scaffold). See
[ticket-extraction.md](../../apps/web/docs/ticket-extraction.md).
