# Run report 11 — Tier 5: launch readiness

**Branch:** `feat/tier5-launch-readiness`, cut from `origin/dev` @ `728bcea`
with `--no-track`. Verified before any work:

```
$ git config --get branch.feat/tier5-launch-readiness.merge   # empty (exit 1)
$ git status -sb
## feat/tier5-launch-readiness                                # no upstream
```

**One session, one branch. Commits are made here, one per phase**, at TD's
explicit instruction in the slice hand-off — the slice prompt's "no commits"
default is overridden for this run. Nothing is pushed; no PR is opened.

**Databases touched: LOCAL ONLY** (`127.0.0.1:54322`) and the disposable
`koolee_test` for the integration tier. Hosted is never contacted.

**Ground truth:** [REPORT-tier5-preflight.md](REPORT-tier5-preflight.md). Every
claim this report makes about the starting state cites a section of it; where
the slice prompt and the report disagreed, the resolution is recorded in place.

**One extra brief from TD, outside the slice prompt:** _reusability_. Before
any new component, check whether the repo already has one — the driver-tracking
progress strip drew its own dots and rails while the rest of the product used
the shared `CustodyTimeline` motif, and the two did not match. That audit and
its fix are Phase 2.5.

---

## Phase 0 — Seed safety + doc truth

### 0.1 The hosted seed guard

`pnpm seed` now refuses any non-local database.

New: [packages/db/src/seed-guard.ts](../../packages/db/src/seed-guard.ts).
`assertSeedTargetAllowed(connectionString, env)` returns
`{kind: "local"}` / `{kind: "hosted-allowed"}` or throws
`HostedSeedRefusedError`. Local means a fixed list — `127.0.0.1`, `::1`,
`localhost`, `host.docker.internal`, and the two docker-compose names
(`postgres`, `koolee-postgres`) — deliberately **not** a private-range pattern,
because a pattern that admits `10.x` also admits a bastion or an SSH tunnel to
production, which is the case the guard exists to stop. An unparseable
connection string is treated as non-local: an unknown target is not a local
target.

Wired at [seed.ts](../../packages/db/src/seed.ts) `main()`, **after** the
existing `Target host:` print and **before** `createDb` — nothing opens a
socket to a database the run is about to refuse. The refusal is caught at the
bottom of the file and printed as its own message rather than as a stack trace.

Why it matters, restated from report §3.2, §3.3, §6.6: the seed is idempotent
with respect to _itself_, not to a human's work. It resets all 128
`airline_cutoffs` rows to the placeholder 45/60 minutes (overwriting `source`,
where a verified value's provenance lives) and rewrites the active pricing rule
field by field. The cutoff matrix decides whether a pickup can make its flight.

The escape hatch is `SEED_ALLOW_HOSTED=1` — for a brand-new hosted project on
day one. It accepts any truthy value (`1`, `true`, `yes`) and treats
`0`/`false`/blank as unset. It does **not** lift the older, separate refusal on
the staff roster: `seedLocalStaff` still hard-skips any non-local _Supabase_
host, because those passwords are published in the source file.

Demonstrated (no database contacted — the guard throws before `createDb`):

```
$ DATABASE_URL='postgresql://u:p@aws-0-us-east-1.pooler.supabase.com:6543/postgres' pnpm seed
Target host: aws-0-us-east-1.pooler.supabase.com

Seed REFUSED: 'aws-0-us-east-1.pooler.supabase.com' is not a local database.
…
If this really is a brand-new project with nothing to lose, re-run with SEED_ALLOW_HOSTED=1.
[ELIFECYCLE] Command failed with exit code 1.
```

**Tests.** `packages/db` had no test runner at all; it now has one (vitest 4,
matching every other package, `include: src/**/*.test.ts`) and
[seed-guard.test.ts](../../packages/db/src/seed-guard.test.ts) — 8 tests:
local hosts admitted, look-alike hosts refused (`127.0.0.1.evil.example.com`,
`10.0.0.5`, `notlocalhost`), the refusal message names the host and what it
would destroy, the override works for `1`/`true`/`yes` and not for
`0`/`false`/blank, an unparseable URL refuses, and an explicitly-passed env
beats a `SEED_ALLOW_HOSTED` exported in the developer's own shell (so a
refusal test cannot pass for the wrong reason).

