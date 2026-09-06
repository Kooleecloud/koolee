# Run report 10 — Map-first trip page, agent schedule, driver-position robustness

**Branch:** `feat/live-map-first`, cut from `origin/dev` @ `bffe2d4` with
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

| Group                                    | Items | Done  |
| ---------------------------------------- | ----- | ----- |
| A · Map as permanent hero                | 6     | 0     |
| B · Searching state with ghost pins      | 6     | 0     |
| C · Driver bar and micro timeline        | 5     | 0     |
| D · Custody trail collapse               | 2     | 0     |
| E · Timeline detail                      | 3     | 0     |
| F · After delivery                       | 2     | 0     |
| G · Map gestures                         | 4     | 0     |
| H · Stale positions never empty the map  | 2     | 0     |
| I · Agent app — Today                    | 3     | **3** |
| J · Agent app — Schedule                 | 6     | **6** |
| K · Driver position — capture            | 4     | 0     |
| L · Driver position — never drop a fix   | 2     | 0     |
| M · Driver position — detect and recover | 7     | 0     |
| N · Stories and tests                    | 4     | 1     |
| **Total**                                | **56** | **10** |

---

## The seven locked decisions

| #   | Decision                | Chosen                                                       |
| --- | ----------------------- | ------------------------------------------------------------ |
| 1   | Chain-of-custody card   | Collapse into a disclosure below the map                     |
| 2   | Ghost drivers           | Uber-style — anonymous, inert, no disclaimer text            |
| 3   | Stale GPS fixes         | Dimmed pin + "last seen N min ago", both surfaces            |
| 4   | Map lifespan            | `verified_sealed` → `delivered_to_bagdrop`                   |
| 5   | Agent Today tab         | Today + live overdue; cancelled never appears                |
| 6   | Agent Schedule tab      | Two tabs; cancelled → History; overdue demoted below Today   |
| 7   | Position robustness     | Max out the web path; native wrapper explicitly out of scope |

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
   one and park the van in the past. Must be fixed *before* L1 ships.

6. **Position gaps are undiagnosable.** One mutable row, no history. Today it
   is impossible to answer "how long were we blind, and whose phone was it?"

---

## The plan

### A · Map as permanent hero — web trip page

- [ ] **1.** Merge `DriverChoice`, `NoDriverYet` and `DriverTracking` into one
      map-first card. No state renders without a map.
- [ ] **2.** Map gates on pickup coordinates alone, never on `pins.length > 0`.
- [ ] **3.** Map lives from `verified_sealed` through `delivered_to_bagdrop`.
- [ ] **4.** Taller map — it is the view now, roughly `h-[28rem]` on a phone.
- [ ] **5.** Map/List toggle kept, map default. List stays the accessible
      fallback and the only view that can show a driver with no fix.
- [ ] **6.** Cancelled bookings keep the existing struck-through card.

### B · Searching state with ghost pins

- [ ] **7.** 2–3 anonymous ghost pins whenever there are no real candidates.
- [ ] **8.** Deterministic placement seeded from the booking id, 400 m – 2 km
      out — no teleporting across the ~15 s page refresh.
- [ ] **9.** Slow drift plus pulse, reusing the existing 1.2 s marker walk.
- [ ] **10.** Inert and anonymous: no name, ETA, capacity, popup or click target.
- [ ] **11.** Chip reads "Finding drivers near you…", replacing the
      `NoDriverYet` copy. No disclaimer (decision 2).
- [ ] **12.** Every ghost vanishes in the same render the first real candidate
      appears. Never mixed.

### C · Driver bar and micro timeline

- [ ] **13.** Bar under the map: avatar, "Ravi is on the way", ETA, distance.
- [ ] **14.** New compact `ProgressTrack` variant — single row, small dots,
      about one line tall.
- [ ] **15.** Five steps: `Ravi assigned → On the way → Bags collected →
      In transit → Delivered`.
- [ ] **16.** `PICKUP_STEPS` becomes a function taking the driver's name.
- [ ] **17.** Timeline appears only after a driver is chosen.

### D · Custody trail collapse

- [ ] **18.** Collapsed by default: latest event with timestamp, plus a
      "Show full history" button.
- [ ] **19.** Expands in place — client-side disclosure, no navigation, no
      refetch. The full trail is already server-rendered.

### E · Timeline detail

