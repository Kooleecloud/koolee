# The verification visit — agent app core flow

Shipped 2026-08-09 (overnight run 1, Phase 6). The agent app is now
operationally usable for the core visit.

## Screen order (design call)

Arrive → photo-ID check → per-bag loop (photo · weight · seal id) →
completion. Steps unlock in order; completion is disabled until every bag
is sealed. A "flag a problem" escape hatch is always visible.

## Hard rails honoured

- **Every step appends a `custody_events` row** with the real agent user id,
  role, and timestamp; GPS lands in `lat`/`lng` when the browser grants
  geolocation (best-effort — denied/unavailable degrades to null, never
  blocks); the seal photo path lands in `photo_url`.
  Step events: `visit.arrived`, `visit.identity_verified`, `bag.sealed`;
  the matrix writes `booking.verified_sealed` on completion and Phase 5
  writes `booking.payment_captured`.
- **Task split unchanged**: this flow touches `verification_tasks` only;
  pickup tasks keep their placeholder card (driver flow is later work).
- **The visit's time IS the booking's pickup window.** `assignAgentToBooking`
  (`packages/core/src/services/dispatch.ts`) copies
  `bookings.pickup_window_start` / `pickup_window_end` onto both task rows'
  `scheduled_start` / `scheduled_end` at assignment. It no longer reads a
  slot row — pickup windows are virtual (enumerated per flight, no
  inventory), so the booking carries its window directly. The Today list
  filters and sorts on `scheduled_start`, and the visit header renders the
  window; a task with no window shows "unscheduled", sorts last, and stays
  on Today until it is done rather than disappearing.
- **Completion triggers the Phase 5 capture** (`captureBookingPayment`).
  Capture failure is ops-visible: booking → `exception` through the matrix,
  custody event with the reason, critical ops alert — and the agent sees
  "ops has been alerted, don't hand back the bags", never a fake success.
- **Copy never overclaims** — completion says the bags are in Koolee's
  custody "until the airline's bag drop".
- **Photos**: PRIVATE `bag-photos` bucket, server-side upload. The agent app
  holds NO service key, so uploads run as the signed-in agent over the anon
  key, gated by storage RLS: only ACTIVE STAFF can write/read (migrations
  `0008` + `0009`; the staff check is a SECURITY DEFINER function so the
  `staff_members` table itself stays closed to PostgREST). Reads are
  signed-URL only.

## Authorization

Assignment IS the authorization: every core function
(`packages/core/src/services/agent-visit.ts`) resolves the task by
`(id, assignee = session.userId)` — another agent's task id behaves like a
missing one.

## Exceptions

Reasons: customer not home, ID mismatch, bags refused, unsafe conditions,
other (note required). Flagging moves the booking to `exception` with the
reason in the custody event, marks the task `failed`, and warns ops.
Resolution deliberately does NOT live here — that's the admin console's
manual-override territory (Phase 7); rejected/lost-bag flows remain
deferred (#17).

## Offline

No offline sync (out of scope by instruction). Every action fails with a
clear "check your connection and try again" and the form keeps the typed
values (`usePreservedFormValues`), so a retry is one tap.

## Dev notes

- The fake payment provider's ledger is in-memory per process; the payments
  factory shares one instance per process so authorize → capture works in
  dev. A booking seeded by SQL (no in-process authorization) exercises the
  capture-failure path instead — useful for demoing the exception rail.
- QR/RFID seal scanning: TODO(agent-flow) — manual entry ships first, the
  seal id stays an opaque string (decision #18 unchanged).

## Tests

`packages/core/src/services/agent-visit.integration.test.ts` — full happy
path (arrive idempotency, per-bag seals with photos/weights, completion,
capture through the seam, booking advanced, task closed, every event's
actor asserted, append-only re-proven); completion refused with unsealed
bags; exception path (state + reason + actor); assignment scoping.