### 0.2 The docs that told you to seed hosted

The report named two (§4.1 A6, §3.4). A repo-wide grep found **six** places
that instruct or imply it; all six are corrected, each pointing at the
admin-console path Phase 4 builds:

| File                                                       | Was                                                                       | Now                                                                                                  |
| ---------------------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `docs/MIGRATIONS.md` §9 step 4                             | "Seed reference data if the project is new: `pnpm seed` … Idempotent."    | Refusal explained; `SEED_ALLOW_HOSTED=1` for a brand-new project only; live projects use the console |
| `docs/features/driver-and-pickup-hosted-setup.md` §3       | `DATABASE_URL='<hosted pooled url>' pnpm seed` — "Idempotent, as always." | Same command behind the override, with "idempotent with respect to **itself**, not to ops's work"    |
| `docs/CODEBASE-MAP.md` (deploy order)                      | "`pnpm seed` with the hosted URL"                                         | Brand-new only, names what it overwrites                                                             |
| `docs/ARCHITECTURE.md` (deploy order)                      | "`pnpm seed` if the project is new"                                       | Same                                                                                                 |
| `docs/SCRIPTS.md` §1 table                                 | "`pnpm seed` — yes — Idempotent reference data"                           | "**local only** — REFUSES a non-local host — see §3.6"                                               |
| `docs/features/agreements-and-passport-hosted-setup.md` §4 | "Dev only — run the seed (`pnpm seed` against that project)"              | Names the refusal and the override                                                                   |

New section **`docs/SCRIPTS.md` §3.6 — "Why `pnpm seed` refuses a non-local
database"**: the two independent refusals (staff roster vs whole seed), what
each protects, which has a bypass, and the one-home table for launch data.

### 0.3 The contradictions

| #   | Report finding                                                                                                                                                                                         | Fix                                                                                                                                                                                                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | §4.6(1) — `ENVIRONMENT.md §6.6` still said "Hostname entries already cover subdomains", two sections below its own §5.2 correction. **This is the exact belief behind the Turnstile `110200` outage.** | Rewritten: each widget lists every hostname that mounts it; an entry covers that hostname and its own subdomains only; `dev.admin.koolee.cloud` sits under `admin.koolee.cloud`; never add the apex to the dev widget. Points at §5.2.                                                 |
| 2   | §4.6(2) — `jobs-and-notifications.md` said driver ETA is "a fixed estimate" (false since Tier 4) and that admin-raised exceptions do not emit (false since `apps/admin` injects `inngestEmitter`).     | Both corrected, in all three places they appear in that file (§1 status line, §2.0 bullet, §7 list). The ETA line now states the real property — pessimistic, so the monitor alerts early.                                                                                             |
| 3   | §4.6(3) — `apps/agent/src/env.ts` `fallback: "Route ETA uses a fixed estimate."` and `apps/web/.env.example` "Drive time uses a fixed estimate."                                                       | **Deferred to Phase 1, deliberately.** These are code strings attached to `GOOGLE_MAPS_API_KEY`, and Phase 1 replaces that variable and every hint around it. Fixing them here and again there is churn in the same branch; the resolution is recorded rather than the fix duplicated. |
| 4   | §4.6(4) — `docs/run-reports/README.md` omitted RUN-REPORT-9 and -10.                                                                                                                                   | Index now lists 9, 10, the Tier 5 preflight and this report.                                                                                                                                                                                                                           |

### 0.4 Gates

