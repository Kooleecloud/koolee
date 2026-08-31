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
