# Koolee — Codebase Map

> A teaching map of the repo, written chapter by chapter. Map level, not
> reference level: concepts, flows, and pointers to the files that hold the
> detail. For _what is shipped / what is next_, read
> [PROJECT-STATUS.md](../PROJECT-STATUS.md). For _how to run it_, read
> [README.md](../README.md).
>
> Baseline: `dev` @ `ad65272`.

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

| Noun          | Table                                | What it is                                                                                                                                                                                                                              |
| ------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Booking       | `bookings`                           | One customer, one flight, one pickup window. The spine everything hangs off.                                                                                                                                                            |
| Draft         | `booking_drafts`                     | A booking-in-progress before auth/payment. Survives page reloads and anonymous → real-user upgrade.                                                                                                                                     |
| Bag           | `bags`                               | One physical bag. Weight, photos, a `seal_id`, and an `ordinal` (`1..bag_count`) — the number a human reads off the tag. Order and label by `ordinal`, never by array position: a booking's bags share `created_at` to the millisecond. |
| Seal          | `bags.seal_id`                       | Opaque tamper-evident ID. Deliberately technology-agnostic (RFID vs printed QR is still undecided — no migration either way).                                                                                                           |
| Custody event | `custody_events`                     | Append-only chain of custody: who held which bag, where, when, with photo evidence.                                                                                                                                                     |
| Pickup window | _(none — computed)_                  | The hour the agent comes. **Not a row.** Every flight gets the same 24 clock-aligned one-hour windows, enumerated on demand; the booking stores the one it bought in `bookings.pickup_window_start/end`.                                |
| Blackout      | `slot_blocks`                        | Ops hiding a span of windows at an airport (weather, no drivers). The only lever over what customers can book.                                                                                                                          |
| Cutoff        | `airline_cutoffs`                    | Per airline × airport × domestic/international — the latest a bag can be dropped. One of the two deadlines that bound the window band.                                                                                                  |
| Task          | `verification_tasks`, `pickup_tasks` | The unit of work an agent or driver sees.                                                                                                                                                                                               |
| Payment       | `payments`, `payment_webhook_events` | Intent → authorize → capture. Webhook events table is the replay guard.                                                                                                                                                                 |
| Staff member  | `staff_members`                      | Invite-only agent/admin accounts.                                                                                                                                                                                                       |
| Waitlist signup | `waitlist_signups`                 | One (email, ZIP) pair — "this person wants service in this zone." Unique together; `notified_at` stamps the one promised "you're covered" email.                                                                                        |

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

**The second boundary.** `packages/core` reads no environment variables and
imports nothing from Next.js. Apps resolve their own credentials in a
zod-validated `env.ts` and hand the results to core as a `CoreConfig`
([config.ts](../packages/core/src/config.ts)). That is what makes core
testable without a process environment and reusable from a job runner.

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
| `identity.ts`    | `users`, `addresses`, `agents`, `drivers`             |
| `airports.ts`    | `airports`, `airline_cutoffs`                         |
| `bookings.ts`    | `bookings`, `bags`                                    |
| `slots.ts`       | `slots` _(legacy — see below)_                        |
| `slot-blocks.ts` | `slot_blocks`                                         |
| `custody.ts`     | `custody_events`                                      |
| `tasks.ts`       | `verification_tasks`, `pickup_tasks`                  |
| `billing.ts`     | `payments`, `pricing_rules`, `payment_webhook_events` |
| `drafts.ts`      | `booking_drafts`                                      |
| `uploads.ts`     | `ticket_uploads`                                      |
| `staff.ts`       | `staff_members`                                       |
| `otp.ts`         | `otp_send_log`                                        |
| `ops.ts`         | `routes`                                              |
| `waitlist.ts`    | `waitlist_signups`                                    |

One non-table module lives beside them: `coverage-zips.ts` — the service-area
ZIP data as pure constants, imported by core's coverage logic AND the seed via
the `@koolee/db/coverage-zips` subpath (pure data, no driver, so client
bundles that reach it through core stay clean). Data here, semantics in core:
the seed needs the list and core depends on db, never the reverse.

**The legacy table.** `slots` predates virtual pickup windows. Nothing sells
from it; new bookings leave `slot_id` NULL and carry
`pickup_window_start/end` instead. It survives only so pre-cutover bookings
keep their foreign key. Do not add to it — see Chapter 4.

**Invariants worth memorising:**

- `custody_events` is append-only, enforced by a database trigger that
  rejects `UPDATE` / `DELETE` / `TRUNCATE`. Corrections are new rows. This is
  the evidentiary spine of the product; if it were mutable it would be
  worthless in a dispute.
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
2. **`packages/db/.env` points at the HOSTED project.** A bare `pnpm seed` or
   `pnpm db:migrate` targets production data unless the shell overrides the
   URL. Use `pnpm seed:local`, or set `DATABASE_URL` inline.

