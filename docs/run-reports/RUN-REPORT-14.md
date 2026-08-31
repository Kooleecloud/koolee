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