- [ ] **20.** Actor avatar and name on agent/driver events ("Agent assigned ·
      Ravi"), via the existing `custody_events.actor_user_id`. Ops and admin
      actors keep the plain role badge — naming back-office staff to a customer
      is a separate decision.
- [ ] **21.** Photos behind a "View photo" button instead of the always-rendered
      192 px thumbnail (`packages/ui/src/components/custody-timeline.tsx:161`).
- [ ] **22.** Bags card seal thumbnails get the same button treatment.

### F · After delivery

- [ ] **23.** No driver card, map or timeline once delivered or completed.
- [ ] **24.** Replaced by "Who handled your bags" — the sealing agent and the
      delivering driver, both with avatar and name. Both are already loaded on
      the page; no new query.

### G · Map gestures

- [ ] **25.** `cooperativeGestures: false` — one finger drags.
- [ ] **26.** Pinch zooms; rotation and pitch stay disabled.
- [ ] **27.** `scrollZoom.disable()` so a desktop wheel scrolls the page; the
      +/− buttons still zoom.
- [ ] **28.** Fixed-height hero, never full-viewport, so there is always page
      above and below to scroll from.

### H · Stale positions never empty the map

- [ ] **29.** Tracking view: dimmed, non-pulsing pin with "last seen N min ago".
- [ ] **30.** Shortlist: a candidate with a stale fix keeps a dimmed pin instead
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

- [ ] **40.** `watchPosition` subscription replaces interval polling; POSTs
      throttled to the existing phase cadences.
- [ ] **41.** Screen Wake Lock while `en_route`/`carrying`, re-acquired on
      visibility return (the browser drops it on background).
- [ ] **42.** Immediate fix on foreground return and on phase change.
- [ ] **43.** `sendBeacon` final flush on `pagehide`.

### L · Driver position — never drop a captured fix

- [ ] **44.** IndexedDB queue flushed through the service worker's Background
      Sync — anticipated already at `apps/agent/public/sw.js:8`.
      `recordDriverPosition` already accepts `recordedAt`, so late fixes keep
      their true device time.
- [ ] **45.** Monotonic ordering guard on the upsert plus a batch endpoint, so a
      flushed backlog can never rewind the pin. **Lands before 44.**

### M · Driver position — detect, recover, prevent, measure

- [ ] **46.** Server-side gap detection: shift open, no fix for N minutes,
      flagged.
- [ ] **47.** Push nudge to the driver — the only thing that can wake a
      backgrounded PWA. Stack already exists (`packages/core/src/notifications/`,
      `apps/agent/public/sw.js:119`).
- [ ] **48.** Stale-location flag on the admin console's shift view.
- [ ] **49.** In-app status chip: Live / Paused / Blocked, with a one-tap fix.
- [ ] **50.** Clock-on gate — no shift starts without permission and one
      successful fix.
- [ ] **51.** `permissions.query().onchange` listener for a mid-shift revoke.
- [ ] **52.** Append-only ping log with short retention. **Needs a migration —
      SQL shown to TD and lock/index risk flagged before it is applied.**

### N · Stories and tests

- [ ] **53.** Storybook: `SearchingWithGhostDrivers`, `DriverOnTheWayCompact`,
      `StalePosition`, `CollapsedCustodyTrail`; plus updating the four existing
      `live-map` stories for the new gesture defaults.
- [ ] **54.** Unit: ghost generator determinism and distance bounds,
      stale-vs-fresh classification, name-interpolated step labels.
- [x] **55.** Unit: `isDone`/`isSettled`, `groupIntoSections` with cancelled
      input, Today filters.
- [ ] **56.** Integration: an older fix cannot overwrite a newer one; queue
      flush ordering.

---

## Phase order

Commits land in this order on the one branch. The rationale is that the map is
built *last*, against positions that actually arrive, rather than first against
positions that vanish.

| Phase | Groups        | Why here                                                       |
| ----- | ------------- | -------------------------------------------------------------- |
| 1     | I, J, N55     | Smallest, self-contained, fixes a bug TD is looking at today   |
| 2     | L45           | The ordering guard — a correctness fix everything else assumes |
| 3     | K, L44, N56   | Capture and queue                                              |
| 4     | M             | Detect, recover, prevent, measure (includes the migration)     |
| 5     | G             | Gestures — smallest UI diff, immediately testable on a phone   |
| 6     | A, B, H, N53  | Map hero, ghosts, stale pins                                   |
| 7     | C, F          | Driver bar, micro timeline, delivered state                    |
| 8     | D, E, N54     | Custody collapse, timeline detail                              |

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

`feat/live-map-first` cut from `origin/dev` @ `bffe2d4`, `--no-track`, upstream
verified empty. Plan written to this file before any code. Seven decisions
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