**The seed** ([seed.ts](../packages/db/src/seed.ts)) is idempotent reference
data only — airports, airline cutoffs, one pricing rule. It seeds no bookings
and, since windows went virtual, no inventory. There is nothing in it that
can go stale with the calendar.

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

| Seam              | Interface                | Real                                    | Fake / default                         |
| ----------------- | ------------------------ | ---------------------------------------- | -------------------------------------- |
| Payments          | `PaymentProvider`        | Stripe adapter                           | `FakePaymentProvider` (in-memory, dev) |
| Ticket extraction | `TicketExtractor`        | Claude                                   | Heuristic parser                       |
| Email             | `Notifier`               | `ResendNotifier` (REST, injectable fetch) | `ConsoleNotifier` (logs)               |
| SMS dispatch      | `NotificationDispatcher` | _(unbuilt — Twilio later)_               | `NoopDispatcher` (logs)                |
| Ops alerts        | `OpsAlerter`             | _(unbuilt)_                              | `ConsoleOpsAlerter`                    |
| Clock             | `Clock`                  | `systemClock`                            | `fixedClock(instant)` for tests        |
| Sessions          | `SessionReader`          | Supabase per app                         | injected per request                   |
| Staff roles       | `assertRole`             | `requireStaffRole`                       | injected                               |

Email selection mirrors the payments factory: apps resolve `RESEND_API_KEY` /
`RESEND_FROM` in their env and pass `createRuntime` a
`notifications: { kind: "resend" | "console", … }` config —
`createNotifier` builds the adapter, core reads no env. Templates are pure
builders in [notifications/emails.ts](../packages/core/src/notifications/emails.ts),
copy rules pinned by tests.

`CoreConfig` ([config.ts](../packages/core/src/config.ts)) is the bundle: db,
payments, dispatcher, alerter, extractor, clock, and `defaults`
(`CoreDefaults` — the window fences and currency). Apps build it once per
request in their `lib/core.ts`.

**Payments** ([payments/types.ts](../packages/core/src/payments/types.ts)) is
the richest seam: `authorize`, `getAuth`, `updateAuthAmount`, `capture`,
`refund`, `cancelAuth`, and webhook verification. `getAuth` exists because a
client-side success signal is never trusted — see Chapter 8.