| Gate                                                                             | Result                                                                                 |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `turbo typecheck`                                                                | 6/6                                                                                    |
| `turbo lint`                                                                     | 6/6                                                                                    |
| `turbo test` (unit)                                                              | 6/6 — core 513 passed / 1 skipped, web 134, ui 104, admin 32, agent 24, **db 8 (new)** |
| `pnpm --filter @koolee/core test:integration` (`koolee_test`)                    | 29 files passed / 1 skipped, 286 passed / 3 skipped                                    |
| `pnpm seed:local` (the guard's happy path, run by the integration script's tail) | seeded 127.0.0.1 — 837 centroids, 128 cutoffs, launch-v1, 198 zones                    |
| Prod builds                                                                      | not run — this phase touches no app code                                               |

`packages/db` is a **sixth** task in each turbo run now that it has a `test`
script; the counts above are 6/6, not the 5/5 earlier reports show.

---

## Phase 1 — ETA: the async seam, Routes, and the end of the literal 20

### 1.1 The seam is async now

`EtaEstimator.estimate` returns `Promise<EtaRange>`, and the interface gains
`estimateMany({from[], to}) → Promise<EtaRange[]>` — many origins, one
destination, which is both the driver-shortlist shape and what a route-matrix
API is built for. `kind` was added too (`"haversine" | "google-routes"`), for
logs and alert detail only.

The rounding is now one function, `toEtaRange(centreMinutes, shape)`, because
both implementations need identical semantics — whole 5-minute steps at both
ends, a 5-minute floor, `max > min` always, the six assertions in
`eta.test.ts` — while disagreeing about how wide the band should be. The
`EtaRangeShape` carries **two** spreads rather than one: uncertainty in a drive
time is not symmetric.

`HaversineEtaEstimator` keeps every constant and every number it ever
produced. `estimateSync` is the arithmetic with no promise around it; the
existing arithmetic tests were repointed at it, and a new block covers the
async surface (`estimate` resolves to exactly `estimateSync`, `estimateMany`
is index-for-index, an empty batch makes no call).

**All five consumers (report §1.2):**

| #   | Consumer                                       | What changed                                                                                                                                                                                                |
| --- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `toCandidate` — the driver shortlist           | The `Array.map` became **one** `estimateMany` call in a new `shortlistEtas` helper. Drivers with no position are left out of the call and re-aligned to `null` afterwards. Four serial round-trips avoided. |
| 2   | `selectDriver` — the ETA in the custody event  | Moved **out of the transaction** — see below.                                                                                                                                                               |
| 3   | Customer trip page                             | `await`, hoisted above the view object.                                                                                                                                                                     |
| 4   | `cutoffRiskMonitor`                            | Restructured into three passes; **one estimator call per airport**, so at most three however many bookings are in transit.                                                                                  |
| 5   | `haversineKm` direct — the "3.2 km away" label | Untouched. It is a pure function, not the seam.                                                                                                                                                             |

**`selectDriver` deserves its own paragraph.** The obvious change — `await`
inside the transaction — would have held the shift's advisory lock open across
a third party's network latency, serialising every other customer choosing that
same driver behind Google. The ETA there is a snapshot for the custody event's
metadata and nothing depends on it, so it is now taken BEFORE the transaction
by a small dedicated read (`snapshotDriverEta`). The position it sees is at
most one GPS ping (~45 s) older than the one re-read under the lock; a null
either way renders as "ETA on the way".

### 1.2 `GoogleRoutesEtaEstimator`

[packages/core/src/geo/routes.ts](../../packages/core/src/geo/routes.ts). One
`POST` to `computeRouteMatrix`, plain `fetch`, no SDK, `X-Goog-FieldMask`
limited to the four fields that matter (the mask is required by the API and is
also the billing lever). `routingPreference: "TRAFFIC_AWARE"` — not
`TRAFFIC_AWARE_OPTIMAL`, which costs more and is slower for an accuracy
difference a 5-minute-rounded range cannot express. 2.5 s timeout.

