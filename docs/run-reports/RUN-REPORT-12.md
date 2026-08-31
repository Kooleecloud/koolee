# Run report 12 — the UX pass: 24 complaints, six batches

**Branch:** `feat/ux-pass-addresses-profile`, cut from
`feat/tier5-launch-readiness` with `--no-track`
(`branch.feat/ux-pass-addresses-profile.merge` verified empty; `git status -sb`
shows no upstream).

**Why not off `dev`.** The standing rule is to cut from latest `origin/dev`.
`feat/tier5-launch-readiness` has seven unpushed commits this work depends on —
Places autocomplete, the ETA seam, the Sentry wiring — so branching off `dev`
would have meant rebuilding or conflicting with all three. TD chose the stacked
base explicitly. **These commits reach `dev` only after tier5 does.**

**Databases touched: LOCAL ONLY.** `127.0.0.1` for migration 0033 and the
disposable `koolee_test` for the integration tier. TD approved the migration
explicitly before it ran. Hosted is untouched and still owes 0033.

---

## The input

Twenty-four complaints, in one message, spanning the customer web app, the
booking funnel, the agent app, and two questions about infrastructure. Grouped
into six batches so each landed as a reviewable commit rather than one
unreadable diff.

| Batch | Commit | What it answers |
| --- | --- | --- |
| A | `18e8bcb` | Address deletion, the profile card, autocomplete, avatar, toasts |
| B | `058e499` | What a trip is called, when it becomes history, CTA duplication |
| C | `2d32462` | Date picker, leg picker, upload copy, pickup step, window grid, payment scrim |
| D | `b7d86d2` | Agreement/passport sequence, agreement PDF, miles, single-number ETA |
| E | `cdfee5f` | The customer's phone, and how far the door is |
| F | `8e631a2` | The live map |
| G | this one | Sentry locally, the Google Maps split, the docs |

---

## The three findings worth keeping

### 1. Deleting an address was blocked by a bug that ran the other way too

The reported complaint was "that address is part of a booking's record and
can't be deleted". The cause was `bookings.pickup_address_id` being NOT NULL,
`ON DELETE RESTRICT`, with nine call sites joining through it to reach the
doorstep.

The same shape hid a worse bug nobody had reported: **editing** a saved address
silently rewrote history. A booking held no address of its own, so correcting a
typo in "Home" changed the doorstep on a pickup that had already happened — the
confirmation email, the agent's screen and any dispute would all have followed
the edit.

Migration 0033 puts the address on the booking, snapshotted at creation and
never updated, exactly like `display_tz`. Every reader goes through
`bookingPickupAddress`; there are no joins left. `pickup_address_id` survives as
provenance only — nullable, `ON DELETE SET NULL`, nothing renders from it.

Deletion is now refused for exactly one reason: a LIVE booking still has a
pickup coming, and somebody deleting "Home" the night before has probably
mistaken it for cancelling.

### 2. Three defects the build could not see

Typecheck, lint, 908 unit tests and a full Next production build were green over
all three of these. Each was found by driving a real browser.

**The map rendered nothing, silently.** Vite's dependency optimizer rewrites
MapLibre's tile-parsing worker to a path it never emits. The style, the sprites
and the TileJSON all fetch, the canvas mounts at the right size, MapLibre raises
no `error` event, and no tile is ever requested. Fixed for Storybook
(`optimizeDeps.exclude`, plus removing it from Storybook's auto-`include`, or it
stays optimized). The apps bundle with Turbopack and were never affected — but
the silence was a customer-facing hole regardless, so `LiveMap` now has a
ten-second deadline to reach `load` and degrades to a sentence instead of a
blank rectangle.

**A map pin under the attribution bar.** A driver at the southern edge of the
shortlist was visible enough to invite a tap and covered enough to swallow it.
`fitBounds` padding is asymmetric now.

**The date field lost every second digit.** This is the one that matters.
Typing `11` for November produced `01`. The DOM reached `"11"` correctly and the
blur handler — which pads a single digit to two — overwrote it with a padded
`"1"`. Blur arrives in the same event turn as the auto-advance that caused it,
before React has re-rendered, so the handler's closed-over `value` was the
PREVIOUS keystroke. It reads `event.target.value` now. Every two-digit segment
was affected, for every user, on every entry.

The seven unit tests over the parts conversion all passed throughout, because
the pure function was never wrong — it was being fed a stale value by its own
wrapper. **A pure test cannot catch this class of bug.** `@koolee/ui` runs its
tests in `environment: "node"` with no DOM harness; adding one is the honest
follow-up, filed as P20 rather than done here.

### 3. Sentry already works locally — the proof did not

`sentryOptions` sets `enabled: Boolean(dsn)`, so a DSN in `.env.local` sends
real events from `pnpm dev` tagged `environment: "development"`. The only way to
PROVE it was `/api/observability/test-error`, which refused to run without a
`CRON_SECRET` nobody sets on a laptop — so the proof was available only in
production, which is backwards.

That guard now applies only when `NODE_ENV === "production"`. `NODE_ENV` comes
from the runtime and cannot be spoofed by a request, so a deployed app still
requires the secret exactly as before. The reply gained a `note` saying in words
whether anything actually left the process.

Verified on this machine: `{"sent": true, "eventId": "ba493c17…",
"environment": "development"}`.

---

## The two answers

### Are we using the Google Maps APIs correctly?

Yes, and the way they are used is worth keeping. Places runs through
`/api/places` with a per-typing-session token, so Google bills one autocomplete
plus one details call rather than one per keystroke. Routes uses
`computeRouteMatrix` with a field mask, a 2.5-second timeout and a haversine
fallback. Both are server-side; `GOOGLE_MAPS_SERVER_KEY` is server-restricted
and never enters a client bundle.

**Map rendering deliberately does not use Google.** It is a separate SKU
(Dynamic Maps bills per map load past 10,000/month) and it needs a second,
referrer-restricted key in the browser bundle that anybody can read and spend.
MapLibre over OpenFreeMap needs no key and no account. Documented in
[ARCHITECTURE.md §6](../ARCHITECTURE.md).

### Can I see whether Sentry is receiving anything locally?

Yes — see finding 3 and the new section in
[prod-bringup.md](../runbooks/prod-bringup.md). Only source maps and `release`
are deploy-only, and neither affects whether events arrive.

---

## What was NOT done

- **A DOM test harness for `@koolee/ui`** (P20). Finding 2 is the argument for
  one. The date field's regression is documented in a comment at the call site,
  which is weaker than a test.
- **Hosted 0033.** Local only, as always. Hosted owes it.
- **Push, SMS, AeroAPI.** Untouched, as before.

---

## A process note

`RUN-REPORT-10.md` was briefly overwritten during this session — the run-report
directory listing was read with `tail -5`, which hid 10 and 11, and the next
free number looked like 10. Caught by `git status` before any commit and
restored from the index; F3's report is intact. **Read the whole listing before
choosing a filename.**