**Services** ([services/](../packages/core/src/services/)) are the app-facing
API: `create-booking`, `windows` (window listing + blackout CRUD), `quote`,
`bookings` (transitions + session-scoped reads), `dispatch`, `payment-intent`,
`payment-lifecycle`, `agent-visit`, `customers`, `addresses`,
`booking-drafts`, `ticket-uploads`, `staff`, `tasks`, `webhooks`. Two more
modules sit beside `services/`: `waitlist/` (`recordWaitlistSignup` — the
idempotent (email, zip) upsert behind both capture surfaces — and
`notifyNewlyCoveredWaitlist`, the zone-opened sweep's engine) and
`auto-assign` in `services/` whose `autoAssignOnPaid` hook fires from every
path a booking takes to `paid` (webhook, return-page re-check, fake-provider
inline) — never throws, never fails the payment path; the 0019 unique
indexes referee the webhook/re-check race.

A service is where ownership is enforced. Session-scoped reads are
404-shaped on a foreign id — existence is itself a disclosure — and the
`…ForSession` suffix marks the functions that carry that guarantee.

**Jobs** are eight Inngest functions, all served from apps/web
([api/inngest/route.ts](../apps/web/src/app/api/inngest/route.ts)) — six in
[jobs/functions.ts](../packages/core/src/jobs/functions.ts) plus two defined in
[apps/web/src/lib/inngest.ts](../apps/web/src/lib/inngest.ts):

| function                     | trigger                             | live?                                          |
| ---------------------------- | ----------------------------------- | ----------------------------------------------- |
| `capture-due-bookings`       | `cron("*/5 * * * *")`               | yes — charges cards once bags are in custody   |
| `cutoff-risk-monitor`        | `cron("*/5 * * * *")`               | yes                                            |
| `cleanup-anonymous-users`    | daily 04:00 ET                      | yes                                            |
| `booking-confirmation-email` | event `booking/confirmed`           | yes — real email via the Notifier seam         |
| `booking-pickup-reminder`    | event `booking/confirmed`           | yes — email real, SMS console until Twilio     |
| `exception-ops-alert-email`  | event `booking/exception_raised`    | yes — to `OPS_ALERT_EMAIL` (unset = skip)      |
| `waitlist-zone-opened-sweep` | daily 10:00 ET                      | yes — the waitlist's promised email            |
| `agent-no-show-check`        | event `booking/agent_no_show_check` | **never fires** — that event is still unsent   |

The `booking/confirmed` and `booking/exception_raised` events are actually
emitted now (2026-08-23) from
[apps/web/src/lib/booking-events.ts](../apps/web/src/lib/booking-events.ts):
every path to `paid` emits with a deterministic id, keyed on "this call
performed the move" so redeliveries and races never re-fire — see
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
private bucket, runs extraction, and writes the result into a _quarantined_
`ticketPrefill` key. Only the flight review form reads it, as editable
defaults. Confirming that form is what promotes user-confirmed values into
real draft keys — extracted values never reach a booking field unseen.

**The window step** ([slot/page.tsx](../apps/web/src/app/book/slot/page.tsx))
calls `listBookableWindows`, which returns each window already priced through
the real engine. It renders a grid of time+price tiles grouped by airport-local
day, with one line of explanation. Unbookable windows are not rendered at all —
a greyed-out graveyard only raises questions the customer cannot act on.

**The pay step** shows the full review and price to _anonymous_ visitors, with
the verify gate behind the CTA. The price is never hidden behind auth. The hard
gates live in the server actions (`confirmBooking`, `preparePayment`), never in
the page.

---

## Chapter 7 — Auth

**Three session kinds**, one Supabase project
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

**Cookie names are per app.** All three apps share one Supabase project, and
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
with an offline fallback page. Routes are few on purpose — `/` (today's tasks),
`/tasks`, `/tasks/[taskId]`, `/scan`, plus auth.

**Task-scoped authorization.** An agent is not a role with broad read access;
they can see exactly the tasks assigned to them. `getAssignedTask` carries the
assignee in the WHERE clause rather than checking after the fact, so an
unassigned task id simply does not resolve.

**The visit flow** ([agent-visit.ts](../packages/core/src/services/agent-visit.ts))
is a sequence of appended custody events, not a form submit: arrive → verify
identity → seal each bag → complete. Completing the visit moves the booking to
`verified_sealed`.

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
([src/lib/photo.ts](../apps/agent/src/lib/photo.ts)): 3–8 MB phone captures blew
the 1 MB Server Action body limit and `413`'d before the action ran. Resize to
1600px / ~700 KB client-side, best-effort, with `serverActions.bodySizeLimit`
raised to `4mb` purely as a safety net.

Anything that goes wrong is a first-class outcome: `reportVisitException`
moves the booking to `exception` with a reason, which surfaces in the admin
console. The agent never edits history — corrections are new events.

**Task schedules** (`scheduled_start` / `scheduled_end`) are copied from the
booking's pickup window at assignment time. They are a snapshot for the
agent's list, not a live join.

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

**Five pages**, each a server component + a `actions.ts` + a client form file:

| Route         | What it does                                                                                |
| ------------- | ------------------------------------------------------------------------------------------- |
| `/`           | Dashboard: today's bookings by status, unassigned count, open exceptions — all real queries |
| `/bookings`   | Dispatch board: filter by status/airport/day, assign an agent, see at-risk bookings. Since 2026-08-23 assignment is automatic on `paid` (`autoAssignOnPaid`); the board's Assign button is the manual override, and an uncovered ZIP still falls through to it via the at-risk flag |
| `/blocks`     | Window blackouts — the ops lever over what customers can book                               |
| `/exceptions` | Bookings in `exception`, with the three legal resolutions                                   |
| `/staff`      | Invite / list / deactivate agents and admins                                                |

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

## Chapter 11 — UI package & brand

**`packages/ui`** holds every shared component — layout (`AppShell`,
`AppHeader`, `ContentColumn`, `Section`, `PageHeader`), primitives (Button,
Card, Input, Select, Dialog, Badge, …), and domain components
(`CustodyTimeline`, `BookingStatusBadge`, `PriceEstimator`, `OtpInput`,
`PhoneInput`, `SealMotif`).

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

**`CustodyTimeline` is the visual signature** — the same motif on the marketing
custody section (`horizontal`) and the live trip page and ops trail
(`vertical`), so the promise and the product are literally the same drawing.
State reads through the dot: **navy** for a hand-off already banked, **seal
orange, pulsing** for the one happening now, **hollow** for what is ahead; the
rail is always sky. Exactly one dot is orange per timeline, which is what keeps
orange meaning "this, now".

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

**Three Next apps, one Supabase project, one Stripe account.** Each app
deploys independently and reads its own env, validated at boot by a
zod-parsed `env.ts`.

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

**Deploy checklist**, in order:

1. Apply pending migrations to the hosted project over the direct connection.
   _(Migration `0012` — virtual windows — is applied locally but **not** yet
   hosted.)_
2. Seed reference data if the project is new (`pnpm seed` with the hosted URL:
   airports, cutoffs, pricing rule).
3. Set per-app env per the [README matrix](../README.md), including the
   Stripe webhook secret.
4. Point the Stripe webhook endpoint at the deployed web app.
5. Verify the boot assertions pass — a failed assertion is the intended
   outcome of a missing secret, not a bug to work around.

Open items before a real launch are tracked in
[pre-launch-security.md](../apps/web/docs/pre-launch-security.md) and
[PROJECT-STATUS.md](../PROJECT-STATUS.md) (notably: real AeroAPI/Maps/SMS
integrations, and the Inngest jobs' side effects).