**Selection** is by key presence, resolved in `apps/web/src/lib/core.ts`:
`GOOGLE_MAPS_SERVER_KEY` present ⇒ Routes, absent ⇒ haversine. Core still
reads no environment; the key travels as a value in the config union, exactly
as `payments: { kind: "stripe", secretKey }` does. The factory's old header
predicted a credentialled provider would have to arrive as a pre-built
instance — **that turned out to be wrong and the comment is corrected**: a
`fetch` adapter has nothing to construct and no Node-only import, so the
declarative form works and every app selects it in one line.

**The range mapping is the one real decision in this phase.** The pre-flight
(§1.3, §6.1) warned that narrowing the range makes `cutoffRiskMonitor` alert
LATER, because the monitor consumes `maxMinutes` — a change in the unsafe
direction. Under haversine, Midtown → JFK reads 145 minutes against a real
~50: an accidental 2.9× margin that also fires the alert on bookings that are
completely fine, which is how operators learn to ignore an alert.

Resolution: **make the margin deliberate, and put it where the uncertainty
is.** −15% at the low end, +45% at the high end. A route can always take longer
than predicted; it essentially never takes dramatically less. A 50-minute route
becomes 40–75 min — honest for a customer reading "when do I need to be at the
door", and a 1.5× margin for the monitor. The monitor's own arithmetic is
untouched, and **the haversine numbers are untouched**, so nothing gets less
safe in the configuration that actually runs today (no key ⇒ no change at all).

**It never throws.** Network failure, 403/429/5xx, an unparseable body, a body
that is JSON but not a matrix, `ROUTE_NOT_FOUND`, a per-element error status, a
malformed duration — every one falls back to the haversine estimate and logs
one line. The fallback is **per origin**: one unroutable driver does not cost
the other three their real estimate. 18 tests in
[routes.test.ts](../../packages/core/src/geo/routes.test.ts) cover the request
shape (URL, method, key header, field mask, body), the one-call-per-shortlist
property, the mapping, out-of-order responses, and each failure above.

### 1.3 The literal 20 is gone

Report §1.5/§6.4: four funnel call sites passed `distanceKm: 20` while the
marketing estimator used real per-airport distances — up to **$2.70** apart on
a JFK trip at 45¢/km, with the funnel quoting lower.

New: [geo/distance.ts](../../packages/core/src/geo/distance.ts) (pure) and
[services/quote-distance.ts](../../packages/core/src/services/quote-distance.ts)
(database-backed). `resolveQuoteDistanceKm` answers, most specific first:
precise address coordinates → the ZIP centroid → the per-airport typical. It
degrades rather than throws; a database hiccup must not refuse to price a
booking.

**Pricing distance is geometry, never a network call, and that is deliberate.**
A booking is priced at the window picker, again on the review page and again
inside `createBooking` — three moments, minutes apart. Traffic-aware numbers
would differ between them and a customer would watch the total move between the
page that quoted it and the charge. Determinism beats accuracy to the kilometre
here; the multiplier is a blunt 45¢ instrument regardless. This is the one
place the slice prompt's "the estimator's distance" was read narrowly, and the
reasoning is recorded rather than assumed.

**`PRICING_ROAD_FACTOR = 1.2`, not the ETA model's 1.5.** The two factors
answer different questions, and the pricing one is calibrated against the very
distances the public page publishes, from Midtown (10018):

| Airport | great-circle | published typical | implied factor |
| ------- | -----------: | ----------------: | -------------: |
| JFK     |      21.8 km |             26 km |           1.19 |
| LGA     |      10.4 km |             13 km |           1.25 |
| EWR     |      17.3 km |             19 km |           1.10 |

1.2 reproduces all three within about a kilometre (Midtown → JFK lands on
26.1 against 26). Using 1.5 would have priced that trip at 32.7 km — replacing
one disagreement with a bigger one in the other direction, which is what the
first draft of this did and what the calibration test now prevents.

Call sites, each cited:

