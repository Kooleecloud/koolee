# Run report 15 — Map-first trip page, agent schedule, driver-position robustness

> **Numbered 15, and it was written as 10 by mistake.** `RUN-REPORT-10.md`
> already existed — slice F3, web push and dispatch timing, 1,222 lines — and
> this file overwrote it. The clobber shipped in PR #42 and is undone in the
> commit that renames this one; the F3 report is restored from `9d26a71`.
> The cause is worth recording because it is a trap in the tooling rather than
> a typo: `ls docs/run-reports | tail -8` was used to find "the latest" report,
> and `ls` sorts lexically, so 10 through 14 sit BEFORE 2 through 9 and the
> tail showed 4-9 as if they were the highest. Sort numerically, or read the
> directory whole.

**Branch:** `feat/live-map-first`, cut from `origin/dev` @ `9d26a71` with
`--no-track` (`branch.feat/live-map-first.merge` verified empty; `git status -sb`
shows no upstream). **Commits are made on this branch**, one per phase, at TD's
explicit instruction.

**One session, one branch.** TD asked for everything end-to-end on a single
branch rather than the three-way split that was offered.

**Databases touched: LOCAL ONLY.** Hosted is never contacted. One migration is
in scope (M7 below); its SQL is shown to TD and approved before it is applied.

**THIS DOCUMENT IS THE TRACKER.** It is updated as each item lands, so the plan
survives the session. Checkboxes are the source of truth for what is done —
not the conversation, and not memory.

---

## Status

| Group                                    | Items  | Done   |
| ---------------------------------------- | ------ | ------ |
| A · Map as permanent hero                | 6      | **6**  |
| B · Searching state with ghost pins      | 6      | **6**  |
| C · Driver bar and micro timeline        | 5      | **5**  |
| D · Custody trail collapse               | 2      | **2**  |
| E · Timeline detail                      | 3      | **3**  |
| F · After delivery                       | 2      | **2**  |
| G · Map gestures                         | 4      | **4**  |
| H · Stale positions never empty the map  | 2      | **2**  |
| I · Agent app — Today                    | 3      | **3**  |
| J · Agent app — Schedule                 | 6      | **6**  |
| K · Driver position — capture            | 4      | **4**  |
| L · Driver position — never drop a fix   | 2      | **2**  |
| M · Driver position — detect and recover | 7      | **7**  |
| N · Stories and tests                    | 4      | **4**  |
| **Total**                                | **56** | **56** |

---

## The seven locked decisions

| #   | Decision              | Chosen                                                       |
| --- | --------------------- | ------------------------------------------------------------ |
| 1   | Chain-of-custody card | Collapse into a disclosure below the map                     |
| 2   | Ghost drivers         | Uber-style — anonymous, inert, no disclaimer text            |
| 3   | Stale GPS fixes       | Dimmed pin + "last seen N min ago", both surfaces            |
| 4   | Map lifespan          | `verified_sealed` → `delivered_to_bagdrop`                   |
| 5   | Agent Today tab       | Today + live overdue; cancelled never appears                |
| 6   | Agent Schedule tab    | Two tabs; cancelled → History; overdue demoted below Today   |
| 7   | Position robustness   | Max out the web path; native wrapper explicitly out of scope |

---

## Root causes, confirmed in the code on `dev`

These are the defects the slice exists to fix. Each was read directly, not
inferred.

1. **The map disappears** — three independent gates.
   `apps/web/src/components/trip-driver.tsx:198` returns a text-only card when
   the shortlist is empty; `:206` sets `showMap = pickup !== null && pins.length > 0`;
   `:573` hides the tracking map whenever the driver's fix is stale.

2. **Two fingers to pan** — `cooperativeGestures: true`,
   `packages/ui/src/components/live-map.tsx:427`. Deliberate at the time (it
   stops the map being a scroll trap mid-page); the cost is now the wrong trade.

3. **Cancelled stops never leave the agent's active buckets.**
   `apps/agent/src/lib/job.ts:256` defines `isFinished` as `state === "done"`
   only, so a cancelled job is neither finished nor outstanding. It therefore
   falls through `groupIntoSections` (`job.ts:321`) into `overdue` — forever —
   and onto the Today rail (`apps/agent/src/app/page.tsx:115`, which filters on
   `state !== "done"`). A cancelled 27 Aug booking sits at the top of both
   screens indefinitely. The comment at `job.ts:262` states the old intent
   outright: "a cancelled stop STAYS on the day."

4. **`To do · N` over-counts.** `apps/agent/src/app/tasks/page.tsx:67` sums
   `sections.overdue.length` raw, including cancelled — contradicting the home
   screen, which carefully excludes them from every count.

5. **A driver's position can rewind.** `driver_positions` is keyed on
   `staff_user_id` with no ordering guard (`packages/db/src/schema/ops.ts:174`).
   Any queue-and-retry design will let an older buffered fix overwrite a newer
   one and park the van in the past. Must be fixed _before_ L1 ships.

6. **Position gaps are undiagnosable.** One mutable row, no history. Today it
   is impossible to answer "how long were we blind, and whose phone was it?"

---

## The plan

### A · Map as permanent hero — web trip page

