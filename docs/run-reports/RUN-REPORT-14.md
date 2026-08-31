# Run report 14 — Slice F5: cancellation lifecycle, driver map, funnel draft, admin UX

**Branch:** `feat/f5-cancellation-map-ux`, cut from `origin/dev` @ `0715d53`
(the F4 merge, PR #37) with `--no-track`. Verified before any work:

```
$ git config --get branch.feat/f5-cancellation-map-ux.merge   # empty (exit 1)
$ git status -sb
## feat/f5-cancellation-map-ux                                # no upstream
```

F4's artifacts confirmed present on the base before starting:
`packages/ui/src/lib/agreement-markdown.ts`, `packages/ui/src/components/markdown.tsx`,
`.github/workflows/ci.yml`.

**One session, one branch. Phase-sized commits. Nothing is pushed; no PR is
opened.** TD reviews, pushes and merges.

**Databases touched: LOCAL ONLY.**

---

## TD's manual items this slice creates

Read this section first; the rest is the record.

- **Nothing to set in Vercel for the map.** Phase 0's root cause was not
  configuration and introduces no environment variable, in any environment.
  See the Phase 0 finding below — this reverses the slice prompt's prime
  suspect.
- **Ratify:** D1 (customer cancel policy), D2 (funnel draft reset rule),
  D3 (pick-the-best rule).
- **Browser pass after merge on dev:** cancel a booking as a customer; open its
  agent task; pick-the-best; the map on both surfaces.

## Decisions taken mid-session

| #   | Question                                                                                                                       | TD's call                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| M1  | Map library — fix MapLibre, switch to Google Maps, or ship both behind a seam? (TD had linked two React Google Maps libraries) | **MapLibre only.** No Google Maps implementation, no seam, no second library. |
| M2  | Driver list in Phase 2 — always visible below the map, or collapsed behind a toggle?                                           | **Always visible below the map.**                                             |
| M3  | Session autonomy across seven phases                                                                                           | **Pause after Phase 0 + 1** for review before Phase 2.                        |

| M4 | Which MapLibre controls to add in Phase 2 | **All four offered:** recenter-when-panned, `GeolocateControl`, cooperative gestures, fullscreen. |

### Arrived mid-session, not in the slice prompt

TD asked for a pass over the admin app's inline forms: several surfaces render a
form permanently down the right-hand side instead of behind a labelled button
(e.g. **Invite** for staff). Named surfaces: invite staff, add a truck, agreement
history (wants a side drawer), assign ZIPs, block windows, add an airline, and
pricing (show active rules first, then an add control — open to a better shape).
**Folded into Phase 5**, where the admin UX batch already lives.

---

## Phase 0 — The map: root cause, and it was not configuration

### The symptom

The trip-page map showed "The map can't load right now. Everything else on this
page is up to date." — on a laptop and on Vercel identically, after F4's
fatal-only-before-load fix. The Storybook story showed the other face of the
same failure: a blank cream rectangle with working zoom buttons and the
OpenFreeMap attribution bar drawn over nothing.

### What the evidence actually said

The slice prompt's prime suspect was "an unset `NEXT_PUBLIC_*` style URL
silently pointing at nothing". It was not that. The tile provider is healthy and
needs no key:

```
$ curl -sS -o /dev/null -w '%{http_code}' https://tiles.openfreemap.org/styles/liberty   # 200
$ curl … /planet                    # 200   (TileJSON)
$ curl … /sprites/ofm_f384/ofm.json # 200
$ curl … /fonts/Noto%20Sans%20Regular/0-255.pbf  # 200
$ curl … /planet/…/10/301/385.pbf   # 200, 178 KB
```

Reproduced in a headed Chromium against the dev server, on a throwaway
`/map-probe` route rendering `LiveMap` with static props (created, used and
deleted inside this phase — it is not in the diff):

```
data-map-state = "failed"          after the 10s deadline
canvas          = absent
console         = ZERO errors, zero maplibre warnings

network, in order:
  GET https://tiles.openfreemap.org/styles/liberty          200
  GET https://tiles.openfreemap.org/planet                  200
  GET https://tiles.openfreemap.org/sprites/ofm_f384/ofm.json 200
  GET https://tiles.openfreemap.org/sprites/ofm_f384/ofm.png  200
  … and then NOTHING. No glyph range. No .pbf tile. Ever.
```

A second probe instrumented `window.Worker` and read MapLibre's own resolver
before the map mounted:

```
getWorkerUrl() = ""
new Worker("", {"type":"module"})
WORKER ERROR
```

### The root cause

maplibre-gl 6 works out where its tile-parsing worker lives from
`import.meta.url`:

```js
function getWorkerUrl() {
  const here = import.meta.url;
  if (!/^https?:/.test(here)) return ""; // <- the whole bug
  return new URL("./maplibre-gl-worker.mjs", here).href;
}
```

That holds only when the library is served unbundled over HTTP. Under Turbopack
`import.meta.url` is not an `http(s):` URL, so the guard returns the **empty
string**, and MapLibre goes on to call `new Worker("", { type: "module" })`. An
empty URL resolves against the document, so the browser fetches the current
**page** and tries to execute the HTML as a module. The Worker emits an `error`
event — and MapLibre never re-raises it as a map `error`.

So the style, the TileJSON and the sprites all fetch on the main thread and
succeed, the canvas mounts at the right size, the zoom buttons work, and not one
tile is ever parsed because there is nothing to parse it. `load` never fires.
Nothing anywhere reports a problem. `LiveMap`'s ten-second deadline was the only
thing catching it at all, which is exactly why the customer saw an apology
instead of a map.

**This is a bundler-independent bug, and it is not the one already documented
here.** `packages/ui/.storybook/main.ts` works around Vite's dependency
optimizer rewriting the worker import to a path it never emits — a real, older,
separate failure with an identical symptom. Both are worker-loading failures;
fixing one never touched the other. The comment in that file previously said the
apps were unaffected because they build with Turbopack. That was true of bug 1
and false of bug 2, and it is now corrected in place.

### The fix

Serve the worker ourselves, from a URL we control, and tell MapLibre where it
is.

- `scripts/copy-maplibre-worker.mjs` copies `maplibre-gl-worker.mjs` **and**
  `maplibre-gl-shared.mjs` out of `node_modules` into an app's
  `public/maplibre/`. Both files, because the worker is a real ES module whose
  first line imports the shared one relative to its own URL — copy one and it
  404s exactly as silently as the empty URL did.
- Wired into `apps/web`'s `dev` and `build`, and into `packages/ui`'s
  `storybook` and `build-storybook` (served through `staticDirs`, so the same
  `/maplibre/…` path works in both).
- `live-map.tsx` calls `setWorkerUrl(workerUrl)` before constructing the map,
  defaulting to `/maplibre/maplibre-gl-worker.mjs` and overridable per instance.
- Copied at build time, **never committed**: `**/public/maplibre/` is
  gitignored. Vendoring half a megabyte of a dependency's build output is a copy
  that drifts on the next version bump with nothing failing when it does.

### Diagnosis, next time

The failure produced no evidence at all, so the fix adds some.

- `data-map-failure` on the failed element: `webgl` | `style` | `timeout`,
  beside the existing `data-map-state`. "Is it broken" was answerable from the
  DOM; "how" was not, and the two causes look identical on screen.
- The ten-second deadline now logs the resolved worker URL and says what to
  check.
- A fatal-before-load error is logged rather than only rendered.

The customer-facing **sentence is deliberately unchanged**. The slice prompt
asked for a message stating the actual problem instead of a generic apology —
that instruction was written on the assumption the cause would be configuration.
It is not. "Worker script missing" is true, is somebody else's problem described
to a person waiting on their bags, and is not admissible under the copy rules.
The customer gets the honest, useful half ("everything else on this page is up
to date"); an engineer gets the attribute and the console line.

### What TD must set in Vercel

**Nothing.** No map provider, no key, no account, no environment variable, in
dev or in production. The map needs a build step, not a secret, and that step is
already inside the app's own `build` script — so a Vercel deploy picks it up
with no configuration change.

### Verified

| Check                          | Result                                                                                         |
| ------------------------------ | ---------------------------------------------------------------------------------------------- |
| Dev browser, `/map-probe`      | `data-map-state="ready"`, canvas present, 3 markers, tiles + glyphs streaming, no worker error |
| Storybook `Tracking/LiveMap`   | `ready`, 4 markers — TD's blank-rectangle screenshot, now a map                                |
| `pnpm format:check`            | clean                                                                                          |
| `pnpm turbo typecheck`         | 6/6                                                                                            |
| `pnpm turbo lint`              | 6/6                                                                                            |
| `pnpm turbo test`              | 929 passed, 1 skipped (core 584, web 162, ui 151, admin 32)                                    |
| `pnpm turbo build`             | 3/3                                                                                            |
| `next start` (prod, port 3010) | `/maplibre/maplibre-gl-worker.mjs` → 200 `application/javascript`; shared → 200                |
| Prod client bundle             | `workerUrl:s="/maplibre/maplibre-gl-worker.mjs"` present — the literal survives Turbopack      |

One lint consequence worth recording: the copied worker is minified vendor
output living under `public/`, where nothing is ignored by extension. ESLint
found 1,228 errors in it on the first run; `**/public/maplibre/**` is now in the
shared ignore list. Prettier needed no change — Prettier 3 honours `.gitignore`.

---

## Phase 1 — Cancellation, end to end

### 1. The customer can call it off (D1, implemented as written)

`cancelBookingByCustomer` in `packages/core/src/services/cancellation.ts`. It is
**policy around the existing cancellation, not a second one**: ownership, then
three gates, then `cancelBookingWithRefund` — the same call the console makes,
which runs the state machine's `cancel`, releases the slot, writes the custody
event and voids the authorization through the payment seam. None of that is
reimplemented. The only differences from an admin cancellation are who the
actor is and which gates had to pass.

The three gates, and why each is where it is:

| Gate    | Rule                                                            | Why                                                                                                                                                                                                                                                                                                                                           |
| ------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status  | `paid` or `agent_assigned` only                                 | Narrower than the state machine, which accepts `cancel` from `verified_sealed` and `awaiting_pickup` too. Those mean the visit HAPPENED — a passport was checked, bags were weighed, photographed and sealed with numbered stock. Undoing that is a conversation, and somebody has to account for the seals. Ops can still cancel from there. |
| Window  | `now < pickup_window_start`, and a booking with NO window fails | Mirrors agreement §5 semantics. A null window fails deliberately: guessing wrong either cancels something in flight or charges somebody who asked in time.                                                                                                                                                                                    |
| Capture | Nothing captured (latest payment row, across ALL providers)     | An authorization is released; a capture is money that left an account, and giving it back is a refund with a fee policy this product does not have yet. Deliberately wider than `cancelBookingWithRefund`'s provider-scoped lookup — a capture under a provider we no longer configure is still money gone.                                   |

`customerCancelEligibility` is exported and called by BOTH the trip page and the
server action, so a rendered button and a server refusal cannot disagree about
the rule. The action re-checks server-side regardless: a Server Action stays a
reachable POST whatever the page drew.

### 2. Who cancelled it, on all three surfaces

`custody_events` has recorded the actor since the state machine was written.
Nothing rendered it. `cancellationFromTimeline` reads it off a timeline the
caller already has (no second query), and `by` is derived from the actor's ROLE
rather than by comparing the actor to the booking's owner — an admin cancelling
their own personal booking is still Koolee cancelling it, and the customer
should read it that way.

- **Customer trip page** — "Cancelled by you on <date>" / "Cancelled by Koolee
  on <date>", above everything else, because on a cancelled booking it is the
  only fact on the page that matters. Ours offers support and shows the reason;
  theirs does not (their own words read back is noise).
- **Agent task detail** — "Cancelled by the customer · <when>" (below).
- **Admin booking detail** — the custody TRAIL already showed actor name, role,
  face and timestamp for `booking.cancelled` and is unchanged. What was missing
  was the answer without a scroll, so a one-line banner sits under the
  actionability notice: a support call about a cancelled booking opens with "was
  this them or us?", and finding it meant reading a twenty-event timeline.

### 3. The agent's task detail hard-stops

F4 fixed the CARD. Opening it was untouched: the detail page still drew a live
Navigate link, a live Call button and the whole guided flow — "I'm on my way",
arrive, scan a seal — for a pickup that was not happening. The server refused
every one, correctly and invisibly.

Both branches now ask `bookingActionability(...).standing === "terminal"` — the
same service the card consults and core enforces with, not a status array in the
page. On a stopped job: `DoorstepCard` drops Navigate and Call (the address
stays — reading it is not acting on it), the payment banner goes, and
`TaskStopped` renders the headline with the actor, above `TaskRecord` for the
history.

`TaskRecord`'s `exception: boolean` became `outcome: "clean" | "exception" |
"stopped"`. The boolean could only have said "Visit complete" on a cancelled
booking, which is simply false.

Realtime: `LiveTasks` stays subscribed right up to the moment the job stops, so
a cancellation landing while the page is open on a phone flips it live — the
`custody_events` trigger fires the signal on the transition. Off once it HAS
stopped: nothing further can arrive on a terminal booking.

### 4. The error handler stopped lying

`apps/agent/src/lib/action-error.ts`, used by both action files.

The reported symptom was a driver tapping "I'm on my way" on a cancelled pickup
and reading **"Couldn't start pickup. Check your connection and retry."** Their
connection was fine. `startPickupTravel` refused through `assertActionable`,
which throws `BookingNotActionableError` carrying "This booking was cancelled."
— and the handler matched `NotFoundError` and `ConflictError` only, so the one
message that would have ended the confusion fell through to the connection
fallback. Telling somebody their phone is broken when the answer is "this job
does not exist any more" is an instruction to keep trying.

It now matches the BASE class. Every `CoreError` is a deliberate refusal
carrying a message written to be read, so a refusal added tomorrow surfaces
correctly the day it is written — the opposite of how this happened. Transport
failures still say "check your connection", and only they are logged: a console
full of correct refusals is a console nobody reads. The shift actions had the
same shape with four subclasses and now share the one rule.

### 5. Ops visibility — nothing to do

The slice prompt said to add cancelled-by-customer to the admin board's recent
activity **only if such a surface exists**. It does not: the console dashboard
has "Next up" and "Coverage today" and no activity feed. Not built, per the
instruction.

### Arrived mid-phase from TD: "Late" on a cancelled stop

TD reported the agent journey still badging a cancelled stop as **Late**. It
did, and it was worse than the badge — F4 gave a cancelled booking its own
`JobState` and fixed the expanded card, but never taught the DAY about it.
`isFinished` is `state === "done"`, so every derivation using "not done" to mean
"work" still counted cancelled stops. One driver with two live jobs and one
cancelled one read:

- **"3 to do"** in the header,
- **"· 1 late"** for a stop nobody was going to,
- **"Your route · 3 stops"**,
- a compact row with a **Late** badge, no Cancelled badge, and a plain rail dot
  indistinguishable from an upcoming stop,
- and — if it sorted first — the cancelled stop taking the "one open stop" slot,
  demoting the real next job to a compact row behind it.

Fixed with one predicate, `isOutstanding` (`not done AND not cancelled`), kept
separate from `isFinished` on purpose: History lists work somebody DID, and
nobody did this one. Merging them would either file a cancelled booking under
the driver's completed work or put it back in the to-do count.

**The stop still shows.** That is F4's call and it stands — a schedule that
quietly loses stops is one nobody can reconcile against what they actually did.
The row is dimmed, badged Cancelled, struck through on the rail, never Late,
never counted, and never the current stop.

**Still openable, deliberately** — TD asked whether it should be disabled. The
detail page behind it is now the only place that says who cancelled it and when,
which is exactly what a driver told to go to that address needs. A dead row
answers nothing and reads as a bug.

### Verified

| Check                                         | Result                                                                                                                                                  |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm format:check`                           | clean                                                                                                                                                   |
| `pnpm turbo typecheck`                        | 6/6                                                                                                                                                     |
| `pnpm turbo lint`                             | 6/6                                                                                                                                                     |
| `pnpm turbo test`                             | 999 passed, 1 skipped (+16 this phase: 10 unit, 6 agent)                                                                                                |
| `pnpm --filter @koolee/core test:integration` | 366 passed, 3 skipped, 32 files — includes 19 new cancellation cases                                                                                    |
| `pnpm turbo build`                            | 3/3                                                                                                                                                     |
| Browser (headed Chromium)                     | Cancelled trip page renders "Cancelled by Koolee on Mon 31 Aug, 5:09 PM EDT" with the support line, and offers no Cancel control — the correct negative |

**Not verified in a browser, and TD's manual pass should cover it:** the cancel
BUTTON itself. No booking in the local database is `paid`/`agent_assigned` before
its window (the seven are two sealed, two complete, two cancelled, one awaiting
payment), so the positive case has no live subject here. The rule behind it is
proved by 19 integration cases against real Postgres — window boundary to the
millisecond, ownership 404, capture refusal, double-cancel, actor, and the hold
actually released at the provider — and the prod build proves it bundles.

### Carried into Phase 2 (TD, mid-session)

**Pin flicker on hover.** Diagnosed, not yet fixed. The driver pin carries
`transition-transform hover:scale-110` on the element MAPLIBRE OWNS. Two
separate faults in one class list:

- MapLibre rewrites that element's `transform: translate(...)` on every render
  frame, and `transition-transform` makes the browser animate each of those
  rewrites. `walkMarker`'s own `requestAnimationFrame` loop writes a new
  position every frame during the 1.2s walk, so the CSS transition restarts on
  each one — two animations driving the same property.
- Tailwind v4 compiles `scale-110` to the standalone `scale:` property, not to
  `transform`, so `transition-transform` does not animate the hover growth at
  all. It was never doing the job it was added for.

The fix is the standard MapLibre pattern: the marker element belongs to the
library and is positioned by it; every visual effect goes on a child. Phase 2.

**Map refresh cadence, asked and answered.** Four numbers, all measured from
the code rather than estimated:

| Hop                       | Interval                                      | Where                                                     |
| ------------------------- | --------------------------------------------- | --------------------------------------------------------- |
| Driver's phone → server   | **45 s** (a fix older than 60 s is discarded) | `PING_INTERVAL_MS`, `apps/agent/.../gps-pinger.tsx`       |
| Server → customer's page  | signal, else **30 s** poll, 400 ms debounce   | `SIGNAL_POLL_MS`, `packages/ui/src/lib/booking-signal.ts` |
| Position considered stale | **3 min** — dropped rather than drawn         | `POSITION_FRESH_MS`, `services/driver-selection.ts`       |
| Pin walk between fixes    | **1.2 s** eased; jumps past 2.5 km            | `MOVE_DURATION_MS`, `MAX_SMOOTH_METRES`                   |

**A finding that matters for Phase 2.** On the driver-SELECTION step the
realtime signal does nothing. `recordDriverPosition` touches
`booking_signals` only for bookings whose pickup task is already bound to that
driver's shift (`driver_shift_id = shift.id`, status assigned/in_progress) —
and during selection no driver has been chosen, so `driver_shift_id` is null.
Candidate pins therefore move on the **30-second poll alone**, not live. The
tracking map after selection is the one that gets the 45-second signal.

That is a deliberate scoping in `recordDriverPosition` ("so a ping does not
wake pages for bookings whose bags are still on a doorstep"), not a bug — but
Phase 2's "pins refresh on the existing signal/poll cadence" means 30 s there,
and the copy around the shortlist must not imply anything faster.

---

## Phase 2 — The map becomes the way you choose

### The pin flicker (TD, and it was not a hover bug)

Hovering only made it visible. MapLibre positions a marker by writing

```js
element.style.transform = "translate(-50%,-50%) translate(412px, 233px) …";
```

on the marker's own ROOT element, on **every render frame**. The pin carried
`transition-transform`, and in Tailwind v4 that compiles to
`transition-property: transform, translate, scale, rotate` — so the browser was
asked to animate every one of those position writes over 150ms. During
`walkMarker`'s 1.2s `requestAnimationFrame` walk, and during any pan or zoom,
the transition restarted before the previous one finished: the pin lagged the
map and jittered. Growing it on hover put a second animation on the same
element and made the fight obvious.

**A correction to the earlier note in this report:** it said `scale-110` was not
transitioned at all because Tailwind v4 emits the standalone `scale` property.
The property is standalone, but `transition-transform` covers it — checked in
the compiled CSS. The transition was working; it was working on `transform` too,
which is what broke.

Fixed the standard MapLibre way: the marker root is now a bare positioning
shell, and everything visual lives on a child MapLibre never touches.
`data-selected` stays on the root (the drivers effect already reconciles it) and
the child styles off it with `group-data-*`; `aria-pressed` moved to the button,
where a screen reader expects it, with one helper keeping the two in step.

Proved in a browser rather than by reading it:

```
root transition-property : "opacity"      (nothing transform-related)
child transition-property: "scale"        (only the growth)
root transform, hovered == root transform, not hovered   → true
```

### The four controls

| Control              | State                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------ |
| Recenter when panned | Built. Bottom-left — zoom/fullscreen own the top right, attribution owns the bottom right. |
| Cooperative gestures | On. One finger scrolls the page, two pan the map; ctrl+wheel zooms.                        |
| Fullscreen           | On.                                                                                        |
| ~~GeolocateControl~~ | **Removed on TD's reasoning — see below.**                                                 |

**Why the viewer's own location came back out.** It was wired in, because the
slice asked for the customer's live dot. TD's argument is better than the
requirement: _the pickup address is the anchor, not the viewer._ Somebody
booking a pickup for a friend across the city is shown a dot that is irrelevant
and looks like it means something, when the question the map answers is "how
close is a van to THE DOOR". Even standing at the address it adds nothing the
pickup pin does not already say — and it costs a geolocation permission prompt,
which is one-shot per origin in most browsers. Spending that on a feature that
cannot help is worse than not having it.

**The recenter rule changed once, mid-build.** The first version showed the
button only when the viewer had moved the map _and_ something had gone off
screen. Verified in the browser and it was too clever: a small nudge left the
customer disoriented with no button, because technically everything was still in
frame. It now appears the moment a real gesture arrives — which is exactly when
automatic framing STOPS, so the pair reads as one idea: the map is yours now,
and this gives it back.

That auto-framing change matters on its own. The map used to re-frame itself
whenever a driver left the viewport, so somebody who zoomed in to see which
corner a van was on had the viewport pulled out from under them at the next
ping, every ping. `originalEvent` is what separates a person's drag from our own
`fitBounds` — MapLibre fires the same events for both.

### Pin → card → select

One `Popup`, moved rather than re-created, with its content node portalled into
by React. MapLibre keeps it pinned through every pan and zoom, which is the
whole reason not to hand-position a card with `map.project` and a `moveend`
listener.

Two settings are load-bearing and both were found by watching it fail:
`closeOnClick: false`, because the click that opens a popup is a click on a pin
which bubbles to the map — with it on, the card opened and closed in the same
gesture; and `closeOnMove: false`, because the driver's own ping moves the map
and a card that vanishes every twenty seconds while somebody is reading it is
worse than no card.

The card shows the same facts as the list row and runs the same
`selectDriverAction`. Which pin is open is held by the PAGE, not the map — it is
the same fact as which row is highlighted, and two components each keeping a
copy is how they disagree.

A driver who drops out takes the card with them, **derived rather than synced**:
the obvious effect that clears the id renders one frame with a card for
somebody who is gone, and sets state inside an effect. What is open is a
function of the shortlist, so it is computed.

### Pick the best (D3, implemented as written)

`bestCandidate` in core: nearest by ETA, tie-broken on the lowest bag load, then
shift id. Ranked on `minMinutes` because that is the number the card leads with
— a shortcut that disagreed with the two ranges a customer is reading would be a
different system wearing a shortcut's label. A driver with no ETA never wins
(there is no honest way to rank an unknown against a number) but stays
choosable by hand.

It runs the SAME `selectDriverAction` with the shift id core picked, so the
transaction, the advisory lock and the lost-race behaviour are identical to a
manual pick. There is exactly one way to be assigned a driver.

Decided server-side and passed down. Recomputing it in the browser would mean
ranking on preformatted strings like "about 25 min".

### The rest

- **Map or list, one at a time — TD reversed M2 mid-build, and was right.** The
  stacked version gave the map about a third of a phone screen and put the cards
  below the fold: neither view was any good. It is now a `role="tablist"`
  segmented control matching the agent app's schedule/history one, defaulting to
  Map, with the driver count on the List tab.

  Three things this had to get right. **The toggle only exists when a map is
  possible** — no coordinates, or nobody has reported a position, and the list is
  the only view rather than one of two; `showMap` is read once and drives both
  the control and the view, so they cannot disagree. **The list is a full tab,
  not a fallback**, always reachable, and it carries every driver including the
  ones with no position to pin — the map view says so in a sentence when the two
  counts differ, which is also why the count sits on the List tab alone. **After
  selection there is no toggle at all:** `DriverTracking` is map-only, because
  there is nothing left to compare.

- **Both maps bleed to the section edge** (TD's spacing note). The card content
  drops its inner padding and everything that is not the map puts it back.
- **Refresh cadence on this surface is 30 s**, not the 45 s signal — see the
  finding recorded above. Nothing in the copy implies faster.

### Verified

| Check                                         | Result                                                                                                                                      |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm format:check`                           | clean                                                                                                                                       |
| `pnpm turbo typecheck` / `lint`               | 6/6, 6/6                                                                                                                                    |
| `pnpm turbo test`                             | 1,017 passed, 1 skipped (+18 this phase: 10 `bestCandidate`, 8 `driverPins`)                                                                |
| `pnpm --filter @koolee/core test:integration` | 366 passed, 3 skipped                                                                                                                       |
| `pnpm turbo build`                            | 3/3                                                                                                                                         |
| Browser — controls                            | `data-map-state="ready"`, 4 pins, zoom + fullscreen present, geolocate absent, cooperative-gesture layer present                            |
| Browser — card                                | tap a pin → card anchored, correct driver, close button, `data-selected` on root and `aria-pressed` on button both true                     |
| Browser — recenter                            | absent on an untouched map; appears after a 60px nudge as "Back to my pickup"; clicking restores all 4 markers to frame and the button goes |
| Browser — flicker                             | root transitions `opacity` only; child transitions `scale` only; root transform unchanged by hover                                          |

**Still not browser-verified:** the shortlist as the trip page renders it. No
local booking has two candidates with reported positions (the one sealed booking
has a single driver who has never pinged), so the pin/card/pick-the-best flow was
exercised through the Storybook story instead — the same surface that caught both
map bugs. TD's post-merge pass on dev covers the real thing.

---

## Phase 3 — The funnel's front door starts a new booking (D2)

`/book` resumed unconditionally. Pressing "Book a pickup" dropped you back into
a half-finished booking from days ago — at whatever step it had reached, with
its flight and address prefilled. For somebody genuinely coming back that is
right; for somebody booking a second trip it is baffling, and the only way out
was to notice and edit every field.

**The two halves pull against each other.** A fresh entry must start clean, and
nothing may be silently destroyed to achieve it. Clearing the draft outright
would make a resume offer impossible; keeping it live would mean the entry was
never clean. So the old draft is **moved** to `koolee_draft_prev`: the live
cookie really does go, the first step really is empty, and one tap puts it back.

- The stash is shorter-lived than the draft (an hour vs. 24 h) — "you were in
  the middle of something a moment ago", not an archive. Account holders keep
  the real net regardless: the `booking_drafts` mirror row lives seven days.
- **Only a draft with PROGRESS is offered.** A cookie holding nothing but a
  `draftId` minted by a ticket upload that went nowhere is not something anybody
  remembers starting.
- **A leftover stash is dropped** when there is nothing to replace it with —
  otherwise somebody who finished a booking and came back would be offered one
  they had already completed.
- **The account-holder mirror is now OFFERED, not entered.** An empty cookie
  plus a `booking_drafts` row is a draft from another device, which is worth
  proposing and no longer worth redirecting into unasked.
- **Extracted ticket data goes with the draft** — `ticketPrefill` is a key on
  that cookie, so the reset takes the model's reading of somebody's itinerary
  with it, and a resume brings it back. Otherwise "resume" would mean "start
  again from the ZIP".

The resume offer is a **line, not a dialog**. An interstitial asks everybody to
answer a question most of them do not have, in front of the step they came for.
It names the route and flight rather than saying "you have a saved draft", which
describes our cookie rather than their trip, and "No thanks" drops the stash
only — dismissing a prompt is not discarding a booking, and `startOverBooking`
remains the thing that actually throws work away.

**Nothing F4 built changed.** Back and forward between steps, a rejected ZIP and
a mid-funnel reload never come through this door — they address `/book/flight`
and friends directly — which is exactly why the door can be this decisive.
`flight-rejection.test.ts` still passes untouched.

### Verified

| Check                                      | Result                                      |
| ------------------------------------------ | ------------------------------------------- |
| `pnpm format:check` / `typecheck` / `lint` | clean, 6/6, 6/6                             |
| `pnpm turbo test`                          | 1,027 passed, 1 skipped (+10 `fresh-entry`) |
| `pnpm turbo build`                         | 3/3                                         |

The ten new cases cover the reset, the stash round-trip, the ticket-prefill
carry, the no-progress and leftover-stash cases, the mirror being offered rather
than entered, and the mirror failing without costing the customer the funnel.

---

## Phase 2 addendum — the pickup pin, and where the popup chrome lives

Four rounds of TD's feedback on the map, all after the gates above.

**The map's note moved into the header.** "Tap a van to see who it is and
choose them" sat under the map, which forced a gap between the map and the
card's own edge — exactly the padding the section had just been stripped of.
Under the description it reads as part of the instructions, and the map can sit
flush with nothing after it.

**Both maps bleed properly now.** `LiveMap` gained `frame` (default true);
`false` drops its own border and rounding so a map spanning a card's full width
does not draw a second rule a pixel inside the card's, and the card clips
instead — so the map takes the card's own corner radius.

**The pickup pin is the Koolee bag.** It was a plain navy dot, which said "a
place" and nothing else, on a map whose whole subject is bags being collected
from that place. It is now the same mark as `JourneyGlyph name="seal"` on the
marketing page — simplified rather than redrawn, and after a correction from
TD, _the same way round_: a **navy bag on white with the tag in `#FF6B35`**. The
first attempt inverted it (navy ground, white bag) and read as a different icon
that happened to share a silhouette. An earlier attempt also put the orange as a
dot on the bag's front; it is a tag HANGING off the side, because that gesture
is what the glyph makes.

It is square-ish against the drivers' rounded pills — shape carries the
difference before colour does — and larger than them at 44px, because it is the
one fixed thing on the map, because the glyph is unreadable at pin size, and
because it is now a button and 44px is the smallest comfortable touch target.

**It says what it is.** Tapping it opens its own popup: "Your pickup" and the
street. Previously `aria-hidden`, a decoration. It is the anchor of the whole
map, and "which of these is my house" is a fair question to be able to ask —
most of all for somebody who booked for a friend and has no local sense of the
map. Its own `Popup` instance, not the controlled driver one: what it says
involves no page state, and routing it through `popupDriverId` would make the
page own a fact it has no use for. Built as DOM with `textContent`, never
`innerHTML` — the second line is an address somebody typed.

**The popup chrome moved to `packages/ui/styles/map.css`.** It was written in
`apps/web/globals.css`, where Storybook could not see it — so the story showed
square corners and a close button proud of its own card while the app did not,
and the story is the one place this component is actually reviewed. Both import
it now. Not imported from `live-map.tsx`, because `@koolee/ui` declares
`sideEffects: false` and a CSS import inside it is droppable, silently — the
same reason the MapLibre stylesheet is imported per app.

Verified in the browser after each round: pin 44×44 and focusable, `aria-label`
"Your pickup", the card opens with the right text and our own corner radius in
Storybook as well as the app. Gates re-run clean — 1,027 unit, builds 3/3.

---

## Phase 2 addendum 2 — making the shortlist map feel live

TD asked for "whatever makes this map feature more live and fun and
interactive", having read the 30-second finding.

**The poll on that one screen is now 12 s** (`SIGNAL_POLL_FAST_MS`), derived
from the stage the server already computes, so it turns itself off the moment a
driver is chosen and the socket takes over.

**The expensive option was declined, with a reason.** Widening
`recordDriverPosition` to also signal sealed bookings awaiting a driver would
make the shortlist genuinely live — and would mean one driver's ping waking
every customer currently choosing, where each wake is a **full trip-page
re-render**: the candidate query, and an ETA round-trip per candidate through
the Routes seam. Four candidates × three pings a minute × everybody choosing is
a lot of billable work for pins that move a block. The scoping is a decision,
not an oversight, and it is now written down where the constant is.

**A ring behind every driver pin** (`--animate-pin-ping`, 2.8 s). Between
updates every pin holds perfectly still, and a still map is indistinguishable
from a broken one — the exact confusion this component has already cost twice.
The ring says "these are live positions" continuously, without claiming a
frequency it cannot keep and without one extra request. Slow and low-contrast
on purpose: a fast, bright pulse reads as an alert, and nothing here is wrong.
`motion-reduce:hidden` drops it entirely — somebody who asked for less motion is
not asking for a subtler version of it.

Verified in the browser: `animationName: "pin-ping"`, 2.8 s, infinite, and the
computed opacity sampled at three moments (0 → 0.195 → 0.075) proves it is
actually running rather than merely declared.

## Closing the browser-coverage gap

`DriverChoice` cannot be storied in this Storybook: it is `@storybook/react-vite`
with no Next adapter, and the component uses `useRouter` and imports a server
action at module scope. Making it renderable there is framework work, not a
story, and it would be fragile.

What was done instead is the thing that was actually wrong underneath.
**`SegmentedControl` is now in `packages/ui`, with a story, and both apps use
it.** The agent's schedule/history switch and the customer's new map/list switch
were written independently three weeks apart and arrived at the same control by
coincidence — the same padded track, the same raised pill, very nearly the same
class strings. Two apps quietly growing their own copy of one control is how the
consoles drift, and lifting on the second use is the repo's own rule.

It supports links _or_ buttons because the two callers genuinely differ: the
agent's tabs are URLs you can bookmark, the customer's is a view preference no
URL should carry. The active tab is RAISED rather than tinted — a colour change
alone is what disappears at a glance on a small screen or in bright sun.

Verified by driving the story: both tabs render with `role="tab"`, clicking
List flips `aria-selected` on both and swaps the rendered view.

**Still not seen on the real trip page:** the shortlist as `/trips/[bookingId]`
renders it — the map inside that card, and the pick-the-best row. Both need a
booking with sealed bags and two positioned drivers, which the local database
does not have. TD's post-merge browser pass covers it.

---

## Phase 4 — Reassignment gates

The brief asked to close reassignment at two moments and route both through
the F1 actionability service instead of scattered status checks. Doing that
found a hole none of the three call sites had noticed.

### What was actually there

Three places each carried their own status list, and **not one of them
mentioned `cancelled`**:

| Call site              | Its own check                                     | Missing                |
| ---------------------- | ------------------------------------------------- | ---------------------- |
| `assignAgentToBooking` | verification task `done`/`completedAt`            | every booking standing |
| `adminUnassignPickup`  | `in_transit`, `delivered_to_bagdrop`, `completed` | `cancelled`            |
| `adminReassignPickup`  | `delivered_to_bagdrop`, `completed`               | `cancelled`            |

So a cancelled booking could have its driver swapped. Worse: in
`assignAgentToBooking` the status check ran only for a FIRST assignment
(`!reassigned`), so a cancelled booking that already had an agent skipped it
outright and could be reassigned freely.

### `assignmentGate`, in the actionability service

One function, next to the five customer/agent gates but deliberately **not one
of them**. Those five are all about TIME — a late booking is still savable,
which is the whole reason `phase` exists. Reassignment is about STANDING alone:
a booking twenty minutes past its window can still be handed to a driver who
can make the cutoff, and that is exactly when a dispatcher needs it. So the
gate reads `standing` and never `phase`, and folding it into `BookingActions`
would have dragged the time axis in with it.

**The two kinds close at different moments, and that asymmetry is the point.**

- **Verification closes when the VISIT is done.** Once bags are sealed, the
  seals, the photos and the passport check are recorded against the agent who
  did them; reassigning would reattribute somebody's evidence.
- **Pickup closes when the BOOKING is done**, which is later. A driver can be
  swapped right up until the bags are in a van, because until then the job is
  "go to a door" and any driver can do it.

**The in-transit refusal stayed where it was**, deliberately. Its sentence
names force-end-shift as the honest route, which is a fact about the incident
path rather than about standing — and F4's rule that it stays a refusal rather
than becoming a silent exception is untouched.

### The console says the same thing

Both panels read the same gate the server refuses with, and render **the gate's
own sentence in place of the control**. A control hidden by one rule while the
server refuses by another is how an operator ends up looking at a button that
cannot work — or at no button when the action was available all along.

### One test assertion changed, and why

`dispatch.integration.test.ts` asserted `/completed/` against a message that
now lives in the shared gate and reads "the visit is already complete", plus
why. The rule the test exists for is unchanged and still asserted; only the
wording it matches moved. Noted here rather than quietly adjusted.

### Verified

| Check                                         | Result                                         |
| --------------------------------------------- | ---------------------------------------------- |
| `pnpm format:check` / `typecheck` / `lint`    | clean, 6/6, 6/6                                |
| `pnpm turbo test`                             | 1,041 passed, 1 skipped (+13 `assignmentGate`) |
| `pnpm --filter @koolee/core test:integration` | 366 passed, 3 skipped                          |
| `pnpm turbo build`                            | 3/3                                            |

---

## Phase 5 (part 1) — the console stops keeping a form open all day

TD's mid-session note: several admin pages render a form permanently down the
right instead of behind a labelled button.

### What was there

Six pages had grown the same layout — a list on the left and a form pinned down
the right in a `2fr 1fr` grid: invite staff, add a truck, assign ZIPs, block
windows, add an airline, publish a pricing rule. Every one of those forms is
used occasionally and read never, and each was taking a third of the page from
the thing an operator came to look at. The staff roster, the truck list and the
zone table all rendered in two thirds of their available width, with a blank
form beside them, permanently.

### `Sheet` and `FormSheet`, in `packages/ui`

A side panel built on the same Radix Dialog primitive the modal already uses, so
focus trapping, scroll locking, Escape and return-focus-to-trigger are the app's
existing ones rather than a second implementation.

**A sheet rather than a dialog**, and the difference matters for these: a modal
in the middle of the screen is for a decision — confirm, cancel — while these
are data entry with five or six fields and sometimes a list to scroll. A side
panel gives them full page height without covering the table the operator is
checking their entry against. `ConfirmDialog` stays exactly what it is and is
still right for a destructive yes/no.

`FormSheet` wraps trigger + title + description + close, so six pages do not
each wire that up — which is how six sheets end up with six paddings and one of
them missing its description.

### Pricing got more than a sheet

It was the worst of the six and TD asked for better. The publish FORM was in the
wide left column and the live rule was second and narrower **below it**, so the
one question anybody opens that page to answer — what are we charging right
now? — was answered after a form nobody came to fill in, and the actual figures
existed only in the page subtitle.

Now the live rule leads, with its base fee, per-bag and per-km **as figures at a
size somebody can read across a desk** (a price is the kind of number that gets
read out loud on a call), the history follows under its own heading each one
click from being live again, and publishing is a header button. With no active
rule the lead card says so in destructive colours, because "every quote is
refusing right now" is the most important sentence on that page when it is true.

### Agreements: history is a drawer

Different from the other five and worth stating. It was a genuine master-detail
`2fr 1fr`, not a form pinned to a side — but the editor is a rich-text surface
for a legal document and wants every pixel, while the history is a list somebody
scans occasionally to view or amend a version. So the editor gets the page and
the history opens over it. Picking a version closes the drawer: otherwise it
stays open over the editor it just loaded something into.

### The sidebar's "2", also from TD — and it was a bug

The Shifts badge counts sealed bookings with no driver chosen. The rail's
screen-reader text was a ternary that knew about two of the three badges:
`exceptionsOpen` said "open" and **everything else** said "needing an agent". So
that badge announced "Shifts, 2 needing an agent" — a different problem on a
different page. Sighted operators got a bare "2" whose only tooltip described
the section rather than the number.

`CONSOLE_BADGE_MEANING` is now a `Record` keyed by the badge type, so a new
badge cannot be added without a phrase — the compiler asks. It feeds both the
screen-reader text and a tooltip on the number itself.

### Verified

| Check                                      | Result                                                                                                                                                                                 |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm format:check` / `typecheck` / `lint` | clean, 6/6, 6/6                                                                                                                                                                        |
| `pnpm turbo test`                          | 1,042 passed, 1 skipped                                                                                                                                                                |
| `pnpm turbo build`                         | 3/3                                                                                                                                                                                    |
| Browser (admin, headed)                    | Invite opens a 448px right-hand sheet titled "Invite staff" with the email field; the roster behind it now uses the full width; the rail badge's tooltip reads "2 waiting on a driver" |

**Still to do in Phase 5:** staff grouped by role with filters and per-person
workload, trucks editable during an active shift, booking-detail section
consolidation, booking-list filters applying immediately with a debounced
search, and agent/admin profile parity with the customer app.

---

## Phase 5 (part 2) — the rest of the admin batch

### Zone removal asks first

The "×" was a bare submit on a chip `h-6 px-1.5`, in a row of eight or ten
identical chips. One mis-aimed click silently narrowed an agent's coverage, and
the only way to notice was that auto-assign quietly stopped picking them for a
neighbourhood. The dialog names BOTH the ZIP and the agent, because the row is
dense enough that "are you sure?" would leave somebody checking which chip they
had actually hit. Styled ordinary rather than destructive — re-adding is one
form away; the cost is an afternoon, not a record.

### Trucks: the validation, and a reversed comment

Editing name, capacity and reserve during an active shift **already worked** —
only deactivation was blocked. What was missing was the guard, and adding it
**reverses a documented decision**, which is worth stating plainly.

`updateTruck`'s header said capacity could be cut below what was aboard,
because the number is being corrected and refusing would not unload the van.
That is true, and nothing breaks — `bookableSpaces` floors at zero, so the van
simply stops being offered. **That silence is the problem.** On a truck with an
open shift, the overwhelmingly likelier cause of "capacity 5" on a van that
holds 15 is a typo, and the consequence of accepting it is a driver vanishing
from every customer's shortlist for the rest of their shift with nothing
anywhere saying why.

So bookable capacity may not fall below the shift's committed bag load, and the
refusal names the numbers: _"Van Live has 4 bags committed on its open shift,
and 6 capacity minus 5 reserved leaves only 1."_ **The correction is deferred,
not lost** — the rule applies only while a shift is open, and that escape is in
the message. The form says the constraint before it is hit, so an operator does
not have to be refused to learn it. Deactivation stays blocked outright: that
one has no safe degradation at all.

### Staff: grouped, filtered, and carrying a workload

Grouped by role, because they are two lists that happened to share a table — an
agent is somebody you dispatch, an admin is somebody with console access, and
sorted by `createdAt` the roster interleaved them.

Two filters, in the URL like the bookings board, and **deliberately different
shapes**: active/everyone is a segmented control (two views of one list),
"can drive" is a checkbox (an additional narrowing). A third tab reading "can
drive" would imply it were exclusive with the other two. Default is active
only, with a "Showing 12 of 16" beside it so the default never hides anything
silently.

**Workload counted BY BOOKING, not by task.** In v1 one person holds both the
verification and the pickup task for the same trip, so counting tasks reports
six jobs for three addresses — and that number beside somebody's name is worse
than no number. Derived on every read; no counter column, no `staff_stats`
table, per the standing rule. The in-progress booking is a link, because "who
is on what right now" is always followed by "show me".

### Booking list: the search grew a debounce

Filters already applied immediately. The search was submit-on-enter, and the
note here argued for it: an operator types an identifier they already have, and
a query per keystroke would fire ten searches to find one booking. That
objection is right and is now answered by **300 ms + a three-character
minimum** rather than by the Enter key — which had its own cost, since nothing
on screen said Enter was required and a half-typed ref sat there returning the
unfiltered board.

Under the minimum is "no search", not "search for two characters", so
backspacing restores the full board. Enter still works and skips the wait.

Written with **no state for the term**: the obvious version holds the text in
`useState` and re-seeds it from the URL in an effect, which sets state inside
an effect (a cascading render the lint rule correctly refuses). The input holds
its own text, `key={search}` re-seeds it by remounting, and every read is
`event.target.value` — a handler reading a captured value here would search for
the previous keystroke, which this codebase has already paid for once.

### Booking detail: three cards became one story, and one deviation

- **Details & payments** are one card. Two cards put a rule between "what was
  bought" and "what was paid for it", and an operator checking a refund reads
  both or neither.
- **Verify & seal** is the identity gate and the seals together, with the
  assigned agent named at the top as a FACT. Reading the seals without the gate
  is how somebody concludes a bag was sealed properly when the gate that
  permits sealing had not passed.
- **Assignment** absorbs the pickup run: one question asked twice, and the two
  gates that answer it close at different moments — precisely what an operator
  needs side by side.

**The deviation:** the brief asked for Assignment to join the visit's record on
the left. It stays in the act column. The page's own arrangement is
read-left / act-right, and the visit's record is reading while reassigning is
acting. What the left card gained instead is the agent's name, so the visit
reads as one story without the forms following it there.

### Profile parity: one prop, and it was never passed

The customer's profile has used `AvatarUploader`'s `overlay` layout — the
picker ON the photo — since it was built. The agent's account page and the
admin's settings sheet used the default `row` layout, which renders a "Change
photo" button and a bare "Remove" link beside the avatar. Same component, two
different controls for one action, purely because nobody had passed the prop.
Both now match, `allowRemove={false}` included: replacing a photo is the action
either app offers, and a Remove link that appears beside one somebody just
added invites an undo nobody asked for.

### Verified

| Check                                         | Result                                                                                                                                                                                                                                  |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm format:check` / `typecheck` / `lint`    | clean, 6/6, 6/6                                                                                                                                                                                                                         |
| `pnpm turbo test`                             | 1,042 passed, 1 skipped                                                                                                                                                                                                                 |
| `pnpm --filter @koolee/core test:integration` | 379 passed, 3 skipped (+13: 7 truck-capacity, 6 workload)                                                                                                                                                                               |
| `pnpm turbo build`                            | 3/3                                                                                                                                                                                                                                     |
| Browser (admin, headed)                       | Roster groups as "Agents · 8 / Admins · 4", the tabs move the URL to `?show=all` and the count to 16 of 16; the booking detail renders "Details & payments", "Verify & seal" naming the agent, and Assignment with Pickup run inside it |

---

## Phase 6 — Close-out

### Docs updated

- **`docs/CODEBASE-MAP.md`** — three new sections in Chapter 6: cancelling and
  who did it (the three gates, and why `by` reads the actor's role), the map
  (the worker, and the rule that an app mounting `LiveMap` must run the copy
  script), and choosing a driver (pick-the-best, and why the shortlist polls
  rather than listens).
- **`docs/LAUNCH-CHECKLIST.md`** — the map's "no key, no account" line now also
  says **nothing to set in Vercel** and names the build step instead, plus a new
  **D10** on the cancellation wording (below).
- **`PROJECT-STATUS.md`** — rows 121–126 and a new snapshot entry.
- **`.env.example`** — the Google Maps block says outright that there is no map
  variable to set, and points at the copy script for a blank map.

### D10: the agreement does not contradict the cancel policy

Worth stating precisely, because the brief asked for a mismatch check. The
agreement's only cancellation sentence is:

> Your card is authorized when you book and charged once your bags have been
> collected and sealed. **Cancellation terms are shown when you cancel.**

It makes no promise about _when_ cancelling is free. It promises the terms
appear **at the moment of cancelling** — so the confirmation dialog is now the
thing keeping that promise, and its copy is load-bearing rather than
decorative. Two questions for counsel, recorded as D10: whether that sentence
is the whole of the terms we intend to be bound by, and whether the agreement
should state the rule outright rather than deferring to a dialog. Changing the
dialog is a code change; changing the agreement is a new published version, and
versions pin per booking.

### Deviations from the brief, all deliberate

| Brief                                                       | What shipped                                                                 | Why                                                                                                                                                                                     |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Wire the map style as a documented `NEXT_PUBLIC_` env"     | No env at all                                                                | The cause was not configuration. A variable would have been ceremony around a bug.                                                                                                      |
| "Make the failure message state the ACTUAL problem"         | Copy unchanged; `data-map-failure` + a console line added                    | Written assuming a configuration cause. "Worker script missing" is true, is our problem, and is not admissible under the copy rules to somebody waiting on their bags.                  |
| Customer's live location dot on the driver map              | Not built; the geolocate control was built and then removed                  | TD's reasoning, better than the requirement: the pickup address is the anchor. Booking for a friend shows an irrelevant dot that looks meaningful, and it spends a one-shot permission. |
| The driver list "below/behind a toggle"                     | Behind a toggle, after first shipping it below                               | TD reversed it mid-build. Stacked gave the map a third of a phone screen and put the cards below the fold.                                                                              |
| Booking detail: merge Assignment into "Verify & seal"       | Assignment stays in the act column; the visit card names the agent as a fact | The page is read-left / act-right. The visit's record is reading; reassigning is acting.                                                                                                |
| Trucks: capacity may fall below the load (existing comment) | It may not, while a shift is open                                            | Reversed with reasoning in place — the silent version turns a typo into a driver vanishing from every shortlist for a day.                                                              |

### Deferred, and named

- **The shortlist on the real trip page has never been seen in a browser.** No
  local booking has two candidates with reported positions, so the map inside
  that card and the pick-the-best row were exercised only through Storybook and
  the unit tier. TD's post-merge pass covers it.
- **`DriverChoice` cannot be storied** in this Storybook: `@storybook/react-vite`
  with no Next adapter, and the component uses `useRouter` and imports a server
  action. Making it renderable is framework work. `SegmentedControl` was lifted
  into `packages/ui` with a story instead, which covers the control that
  carries the new branching and removes a real duplication.
- **Widening `recordDriverPosition`'s signal scope** — declined, with the fan-out
  cost written where the constant is.

### TD's manual items

- **Ratify** D1 (cancel policy), D2 (draft reset), D3 (pick-the-best).
- **Nothing to set in Vercel.** No map variable exists.
- **Legal pass on D10** — the cancellation wording against the agreement.
- **Browser pass after merge on dev:** cancel a booking as a customer; open its
  agent task; the driver shortlist with two positioned drivers (map, toggle,
  pick-the-best); the tracking map.

### Final gate

| Check                                         | Result                          |
| --------------------------------------------- | ------------------------------- |
| `pnpm format:check`                           | clean                           |
| `pnpm turbo typecheck`                        | 6/6                             |
| `pnpm turbo lint`                             | 6/6                             |
| `pnpm turbo test`                             | 1,042 passed, 1 skipped         |
| `pnpm --filter @koolee/core test:integration` | 379 passed, 3 skipped, 32 files |
| `pnpm turbo build`                            | 3/3                             |
| `pnpm db:status`                              | see below                       |

Nothing is pushed and no PR is open. CI has not run on the branch — the
workflow needs a GitHub runner, so its first green will be on the PR.

**Databases touched: LOCAL ONLY**, throughout, and no migration was written.

---

## Found while writing the testing steps: the shortlist drew stale pins

Verifying what TD would actually see turned up a real one, and it is a
consequence of the change this slice made rather than something that was always
broken.

`getSelectedDriver` has asked "is this fix fresh?" since the map shipped.
**`listCandidateDrivers` never did** — it read `driver_positions` raw. That was
survivable while the pins were a nicety beside a list somebody actually chose
from. In Phase 2 the map BECAME the chooser, so a pin is now a claim about
where a van is.

`recordDriverPosition` overwrites **one mutable row per driver and keeps no
history**, so a driver who finished a run yesterday still has yesterday's
coordinates on file. The shortlist drew them on a street they left hours ago
with exactly the confidence of a live one — the precise failure `POSITION_FRESH_MS`
was written to prevent, on the one surface that had never consulted it.

**The ETA went with it, and that half matters more.** A pin on the wrong street
is misleading; "about 15 min" computed from that street is the number
`bestCandidate` ranks on, so "pick the best for me" could have chosen on a
day-old position. `freshPosition` is now the single answer to "where is this
driver", used by both the pin and the estimate, so the map and the ETA cannot
disagree.

A driver with no fresh fix keeps their **card** and simply has no pin — they
are perfectly choosable, and the list is the view that says so.

### The related gap, NOT fixed, and it is a product decision

**Drivers do not report a position while they are idle on shift.** `GpsPinger`
runs only when a pickup task is `in_progress`, so a driver who has clocked on
and is waiting for work pings nobody. Combined with the freshness window above,
that means **a candidate driver usually has no pin at all** — the shortlist map
will often show the pickup pin and nothing else, and will not render at all
when no candidate has a fresh fix.

Left alone deliberately, because the fix is not a code change so much as a
choice with two real costs:

- **Battery.** A foreground ping every 20–45 seconds for an entire shift, on a
  device a driver needs all day, for a map that is only being watched while
  somebody is mid-selection.
- **Privacy.** Tracking somebody continuously because they are clocked on is a
  different proposition from tracking them while they are carrying a customer's
  bags, and it is the sort of thing that belongs in a staff policy rather than
  in a commit.

Three options, if TD wants the shortlist map populated:

1. **Ping while on shift, at the slow cadence** (45s). Simple; the costs above.
2. **Ping only while a shortlist is open on this driver** — needs a signal back
   to the agent app that does not exist today.
3. **Leave it.** The list view is complete and always works, the toggle makes
   it one tap, and the map fills in the moment a driver is genuinely en route.

**My recommendation is (1) at the slow cadence**, gated on an explicit
staff-facing sentence about when location is shared — it is the difference
between a map-first chooser that usually has something on it and one that
usually does not. But it is TD's call, not mine.