| Call site                                                                                 | Now                                                                                                                                       |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| [apps/web/src/lib/checkout.ts](../../apps/web/src/lib/checkout.ts)                        | `resolveQuoteDistanceKm` with the ADDRESS ROW's coordinates — the row exists by that line, and it is the authority on where the pickup is |
| [book/slot/page.tsx](../../apps/web/src/app/book/slot/page.tsx)                           | same resolver, from the draft's ZIP                                                                                                       |
| [book/actions.ts](../../apps/web/src/app/book/actions.ts) (`submitSlot` re-check)         | same                                                                                                                                      |
| [book/pay/page.tsx](../../apps/web/src/app/book/pay/page.tsx)                             | same                                                                                                                                      |
| [(marketing)/pricing/actions.ts](<../../apps/web/src/app/(marketing)/pricing/actions.ts>) | imports `TYPICAL_AIRPORT_DISTANCE_KM` from core instead of holding its own copy                                                           |

The marketing page still mirrors the launch pricing RULE (its `LAUNCH_RULE`
constant). That half of report §6.4 is closed in Phase 4, where the pricing
admin editor makes a stale mirror an actual hazard rather than a theoretical
one.

### 1.4 `cutoffRiskMonitor`

Three passes now: (1) no I/O — resolve the strictest cutoff and both ends'
coordinates, and emit the "no cutoff on record" alerts that need no estimate;
(2) group the measurable bookings **by departure airport** and issue one
`estimateMany` per group, in parallel — three airports, so at most three calls
however many bookings are moving; (3) the arithmetic and the threshold filter.

`maxMinutes` is still what it consumes and `defaults.driveTimeMinutes` is still
the fallback where there was nothing to measure between. The alert detail gains
`estimatorKind`, documented as _which estimator was configured_ — a per-call
fallback inside the Routes adapter logs itself and does not change the tag.
Both existing drive-time tests pass unchanged, including the one that pins
`driveMinutes: 145`.

### 1.5 The Maps key, renamed

`GOOGLE_MAPS_API_KEY` was parsed by `apps/web` and `apps/agent` and read by
nothing (report §1.7). It is now `GOOGLE_MAPS_SERVER_KEY` **in `apps/web`
only** — the agent app renders no ETA at all, so its schema entry, its
`.env.example` block and its dev-status row are deleted rather than renamed.
The new name carries a rule: server-side only, restricted to Routes + Places
(New), application restriction = server, never an HTTP referrer.

This is where report §4.6(3) is closed — the deferral recorded in Phase 0.3.
The stale strings (`"Route ETA uses a fixed estimate."`, `"Drive time uses a
fixed estimate."`, `"Stubbed in this scaffold."`) are gone with the lines they
sat on. `turbo.json`'s build env list, both `.env.example` files, the root
`.env.example` and `ENVIRONMENT.md §3` follow the rename.

`ENVIRONMENT.md §6.6` also loses two entries from its "shared read-only keys"
exemption: the Maps key (metered and billed — dev traffic should not spend
production's quota) and `SENTRY_DSN` (report §6.5: one shared DSN merges
preview errors into the production project).

### 1.6 Gates

| Gate                                          | Result                                                                                                                 |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `turbo typecheck`                             | 6/6                                                                                                                    |
| `turbo lint`                                  | 6/6                                                                                                                    |
| `turbo test` (unit)                           | 6/6 — core **548** passed / 1 skipped (+35: 18 Routes, 12 distance, 5 seam), web 134, ui 104, admin 32, agent 24, db 8 |
| `pnpm --filter @koolee/core test:integration` | 29 files passed / 1 skipped, 286 passed / 3 skipped — unchanged                                                        |
| `turbo build --filter=@koolee/web`            | success                                                                                                                |
| Migrations                                    | none generated, none applied                                                                                           |

---

## Phase 2 — Places autocomplete, and coordinates that survive a second booking

### 2.1 The Places adapter and the proxy route