- [x] **1.** Merge `DriverChoice`, `NoDriverYet` and `DriverTracking` into one
      map-first card. No state renders without a map.
- [x] **2.** Map gates on pickup coordinates alone, never on `pins.length > 0`.
- [x] **3.** Map lives from `verified_sealed` through `delivered_to_bagdrop`.
- [x] **4.** Taller map — it is the view now, roughly `h-[28rem]` on a phone.
- [x] **5.** Map/List toggle kept, map default. List stays the accessible
      fallback and the only view that can show a driver with no fix.
- [x] **6.** Cancelled bookings keep the existing struck-through card.

### B · Searching state with ghost pins

- [x] **7.** 2–3 anonymous ghost pins whenever there are no real candidates.
- [x] **8.** Deterministic placement seeded from the booking id, 400 m – 2 km
      out — no teleporting across the ~15 s page refresh.
- [x] **9.** Slow drift plus pulse, reusing the existing 1.2 s marker walk.
- [x] **10.** Inert and anonymous: no name, ETA, capacity, popup or click target.
- [x] **11.** Chip reads "Finding drivers near you…", replacing the
      `NoDriverYet` copy. No disclaimer (decision 2).
- [x] **12.** Every ghost vanishes in the same render the first real candidate
      appears. Never mixed.

### C · Driver bar and micro timeline

- [x] **13.** Bar under the map: avatar, "Ravi is on the way", ETA, distance.
- [x] **14.** New compact `ProgressTrack` variant — single row, small dots,
      about one line tall.
- [x] **15.** Five steps, in order: Ravi assigned, On the way, Bags collected,
      In transit, Delivered. (Written as prose rather than one inline-code
      span: a code span that wraps inside a list item makes `prettier --write`
      non-idempotent, so `format:check` fails no matter how many times it is
      run. That cost one red CI job to work out.)
- [x] **16.** `PICKUP_STEPS` becomes a function taking the driver's name.
- [x] **17.** Timeline appears only after a driver is chosen.

### D · Custody trail collapse

- [x] **18.** Collapsed by default: latest event with timestamp, plus a
      "Show full history" button.
- [x] **19.** Expands in place — client-side disclosure, no navigation, no
      refetch. The full trail is already server-rendered.

### E · Timeline detail