[packages/core/src/geo/places.ts](../../packages/core/src/geo/places.ts) — the
third Google adapter, deliberately the same shape as the Routes one: plain
`fetch`, no SDK, key as a value, one field mask, never throws.
`autocomplete(input, sessionToken)` and `details(placeId, sessionToken)`.

**The key never reaches a browser.** Places' browser half wants a key
restricted by HTTP referrer, which is a key anybody can read out of the bundle
and spend. So the funnel posts to
[`/api/places`](../../apps/web/src/app/api/places/route.ts) and the route holds
the key. Verified against the production build rather than asserted: the
client chunk contains the NAME `GOOGLE_MAPS_SERVER_KEY` (every app's env schema
is in a client chunk and always has been) as
`process.env.GOOGLE_MAPS_SERVER_KEY` — a runtime lookup that is `undefined` in
a browser — while a public variable beside it, `NEXT_PUBLIC_PUSH_NOTIFICATIONS_ENABLED`,
is inlined as the literal `"true"`. That difference IS the mechanism: Next
inlines `NEXT_PUBLIC_*` and nothing else.

**What guards a route that spends money.** It is reachable without a password,
because the funnel is anonymous until the verify step. Three things:

1. a **draft cookie is required** — somebody typing an address in the funnel
   has one, a script pointed at the URL does not (httpOnly and same-site, so
   this is a cost of entry, not a token to steal);
2. a **length floor of 3 and a ceiling of 200** — every keystroke that reaches
   Google is billed;
3. **session tokens**, minted per typing session in the browser, passed through
   unchanged, and retired after the details call — with one, Google prices the
   whole session as a single autocomplete plus a single details request.

No key in the environment ⇒ the route answers **204**, which the client treats
as "no suggestions". Not a 500: an environment with no Maps key is a
configuration, and the field works without it.

The service area is a rectangle around the NYC metro (`locationRestriction`),
so a customer typing "22 W" is offered doorsteps Koolee can reach. It is a
bias for the list, **not** a coverage check — coverage is still
`ALL_COVERAGE_ZIPS`, enforced server-side on submit where it has always been.

13 tests in [places.test.ts](../../packages/core/src/geo/places.test.ts):
request shape, the sub-minimum input that makes no call at all, the mapping,
`details` returning **null when a component is missing** (a suggestion with no
ZIP cannot be reconciled against the quoted ZIP, and guessing prices the wrong
place), an address with no coordinates still returned, and every failure mode.

### 2.2 The component, and the reuse question

**Checked first, per the standing rule.** `packages/ui` had `Select` (a native
`<select>`), `MultiSelect` (a `<details>` disclosure over a checkbox list) and
`Popover`. Both selects answer "pick from a known set"; a typeahead's set is
not known — it changes with every keystroke, arrives late, may be empty, and
its value is the TEXT with a suggestion as an optional shortcut. Different
control, so a new one — but split so the reusable half is reusable:

| Piece                                                                                         | Owns                                                                                                                                                                                                                                   |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`AutocompleteField`](../../packages/ui/src/components/autocomplete-field.tsx) (`@koolee/ui`) | open/closed, the highlight, arrow keys with wrap, Enter, Escape, Tab, outside-click dismissal (the `MultiSelect` idiom), the full ARIA combobox wiring, the in-field spinner. Storybook stories for suggesting / loading / no-matches. |
| [`AddressAutocomplete`](../../apps/web/src/components/address-autocomplete.tsx) (`apps/web`)  | the 250 ms debounce, the session token, the fetch, request sequencing, and turning a chosen suggestion into the five structured fields                                                                                                 |

**Two traps found while building it, both recorded in the code.**

- _A fresh array every render silently kills the keyboard._ The natural way to
  build `suggestions` is a `.map` inline, which hands over a new array
  identity every render. Resetting the highlight on `[suggestions]` would then
  reset it on **every** render and the arrow keys would do nothing at all,
  with no error anywhere. `AutocompleteField` keys the reset on the joined
  IDS, not the array; `AddressAutocomplete` memoizes as well.
- _`setState` in an effect body is a cascading render_, and this repo's lint
  rule refuses it (`react-hooks/set-state-in-effect`). Both components were
  restructured rather than suppressed: the field adjusts state **during
  render**, which React supports for exactly this case, and the app component
  stores `{query, items}` as ONE piece of state so "what should be visible"
  and "did a search settle with nothing" are comparisons rather than
  synchronised state — which also removed a stale-suggestion flash between a
  keystroke and its response.

**Verified in a browser**, not only by typecheck (Storybook + Playwright over
the bundled Chromium): the list opens on ArrowDown, two presses land the
highlight on the second row, and the ARIA snapshot reads as a listbox with the
active option marked.

### 2.3 Coordinates that travel, and coordinates that expire

The draft cookie gains `lat`, `lng`, `placeId`
([booking-draft-schema.ts](../../apps/web/src/lib/booking-draft-schema.ts)) —
no migration, because `booking_drafts` mirrors the cookie as opaque `jsonb`.

**A hand edit clears them.** Coordinates that belong to a different address are
worse than none: the price and the driver's map link would both point at the
wrong door while looking exactly as confident as a correct one. So the form
drops them on any address-field change, `submitPickup` writes all three
**unconditionally** (`undefined` included, the same mechanism the ZIP-change
path already uses to clear a chosen window), and the action never invents
them. Half a coordinate is rejected as no coordinate.

**The priced-ZIP guard is untouched**, exactly as the report required
(§1.5(a)-(c)): a selected suggestion writes `line1/city/state/zip` through
`setAddress`, and its ZIP meets `draft.quotedZip` on submit like any typed one.
Report §6.2 predicted the reconcile dialog will fire MORE often now, because an
authoritative ZIP disagrees with a hand-typed one more often than another hand
-typed one does. That is left as it is, and it is the right trade: the dialog
is one click, and the alternative is silently repricing a booking.

`line2` is deliberately not filled from a suggestion. Places may know a unit
number; the customer is the authority on their own buzzer.

Saved addresses now carry `lat/lng/placeId` too, so re-using one does not throw
away precision it already had.

### 2.4 `ensureAddress` — the early return, and the dedupe key

Report §6.3: the early return sat **before** the coordinate branch, so once
autocomplete shipped, every address a customer had used before would keep its
ZIP centroid forever and its `place_id` would stay null — on the one address
most likely to be repeated. `ensureAddress` now UPGRADES a matching row:
precise coordinates replace a centroid, `place_id` is filled, and **only when
there is something better to write**, so an ordinary repeat booking still costs
one SELECT. It never downgrades — a later hand-typed booking does not undo the
autocomplete path's work.

**One correctness fix beyond the brief, and it is why the upgrade needed
care.** The dedupe key was `(user_id, line1, zip)`, which collapses two
apartments at one street address into a single row: book from Apt 4, book again
from Apt 9, get Apt 4's row back — and a driver at the wrong door. It is
`(user_id, line1, line2, zip)` now, with a blank `line2` normalised to NULL so
whitespace is not a second address. `city` stays out on purpose: it is
derivable from the ZIP, and including it would mint a second row for "NYC"
against "New York".

7 integration tests in
[ensure-address.integration.test.ts](../../packages/core/src/services/ensure-address.integration.test.ts)
— centroid fallback, precise storage, the in-place upgrade with a row count of
1, never downgrading, half a coordinate ignored, two apartments kept apart, and
blank `line2`.

### 2.5 The small consequences, spot-checked