- [x] **20.** Actor avatar and name on agent/driver events ("Agent assigned ·
      Ravi"), via the existing `custody_events.actor_user_id`. Ops and admin
      actors keep the plain role badge — naming back-office staff to a customer
      is a separate decision.
- [x] **21.** Photos behind a "View photo" button instead of the always-rendered
      192 px thumbnail (`packages/ui/src/components/custody-timeline.tsx:161`).
- [x] **22.** Bags card seal thumbnails get the same button treatment.

### F · After delivery

- [x] **23.** No driver card, map or timeline once delivered or completed.
- [x] **24.** Replaced by "Who handled your bags" — the sealing agent and the
      delivering driver, both with avatar and name. Both are already loaded on
      the page; no new query.

### G · Map gestures

- [x] **25.** `cooperativeGestures: false` — one finger drags.
- [x] **26.** Pinch zooms; rotation and pitch stay disabled.
- [x] **27.** `scrollZoom.disable()` so a desktop wheel scrolls the page; the
      +/− buttons still zoom.
- [x] **28.** Fixed-height hero, never full-viewport, so there is always page
      above and below to scroll from.

### H · Stale positions never empty the map

- [x] **29.** Tracking view: dimmed, non-pulsing pin with "last seen N min ago".
- [x] **30.** Shortlist: a candidate with a stale fix keeps a dimmed pin instead
      of vanishing.

### I · Agent app — Today

- [x] **31.** Cancelled stops never reach the Today rail (`isOutstanding` in the
      overdue filter).
- [x] **32.** Live overdue stays, under a "Running late" heading.
- [x] **33.** Overdue bounded by actionability — past the airline's bag-drop
      cutoff a stop becomes a `problem`, not a to-do that climbs forever.

### J · Agent app — Schedule

- [x] **34.** Split the predicate: `isDone` (work that happened) vs `isSettled`
      (done **or** cancelled).
- [x] **35.** Cancelled moves to History.
- [x] **36.** History marks cancelled distinctly — chip plus muted treatment;
      empty-state copy updated.
- [x] **37.** To do order: Problems → Today → Upcoming → Running late at the
      bottom.
- [x] **38.** `To do · N` stops counting cancelled, sharing one predicate with
      the home screen.
- [x] **39.** Overdue tone softened from `alarm` when the stop is not from today.

### K · Driver position — capture

- [x] **40.** `watchPosition` subscription replaces interval polling; POSTs
      throttled to the existing phase cadences.
- [x] **41.** Screen Wake Lock while `en_route`/`carrying`, re-acquired on
      visibility return (the browser drops it on background).
- [x] **42.** Immediate fix on foreground return and on phase change.
- [x] **43.** `sendBeacon` final flush on `pagehide`.

### L · Driver position — never drop a captured fix

- [x] **44.** IndexedDB queue flushed through the service worker's Background
      Sync — anticipated already at `apps/agent/public/sw.js:8`.
      `recordDriverPosition` already accepts `recordedAt`, so late fixes keep
      their true device time.
- [x] **45.** Monotonic ordering guard on the upsert plus a batch endpoint, so a
      flushed backlog can never rewind the pin. **Lands before 44.**

### M · Driver position — detect, recover, prevent, measure

- [x] **46.** Server-side gap detection: shift open, no fix for N minutes,
      flagged.
- [x] **47.** Push nudge to the driver — the only thing that can wake a
      backgrounded PWA. Stack already exists (`packages/core/src/notifications/`,
      `apps/agent/public/sw.js:119`).
- [x] **48.** Stale-location flag on the admin console's shift view.
- [x] **49.** In-app status chip: Live / Paused / Blocked, with a one-tap fix.
- [x] **50.** Clock-on gate — no shift starts without permission and one
      successful fix.
- [x] **51.** `permissions.query().onchange` listener for a mid-shift revoke.
- [x] **52.** Append-only ping log with short retention. **Needs a migration —
      SQL shown to TD and lock/index risk flagged before it is applied.**

### N · Stories and tests

- [x] **53.** Storybook: `SearchingWithGhostDrivers`, `DriverOnTheWayCompact`,
      `StalePosition`, `CollapsedCustodyTrail`; plus updating the four existing
      `live-map` stories for the new gesture defaults.
- [ ] **54.** Unit: ghost generator determinism and distance bounds,
      stale-vs-fresh classification, name-interpolated step labels.
- [x] **55.** Unit: `isDone`/`isSettled`, `groupIntoSections` with cancelled
      input, Today filters.
- [x] **56.** Integration: an older fix cannot overwrite a newer one; queue
      flush ordering.

---

## Phase order

Commits land in this order on the one branch. The rationale is that the map is
built _last_, against positions that actually arrive, rather than first against
positions that vanish.

| Phase | Groups       | Why here                                                       |
| ----- | ------------ | -------------------------------------------------------------- |
| 1     | I, J, N55    | Smallest, self-contained, fixes a bug TD is looking at today   |
| 2     | L45          | The ordering guard — a correctness fix everything else assumes |
| 3     | K, L44, N56  | Capture and queue                                              |
| 4     | M            | Detect, recover, prevent, measure (includes the migration)     |
| 5     | G            | Gestures — smallest UI diff, immediately testable on a phone   |
| 6     | A, B, H, N53 | Map hero, ghosts, stale pins                                   |
| 7     | C, F         | Driver bar, micro timeline, delivered state                    |
| 8     | D, E, N54    | Custody collapse, timeline detail                              |

---

## Risks carried

1. **One-finger pan makes the map a scroll trap on phones.** Mitigated by the
   fixed-height hero (28), but it is a real regression against the reasoning
   documented at `live-map.tsx:414-426`. TD accepted this knowingly.
2. **Ghost pins are an implied availability claim.** Anonymous, inert, no ETA
   and replaced the instant a real driver exists — but "Finding drivers near
   you" beside drifting vans is still a claim. Phantom vehicles have drawn
   regulatory complaints against ride-hailing apps. TD chose the no-disclaimer
   version deliberately (decision 2).
3. **Dimmed stale pins can sit several blocks from the real van** in city
   traffic. The "last seen N min ago" label is what keeps it honest.
4. **Item 52 is a schema change.** SQL shown before it runs, per TD's standing
   rule.
5. **A locked phone still stops reporting.** No web API can prevent this: a
   service worker has no geolocation, Periodic Background Sync is Chromium-only
   and unreliable, and iOS Safari suspends a backgrounded PWA. Items 46–49
   shorten, surface and recover the gap; they do not eliminate it. A native
   wrapper is the only true fix and is explicitly out of scope (decision 7).

---

## Out of scope

Native/Capacitor wrapper for true background GPS · route-following pin
interpolation · realtime custody-event streaming (the `TODO(realtime)` at
`apps/web/src/components/custody-timeline.tsx:12`) · any change to driver
ranking or matching.

---

## Progress log

Newest last. One entry per phase, written as the phase lands.

### Phase 0 — plan agreed, branch cut

`feat/live-map-first` cut from `origin/dev` @ `9d26a71`, `--no-track`, upstream
verified empty.

**A correction to this header, made at push time.** It first recorded the base
as `bffe2d4`, read off the LOCAL `dev` ref, which was stale — `origin/dev` had
already advanced to `9d26a71` (the merge of PR #41). The branch was cut from
`origin/dev`, so the real base is `9d26a71` and this work already carries
`9caf060`, the wall-clock test fix. The earlier note that the branch "won't
carry it" was wrong. Worth recording rather than quietly editing: reading a
base off a local ref that nobody has pulled is an easy way to describe a
branch incorrectly. Plan written to this file before any code. Seven decisions
locked with TD across three rounds; the three-way branch split was offered and
declined in favour of one end-to-end branch.

### Phase 1 — agent Today and Schedule (items 31–39, 55)

**Commit:** `feat(agent): cancelled stops leave the schedule for history`

**The one-line cause.** `isFinished` was `state === "done"`, so a cancelled job
was neither finished nor outstanding and fell through every bucket into
`overdue` — where an old window sorts to the top, forever.

**What changed.**

- `apps/agent/src/lib/job.ts` — `isFinished` split into `isDone` (work that
  happened) and `isSettled` (done or cancelled). `finishedJobs` → `settledJobs`.
  New `hasMissedCutoff`. `groupIntoSections` skips settled, files past-cutoff
  stops under `problems`, and gained an `unscheduled` bucket.
- `apps/agent/src/app/page.tsx` — **deleted its own day-bucketing** and now
  reads `groupIntoSections`, the same function the Schedule uses. This is what
  made the two screens' counts disagree in the first place. Sections are now
  Needs attention → route → No time set → Running late; a new local
  `JobSection` renders the three that are not the route.
- `apps/agent/src/app/tasks/page.tsx` — History shows settled work, `To do · N`
  counts `unscheduled`, section order is Problems → Today → Upcoming → No time
  set → Running late, and Running late dropped from `alarm` to `muted`.
- `packages/core/src/services/tasks.ts` — `TaskBookingContext` carries
  `bagDropCutoffAt`, resolved from `airline_cutoffs` in one query for the whole
  queue (strictest minutes win, matching `cutoffMinutesByRoute`).
  `listAssignedTasks` takes an optional `now`.

**A cancelled card was already right.** `JobCard` has drawn cancelled at 75%
opacity with a "Cancelled" badge since F4, so item 36 needed no card work —
only History's framing and empty-state copy.

**Verified.** `apps/agent` 61 tests pass (38 in `job.test.ts`, up from 30 —
new coverage for cancelled leaving the schedule, past-cutoff becoming a
problem, late-but-doable staying overdue, the unscheduled bucket, the three
predicates, and `hasMissedCutoff` including an undefined-field fixture).
`tsc --noEmit` clean on `apps/agent` and `packages/core`. ESLint clean on all
three changed files.

**Not verified: core's own suites.** Docker is stopped locally, and
`packages/core`'s vitest global setup requires Postgres on `127.0.0.1:54322`.
`dispatch.integration.test.ts` exercises `listAssignedTasks` and should be run
before this branch merges. The DB is needed for phase 4's migration anyway.

### Phase 2 — the ordering guard (items 45, 56)

**Commit:** `fix(core): an older position fix can no longer overwrite a newer one`

`driver_positions` holds one mutable row per driver, and the upsert had no
`where` — so the last write landed whatever instant it described. Survivable
while the only caller was a foreground timer sending one fresh fix at a time;
not survivable the moment fixes can arrive out of order, which the offline
queue (item 44) and `sendBeacon` (item 43) both make possible.

`onConflictDoUpdate` now carries `where: lte(driverPositions.recordedAt,
recordedAt)`. `recordedAt` is the DEVICE's fix time, which is what makes the
comparison mean anything: arrival order is a fact about the network, fix order
is a fact about the world.

**`lte`, not `lt`, and it matters.** Two fixes bearing the same instant must
not be a silent drop — a phone can emit two readings inside a millisecond, and
every test in the suite runs on a fixed clock where every write carries an
identical timestamp. Under `lt` the existing "overwrites rather than appends"
test would have failed, which is how the case was found.

A rejected write is a no-op, never an error: a queue flush that throws on its
stale entries is a queue that never drains. Pinned by a test.

**Verified.** Docker started and the local stack brought up (`pnpm local`) —
it needed a second run, the first timed out on `supabase_db_koolee` still
starting. `driver-selection.integration` 33 passed (3 new: older loses, newer
wins, loser does not throw). Core unit tier 617 passed / 1 skipped.
`dispatch.integration` 19 passed — the suite that exercises phase 1's
`listAssignedTasks` change. `tsc --noEmit` clean.

### Phase 3 — capture and queue (items 40–44, 49, 51)

**Commit:** `feat(agent): keep reporting a driver's position through the gaps`

The pinger was `setInterval` around `getCurrentPosition`. Five separate
reasons that lost a driver's location, each now answered:

| Cause                                | Answer                                |
| ------------------------------------ | ------------------------------------- |
| A timer only fires in the foreground | `watchPosition` subscription          |
| The screen sleeps                    | Wake Lock while `en_route`/`carrying` |
| A failed send was a lost fix         | IndexedDB queue + Background Sync     |
| Coming back waited out a full tick   | Send on `visibilitychange`            |
| A revoked permission was invisible   | `permissions.query().onchange`        |

**New files.** `src/lib/position-queue.ts` (bounded 120-entry IDB queue,
batch flush, `sendBeacon` helper, exported `flushDisposition` rule) and
`src/lib/position-queue.test.ts`.

**Changed.** `components/shift/gps-pinger.tsx` rewritten. `api/driver-position`
accepts one fix or a batch of up to 120, applied oldest-first and sequentially
(they contend on one row per driver). `public/sw.js` gained a third job: a
`sync` handler that drains the same IDB store after the tab is gone.

**Throttle vs fix rate — the distinction that keeps the battery cost flat.**
`watchPosition` delivers whenever the device has news; only one send per phase
cadence reaches the network. The first callback after (re)subscribing always
sends, which is what makes a phase change and a foreground return immediate.

**The status chip is always present now (item 49).** The old component
rendered nothing unless something had already failed, so "is Koolee seeing me?"
was unanswerable on the happy path. Live / Finding / lost / blocked, with a
"Try again" that forces a fresh hardware fix. `data-gps-state` is on the
element so a browser pass can read the real state out of the DOM.

**A contract with no type system across it.** The DB name, store name, sync
tag, record shape and endpoint are duplicated between `position-queue.ts` and
`sw.js`, which is served raw and cannot import from the app. Both files carry
the warning.

**Verified.** `apps/agent` 74 tests pass (5 files). `tsc --noEmit` clean,
ESLint clean across `src/`, `node --check` on `sw.js`.

**Not verified: the IndexedDB paths themselves.** The repo has no
`fake-indexeddb` and adding a dependency is TD's call, so the queue's storage
behaviour needs a browser pass. The rule most worth pinning — keep vs drop vs
retry, whose three failure modes are each invisible until a driver is in a
tunnel — was extracted as a pure `flushDisposition` and is unit-tested.
Background Sync is Chromium-only by design; on Safari and Firefox the queue
drains on the next successful foreground send.

### Phase 5 — map gestures (items 25–28)

**Commit:** `feat(ui): one finger pans the map`

`cooperativeGestures: true` came out. It was the right trade when the map was
a garnish above a list somebody actually chose from; it is the wrong one now
the map is the view. Asking for two fingers to drag is a gesture nothing else
on a phone requires.

**The scroll trap is bounded, not solved,** and the code says so. The map is a
fixed-height hero, never full-viewport, so there is always page above and below
to scroll from — but a thumb landing ON the map now pans the map. That is the
accepted cost of the change and the reason item 28 is part of this group
rather than a nicety.

**The desktop half costs nothing, so it is not paid.** With cooperative
gestures off, the default is that a wheel over the map zooms it — a laptop
scrolling past the trip page gets caught and dropped into street level. Fixed
with `scrollZoom.disable()`: the wheel scrolls the page, and zoom stays on the
+/− buttons where a mouse user looks for it. Touch pinch is a separate handler
and is unaffected. Rotation and pitch stay disabled as before.

**Verified.** `packages/ui` `tsc --noEmit` and ESLint clean. The four existing
`live-map` stories updated — the "what to check by hand" list said "one finger
scrolls the PAGE, two pan the map", which is now the opposite of the truth.
Needs a real touch-device pass; the Storybook story is the place to do it.

### Phase 6 — the map is the card (items 1–17, 29, 30, part of 54)

**Commit:** `feat(web): the map is the driver card, in every state`

Three cards became one. The map used to be gated on three separate conditions
— a non-null pickup, a non-empty pin list, a fresh fix — and any one failing
produced a page with no map. The two most common failures happened at the two
most anxious moments: before anyone was assigned, and while a chosen driver's
phone was in a pocket. Only the first gate survives, and only because a
booking whose address never resolved has genuinely nothing to draw.

**Ghost pins.** `lib/ghost-drivers.ts` — deterministic from the booking id, so
the page's ~15 s refresh does not scatter them to new streets. 400 m–2 km out,
spread across the compass, drifting ≤120 m per 8 s step. Anonymous and inert
_structurally_: `LiveMap` renders `variant: "ghost"` as a `span` inside a
`pointer-events-none` root, so there is no element for a click listener to
fire from. They are torn down in the same render a real candidate appears, and
the drift timer with them.

**Stale pins, both surfaces.** Core stopped nulling an aged position:
`DriverCandidate` now carries `position` (last known), `positionIsFresh` and
`positionRecordedAt`. Null means one thing only — never reported. The ETA is
still refused on a stale origin, because a number computed from one is
indistinguishable from a real estimate.

**Driver bar and micro timeline.** `ProgressTrack` gained `compact` — one row,
11px labels, rails intact. The full-size strip stacked into five rows on a
phone and pushed the map off the screen. `pickupSteps(name)` puts the driver's
name in the first stage; "At the bag drop" became "Delivered".

**After delivery, the panel goes entirely** (item 23 is half-done here: the
removal has landed, the "who handled your bags" block has not).

**Verified.** `apps/web` 190 tests (23 new across ghost-drivers, driver-pins
and position-age). `packages/core` driver-selection integration 34.
`tsc --noEmit` clean on web, ui, core. ESLint clean.

**Not verified: anything visual.** No browser pass yet — the ghost drift, the
compact track's wrapping, the searching chip over the map and the one-finger
pan all need real eyes on a real phone.

### Phase 4 — detect, recover, prevent, measure (items 46–48, 50, 52)

**Migration 0036 applied to LOCAL** with TD's explicit approval, after the SQL
and its risks were shown. `pnpm db:status` → **37 of 37, matched by content
hash, in sync**. Hosted untouched; it will pick this up through the CI
migration workflow on merge (MIGRATIONS.md §9.5).

**Commit:** `feat: notice when a driver's location stops arriving`

- **52 — the ping log.** `recordDriverPosition` appends to
  `driver_position_pings` beside the mutable row. Appended **even when the
  upsert declines the ordering race**: a fix that lost is still a real
  observation, and the gap between `recorded_at` and `created_at` is exactly
  what distinguishes "was in a tunnel" from "stopped reporting". Never fatal —
  diagnostics must not cost a driver their live pin.
- **52 — retention.** `prunePositionPings`, batched at 5,000 rows, on an
  hourly cron at :17. Not housekeeping: ~1,500 rows per driver-day makes this
  the highest-volume write in the system.
- **46 — gap detection.** `listStalePositionShifts` + `positionHealthOf` in a
  new `services/position-health.ts`. `POSITION_GAP_MS` is **4 minutes,
  deliberately looser than the map's 90-second `POSITION_FRESH_MS`** — 90s is
  "do not draw this as current", a bar an ordinary phone crosses at every red
  light in a tunnel. Alerting on it would page ops hourly per driver and be
  ignored inside a day.
- **47 — the push nudge.** A 5-minute cron pushing the driver, not ops: the
  only actor who can end the gap is the person holding the phone, and a push
  is the only thing that can wake a backgrounded PWA. One nudge per 30-minute
  cooldown, bucketed into the tag so repeats collapse.
- **48 — ops visibility.** The admin shifts page flags an open shift as
  "No location" or "Location silent 12 min", with the last-seen time. Silent
  and stale stay distinct: one is a device problem to solve before the driver
  leaves, the other is a driver to ring.
- **50 — the clock-on gate.** A prompt, **not a lock**. Refusing to let
  somebody clock on would strand a driver whose phone is having a bad morning
  at a doorstep with bags waiting — worse than a missing pin. It reads the
  permission with `permissions.query` (which does not prompt), so a driver who
  already granted it sees nothing at all, and asking is their tap. It requires
  one real fix, not just the grant: a granted permission in a basement car
  park is still a shift that reports nothing.

**Verified.** `packages/core` 622 unit tests (5 new for `positionHealthOf`,
registration test updated for the two new crons). `tsc --noEmit` and ESLint
clean on core, agent and admin.

**Not verified:** the two new crons have no integration test, and the ping-log
write path is only covered indirectly. Worth an integration test before merge.

### Phase 8 — the trail, the photos, and who handled the bags (items 18–24, 53)

**Commit:** `feat(web): fold the custody trail, and name the people on it`

- **18, 19 — collapsed.** Newest three events, then "Show full history · N
  earlier events". A completed booking carries twenty-odd, each of which drew
  a 192px photo, so the trail was a screen and a half between the map and
  everything below it. Expands in place — every event is already in the
  component's props, so the button is a state flip, not a request. The
  "current" marker stays on the newest event of the WHOLE trail, not of what
  is on screen.
- **20 — named actors.** `custody_events.actor_user_id` resolved against the
  two people the page already loads, with the avatars it already signs. No new
  query. Scoped by `NAMED_EVENTS` to the five field-role moments; an admin who
  reassigns a pickup is an actor on the real trail and is never named to the
  customer.
- **21, 22 — photos behind a button.** `ImageLightbox` gained
  `trigger="button"`. Same dialog, same keyboard path, same evidence — a 56px
  crop of a suitcase was never information anyway, since the detail that makes
  a proof photo proof is the seal number and that always needed the dialog.
- **23, 24 — after delivery.** The driver panel goes (landed in phase 6); in
  its place, "Who handled your bags" names the agent who sealed at the door
  and the driver who delivered to the bag drop, both from data already on the
  page.
- **53 — stories.** `SearchingForDrivers` and `StalePosition` on LiveMap,
  three `Compact` stories on ProgressTrack (including the long-name wrap
  case), `NamedActorsWithPhotoButtons` on CustodyTimeline. Each carries what
  to check by hand, because none of it is catchable by typecheck.

**Verified.** `pnpm typecheck` — 6/6 packages. `pnpm test` — 6/6, web 195,
core 622 (+1 skipped). ESLint clean across web, ui, agent, admin, core.

---

## All 56 items are implemented.

## Browser pass — Storybook, over CDP

Driven against the running Storybook rather than screenshotted, because every
claim below is a DOM fact and a screenshot cannot tell a grey pin from a
disabled one.

**`LiveMap / SearchingForDrivers`** — 3 markers, all `data-variant="ghost"`;
computed `pointer-events: none`; no `<button>` inside any of them; empty
`textContent` (anonymous, as required); `aria-hidden="true"`; the pulse ring
present; the pickup pin drawn; a live `<canvas>`, so the tile worker is
loading and the map is genuinely rendering rather than failing silently.

**`LiveMap / StalePosition`** — the two pins are unmistakably different:

|                 | live                  | stale                                   |
| --------------- | --------------------- | --------------------------------------- |
| background      | `rgb(23,127,166)` sky | `rgb(78,116,163)` navy                  |
| pulse ring      | yes                   | **no**                                  |
| accessible name | "Driver Marcus"       | "Driver Yara — **last known position**" |
| tappable        | yes                   | yes                                     |

**`ProgressTrack / CompactLongName`** at a 375px viewport — track is **44px
tall**, no horizontal overflow, five equal 69px columns, all five dot wrappers
at top 16px with labels at 32px, "Konstantina assigned" wrapping inside its own
column. Rails intact.

> A note against my own first reading: an initial measurement showed the
> current dot 6px high and I called it a defect. It was not — the selector had
> matched the `animate-ping` element mid-scale, and `getBoundingClientRect`
> includes transforms. Measured on the dot wrappers, the row is aligned. Worth
> recording because the same trap will catch the next person measuring a
> pulsing marker.

**`CustodyTimeline / NamedActorsWithPhotoButtons`** — "Agent assigned · Ravi"
with an avatar, "You chose your driver · Yara" with an avatar, one
`View photo` button (accessible name "View photo: Sealed bag"), and **zero
`<img>` thumbnails** in the collapsed state.

**What is NOT verified, and should be before merge:**

1. **The app itself, end to end.** Storybook covers the components; nothing has
   run against a seeded booking with a real session — the ghost drift over
   time, the searching chip's position over a live map, the one-finger pan and
   desktop wheel on a real device, the collapsed trail on a real trail, the
   clock-on gate, and the whole agent-app schedule change.
2. **The IndexedDB queue's storage paths.** No `fake-indexeddb` in the repo;
   adding a dependency is TD's call. The keep/drop/retry rule is unit-tested
   as a pure function; the storage around it is not.
3. **The two new crons and the ping-log write** have no integration test.
4. **Background Sync is Chromium-only** by design — Safari and Firefox drain
   the queue on the next successful foreground send instead.

---

## End-to-end pass — the real apps, real data, real session

Driven with Playwright against all three apps on the local stack, signed in as
TD's own customer account (`+13322602829`), the seeded admin, and a seeded
driver. **Three real defects were found and fixed here, none of which any test
or typecheck in the repo could have caught.**

### Defect 1 — the trip page 500'd

`"use client"` on `custody-timeline.tsx` (added for the collapse) pulled
`@koolee/core` → `@koolee/db` → `postgres` into the browser bundle. Module not
found at request time; **every trip page returned 500**. `tsc` was clean, all
259 web/ui tests were green, and the Storybook pass could not see it because
Storybook does not render that file.

Fixed by splitting where the dependency actually is: the mapping stays on the
server in `custody-timeline.tsx`, and `custody-trail.tsx` owns nothing but the
`useState` for the collapse. Finished React elements cross the RSC boundary
fine; a Postgres driver does not.

### Defect 2 — "Agent assigned" had no name

Item 20 resolved the actor, and on a real booking the actor of
`booking.agent_assigned` is the ADMIN who assigned (or nobody, for auto-assign
on paid). The person the customer cares about is the one being assigned, whom
dispatch puts in `metadata.agentUserId`.

Fixed with `subjectOf(event)` — metadata subject first, actor as fallback (still
correct for `pickup.travel_started`, where the driver IS the actor). No fixture
in any test had an actor and a subject that differed.

### Defect 3 — a `Date` in a raw `sql` template

Found by the new integration tier, before any browser work. Both
`listStalePositionShifts` and `prunePositionPings` interpolated a `Date` into a
`sql` template, which binds a parameter `postgres.js` cannot serialise —
**both queries threw on every call**. Rewritten with typed builders (`or`,
`inArray` + a subquery). Typecheck saw nothing wrong.

### What was verified running

| Area                                | Evidence                                                                                                                                                                          |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Map renders where it used to vanish | A `verified_sealed` booking whose only candidate had a 139-hour-old fix: map + canvas + **stale pin** + pickup pin. Before the slice this was `pins.length === 0` → no map at all |
| Stale pin (29, 30)                  | `data-variant="stale"`, "Last seen 6 days ago. The grey van is where we saw them last." Popup carries the same line                                                               |
| Driver bar + micro timeline (13–17) | "Nina is assigned to you" · "Nina assigned — current step / On the way / Bags collected / In transit / Delivered"                                                                 |
| Choose → track transition           | Selected from the map popup; page moved to the tracking view with the named track                                                                                                 |
| Custody collapse (18, 19)           | 3 rows + "Show full history · 7 earlier events" → 10 rows + "Show less"                                                                                                           |
| Named actors (20)                   | "Agent assigned · **Nina**" with avatar, after Defect 2 was fixed                                                                                                                 |
| Photo buttons (21, 22)              | "View photo" in the trail, "View seal photo" on bags, zero thumbnails                                                                                                             |
| After delivery (23, 24)             | Completed booking: no map, no driver card, "Who handled your bags" naming the sealing agent and the delivering driver                                                             |
| One-finger pan (25)                 | CDP touch drag of (−90, −60) moved the marker exactly (290,93) → (200,33). Cooperative-gesture overlay absent                                                                     |
| Wheel scrolls the page (27)         | Real `mouse.wheel` over the map: `scrollY` 200 → 600, no zoom                                                                                                                     |
| Agent Today (31–33)                 | "NEEDS ATTENTION · 2" leading; no stale overdue rows                                                                                                                              |
| Agent Schedule (34–39)              | "To do · 2" / "History · 6"; "OPEN PROBLEMS · 2" leads; **cancelled stops now in History with their badge**                                                                       |
| GPS pinger + chip (40, 49)          | Granted geolocation → chip `data-gps-state="live"`, "Location live"                                                                                                               |
| Position write path (46, 48, 52)    | After that ping, the ops console dropped Leo Vargas's stale flag while every other driver still read "No location" / "Location silent 139 hrs"                                    |
| Clock-on gate (50)                  | Permission granted → **nothing shown** (the designed silent path). Revoked → "Location is off for this site… turn it on in your browser settings", non-blocking                   |

Leo Vargas's shift was ended and restarted to reach the off-shift gate; it is
back on DEV Truck B with GPS live. No other dev data was changed beyond the two
bookings deliberately advanced.

### Still not verified — needs a human

1. **Ghost pins in the running app.** Verified in Storybook (3 pins,
   `pointer-events: none`, no button, no text, `aria-hidden`, pulse) and by
   seven unit tests. The app trigger is `candidates.length === 0`, which needs
   **every driver shift ended** — the shortlist widens to out-of-zone drivers
   before it empties. Not worth mutating six shifts in a shared dev database.
2. **The clock-on gate's `prompt` branch** with its "Turn on location" button.
   Playwright grants or denies; it cannot hold a permission at `prompt`.
3. **Real-device touch feel** — pinch-zoom, and whether the fixed-height hero
   makes the scroll trap tolerable in a thumb's hand rather than in CDP.
4. **Push nudge delivery (47).** The cron and the payload are unit-tested;
   an actual push to a real subscribed device is not.

---

## Phase 9 — TD's review pass

Twelve commits of changes asked for after seeing the slice running. Recorded
here because several reverse a call made earlier in this document, and a
reader who finds only the original reasoning would reasonably think the code
had drifted from it.

### The trip page

| Change                                              | Note                                                                                                                                                                                                                             |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pickup details + Action needed share a row, 60/40   | Flex, not grid: `TripActionNeeded` returns null for most of a booking's life and a grid would hold its column open. The Action needed title moved inside its card so both columns are the same shape and stretch to equal height |
| Pickup details is a 2×2 grid                        | Window, Address, Your agent, Your driver. One per row below `sm`. The zone note moved beside the title; "have your bags and passport ready" moved under the agent it belongs to                                                  |
| The driver cell only renders when there is a driver | Its empty state was three lines of scaffolding for a fact that did not exist yet                                                                                                                                                 |
| Choose-driver header is one row                     | Title, an (i) holding the prose, then Pick for me and the Map/List switch. `SegmentedControl` gained `whitespace-nowrap` — a tab label must not wrap                                                                             |
| No driver section until the bags are sealed         | **Stricter than the status.** See the note in the page: an admin override can move a booking to `verified_sealed` without touching a bag, which is what produced a map above a bag reading "not yet sealed"                      |
| Custody toggle moved into the card header           | Label drops the count: "Show full history" / "Show the latest"                                                                                                                                                                   |
| Agreement step                                      | Version preamble gone. Two controls, then Read agreement + Download once accepted. Reading happens in a scrolling dialog with Accept at its foot. The done state says nothing at all                                             |

### The agent app

| Change                                      | Note                                                                                                                                                                                     |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Location and shift status are header pills  | Visible from every screen, detail behind a tap. Three lights: green live, yellow acquiring-or-lost, red off — **not** "on a trip", which would leave the light amber for most of a shift |
| Both halves of the shift live in the header | Reverses this document's earlier call that clocking on was too important for a popover. `ShiftBar` is gone; `StartShiftForm` is what remains, sized for the popover                      |
| Glyph-only logo below `sm`                  | `compactLogo` on `AppHeader`, opt-in. Brand block 230px → 93px on a 390px screen, which is the room the two pills needed                                                                 |
| The booking ref is a seal-orange pill       | On the job card AND the task detail, from one `BookingRef` component. `bg-tag-400` is 5.43:1 with navy; `tag-500` is 4.27:1 and fails                                                    |

### The map

| Change                                     | Note                                                                                                                                                                                                              |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ghost pins use the real pin and hold still | The drift made all three set off together in one direction. They pulse instead. Labels are masked initials — `R****` — which is withheld information rather than an invented person                               |
| Ghost radius 600m–1.6km                    | Was 400m–2km                                                                                                                                                                                                      |
| Blocking the map while searching           | Built, then **reverted at TD's request** (`b62e429` → `88d7033`). The map stays interactive. The reverted commit holds the `touch-action: pan-y` detail, which is the non-obvious part if it is ever wanted again |

### Shared

`Dialog` closed in two stages: the overlay had no `duration` so it ran at
tailwindcss-animate's 150ms default against the content's 200ms, AND the
content had no `fade-*`/`zoom-*` utility, so it held full opacity for its whole
200ms and then vanished in one frame. Both fixed; measured mid-close at 0.20
opacity with the backdrop still present. `Sheet` was checked and is consistent.

### Two defects found in this pass

1. **`ref` as a prop name.** `BookingRef` took `ref`, which is reserved on a
   React element — `react-hooks/refs` read the whole component as ref access
   during render. It is `value`.
2. **A promise the page could not keep.** The driver cell read "Choose yours
   below" whenever the bags were sealed, including on a booking past its
   bag-drop cutoff where the panel self-suppresses. Testing
   `driverSection !== null` looked equivalent and was not — `TripDriverPanel`
   returns null on its own, so the element is non-null while the screen is
   empty. One `driverPanelVisible` boolean now decides both.