- The **agent's map link** already passed `query_place_id` when the address had
  one ([job.ts:153-159](../../apps/agent/src/lib/job.ts#L153),
  [tasks/[taskId]/page.tsx:104-106](../../apps/agent/src/app/tasks/%5BtaskId%5D/page.tsx#L104)).
  Nothing to change — the payoff was built and waiting, and this is the slice
  that starts writing the id.
- The **customer trip page** reads `addresses.lat/lng` for the ETA and the
  "N km away" label; precise coordinates only make both truer.
- `resolveQuoteDistanceKm` prefers the address row's coordinates in
  `checkout.ts`, so a Places-selected address is priced on its real distance
  rather than its ZIP's centroid.

---

## Phase 2.5 — The reusability audit TD asked for

> _"before writing any new component, check out the entire code. Do we have
> anything similar that we can reuse? … the custody trail timeline looks
> pretty good. But when the driver tracking starts, we are showing a timeline
> that does not match the existing UI of the app."_

**The audit.** Every progression-shaped surface in the three apps:

| Surface                                 | Draws                                            | Verdict               |
| --------------------------------------- | ------------------------------------------------ | --------------------- |
| Customer trip page — custody trail      | `CustodyTimeline` (vertical)                     | shared                |
| Admin booking detail — custody trail    | `CustodyTimeline` (vertical)                     | shared                |
| Agent task record                       | `CustodyTimeline` (vertical)                     | shared                |
| Marketing — how it works / home / about | `CustodyTimeline` (horizontal), `MilestoneTrack` | shared                |
| **Customer trip page — driver run**     | **its own `<ol>`, in `trip-driver.tsx`**         | **the one exception** |

A repo-wide grep for hand-rolled dots (`size-2*`/`size-3` + `rounded-full`)
returned exactly two lines, both in that component. So the inconsistency TD saw
was one component, not a pattern — and it was on the same screen as the shared
one.

**What it drew differently:** `size-2.5` against `size-3`; `bg-sky-500` for a
done stage against navy-800; `bg-navy-200` for an upcoming one against a hollow
ring; a 1px rail against a 2px one; and — the part that actually matters —
**no marker at all for the step in progress**, where every other timeline in
the product pulses seal orange. The screen telling a customer where their bags
are _right now_ was the only one that did not say which stage was now.

**The fix, in three pieces:**

1. [`StageDot`](../../packages/ui/src/components/stage-dot.tsx) — the marker,
   extracted from inside `custody-timeline.tsx` so neither component owns the
   vocabulary. `CustodyItemState` is kept as an alias of `StageState`, so no
   consumer changed.
2. [`ProgressTrack`](../../packages/ui/src/components/progress-track.tsx) — a
   short fixed progression with a current position, drawing `StageDot`. Its
   rail follows the vertical timeline's rule (solid sky behind you, dashed
   ahead), which is now one rule in both components. Four Storybook stories.
3. `PickupProgress` in `trip-driver.tsx` is **20 lines of markup shorter** and
   is now a one-line wrapper over `ProgressTrack`.

`CustodyTimeline`'s own rendering is untouched — only the dot moved — so the
marketing page's horizontal variant looks exactly as it did. That was
deliberate: the goal was one vocabulary, not a redesign.

**Verified in a browser** (Storybook + Playwright): the two components
screenshotted side by side draw the identical navy / pulsing-orange / hollow
markers at the same size. The driver strip's accessible tree reads five list
items with "On the way" carrying `aria-current="step"` and its screen-reader
"— current step".

### 2.6 Gates

| Gate                                          | Result                                                                                                                       |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `turbo typecheck`                             | 6/6                                                                                                                          |
| `turbo lint`                                  | 6/6                                                                                                                          |
| `turbo test` (unit)                           | 6/6 — core **561** passed / 1 skipped (+13 Places), ui **107** (+3 components registered), web 134, admin 32, agent 24, db 8 |
| `pnpm --filter @koolee/core test:integration` | **30** files passed / 1 skipped, **293** passed / 3 skipped (+7 `ensureAddress`)                                             |
| `turbo build --filter=@koolee/web`            | success; client bundle checked for the Maps key (see 2.1)                                                                    |
| Browser pass                                  | Storybook + Playwright: `ProgressTrack`, `CustodyTimeline` states, `AutocompleteField` keyboard nav                          |
| Migrations                                    | none generated, none applied                                                                                                 |
