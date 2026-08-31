# Tier 5 pre-flight — launch-readiness inventory

**Run date:** 2026-08-30
**Read at:** branch `dev` @ `728bcea` (merge of PR #33, `feat/f3-push-and-dispatch-timing`).
Working tree carries three modified files, all generated: `apps/{web,admin,agent}/next-env.d.ts`
(`git status -sb`). No commits, no migrations, no code changes.
**Databases touched: NONE.** Not local, not `koolee_test`, not hosted. The one
ALLOWED CHECK (`db:status` against staging) was **skipped** — see §4.2 for why
and for what replaces it.

Every claim below names a `file:line` or the exact command that produced it.
Where something does not exist, it says **does not exist** rather than inferring.
§6 is the only section that contains judgement, and it is labelled as such.

---

## Headline for the Tier 5 design conversation

| #   | Fact                                                                                                                                                                                                                                                                                                | Where            |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | The ETA seam is **fully wired and injectable, but nothing injects**. All three apps call `createRuntime` without `eta`/`etaEstimator`, so every environment runs `HaversineEtaEstimator`. A Routes-API adapter is a new class + one key passed at `apps/*/src/lib/core.ts`. Zero call sites change. | §1.1, §1.2       |
| 2   | `ensureAddress` returns an existing address row **before** it ever looks at coordinates. Once Places autocomplete ships, every address a customer has used before keeps its ZIP-centroid point forever.                                                                                             | §1.4, §6.3       |
| 3   | `distanceKm` is the literal `20` at **four** funnel call sites, while the marketing estimator uses real per-airport distances (JFK 26 / LGA 13 / EWR 19). The public quote and the funnel quote already disagree by up to $2.70.                                                                    | §1.5, §6.4       |
| 4   | Sentry is **env-schema-only** in all three apps. No SDK dependency, no `instrumentation.ts`, no `global-error.tsx`, no `NEXT_PUBLIC_SENTRY_DSN`, and `SENTRY_DSN` is never read by anything but the dev status panel.                                                                               | §2.1, §2.5, §2.6 |
| 5   | `pnpm seed` **overwrites** all 128 airline-cutoff rows back to the placeholder 45/60 minutes and rewrites the active pricing rule to hardcoded launch-v1 numbers. Running it after ops has verified real cutoffs silently undoes that work.                                                         | §3.2, §3.3, §6.6 |
| 6   | Production is `NEXT_PUBLIC_LAUNCH_MODE=coming_soon`, which **exempts `apps/web` from five boot gates at once**. Flipping to `live` arms them all in one deploy; any one missing var refuses the boot.                                                                                               | §2.4, §6.7       |
| 7   | Three doc contradictions found, all launch-relevant: Turnstile subdomain coverage, the ETA/cutoff-monitor claim, and admin exception emission.                                                                                                                                                      | §4.6             |

---

# 1. ETA + geo surfaces (Maps integration targets)

## 1.1 `EtaEstimator` — the interface and the factory

The whole seam is five files under [packages/core/src/geo/](../../packages/core/src/geo/).

| Symbol                                            | Location                                                           |
| ------------------------------------------------- | ------------------------------------------------------------------ |
| `EtaRange { minMinutes, maxMinutes }`             | [eta.ts:18-21](../../packages/core/src/geo/eta.ts#L18-L21)         |
| `EtaQuery { from: Coordinates, to: Coordinates }` | [eta.ts:23-26](../../packages/core/src/geo/eta.ts#L23-L26)         |
| `EtaEstimator { estimate(query): EtaRange }`      | [eta.ts:28-30](../../packages/core/src/geo/eta.ts#L28-L30)         |
| `HaversineEtaEstimator` — the only implementation | [eta.ts:57-83](../../packages/core/src/geo/eta.ts#L57-L83)         |
| `formatEtaRange(eta \| null): string`             | [eta.ts:86-89](../../packages/core/src/geo/eta.ts#L86-L89)         |
| `EtaEstimatorConfig = { kind: "haversine" }`      | [factory.ts:16](../../packages/core/src/geo/factory.ts#L16)        |
| `createEtaEstimator(config)`                      | [factory.ts:18-20](../../packages/core/src/geo/factory.ts#L18-L20) |
| Public barrel                                     | [index.ts:1-9](../../packages/core/src/geo/index.ts)               |

**`estimate` is SYNCHRONOUS.** `EtaEstimator.estimate` returns `EtaRange`, not
`Promise<EtaRange>` ([eta.ts:29](../../packages/core/src/geo/eta.ts#L29)). A
Routes API is a network call. Every one of the five consumers in §1.2 calls it
without `await`. **This is the single largest structural change Tier 5's ETA
work requires**, and it is a change to the interface, not to an implementation.

### Factory selection logic, as it stands

`createEtaEstimator` ignores its argument entirely and returns
`new HaversineEtaEstimator()` ([factory.ts:18-20](../../packages/core/src/geo/factory.ts#L18-L20)).
The union has one member. The header states the intended landing shape for a
credentialled provider: _"a credentialled provider would arrive as an
`etaEstimator` INSTANCE passed to `createRuntime`, the way the Inngest emitter
does, because keys are environment and core reads none"_
([factory.ts:8-12](../../packages/core/src/geo/factory.ts#L8-L12)).

### Injection points

`CoreConfig.etaEstimator` is required ([config.ts:131](../../packages/core/src/config.ts#L131));
`CoreConfigInput.etaEstimator` is optional ([config.ts:146](../../packages/core/src/config.ts#L146));
the default is filled at [config.ts:164](../../packages/core/src/config.ts#L164).
`RuntimeOptions` accepts BOTH forms — declarative `eta?: EtaEstimatorConfig`
and instance `etaEstimator?: EtaEstimator`
([runtime.ts:68-69](../../packages/core/src/runtime.ts#L68-L69)), resolved with
instance-wins precedence at [runtime.ts:104-107](../../packages/core/src/runtime.ts#L104-L107).

**No app passes either.** Verified by reading all three runtime builders in full:

- [apps/web/src/lib/core.ts:141-152](../../apps/web/src/lib/core.ts#L141-L152) (`getCore`) and `:160-168` (`tryGetCore`)
- [apps/admin/src/lib/core.ts:83-93](../../apps/admin/src/lib/core.ts#L83-L93) and `:97-104`
- [apps/agent/src/lib/core.ts:48-57](../../apps/agent/src/lib/core.ts#L48-L57) and `:61-67`

None of the six calls carries an `eta` or `etaEstimator` key. Every environment
— local, preview, production — therefore runs `HaversineEtaEstimator`.

## 1.2 Every consumer of the estimator

Repo-wide grep over `apps/` + `packages/` excluding `node_modules`, `.next` and
`packages/core/src/geo/` itself:

| #   | Consumer                                            | Call site                                                                                             | Uses                           |
| --- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------ |
| 1   | `toCandidate` — the customer's driver shortlist     | [driver-selection.ts:265](../../packages/core/src/services/driver-selection.ts#L265)                  | full `EtaRange`, may be `null` |
| 2   | `selectDriver` — the ETA captured at selection      | [driver-selection.ts:420-423](../../packages/core/src/services/driver-selection.ts#L420-L423)         | full `EtaRange`                |
| 3   | Customer trip page — the selected driver's live ETA | [trips/[bookingId]/page.tsx:252-258](../../apps/web/src/app/trips/%5BbookingId%5D/page.tsx#L252-L258) | full `EtaRange`                |
| 4   | `cutoffRiskMonitor` — the alert                     | [jobs/functions.ts:542-546](../../packages/core/src/jobs/functions.ts#L542-L546)                      | **`maxMinutes` only**          |
| 5   | `haversineKm` direct — the "3.2 km away" label      | [trips/[bookingId]/page.tsx:262-265](../../apps/web/src/app/trips/%5BbookingId%5D/page.tsx#L262-L265) | distance, not ETA              |

`toCoordinates` (the null-narrowing helper,
[coordinates.ts:19-26](../../packages/core/src/geo/coordinates.ts#L19-L26)) has
five call sites: `driver-selection.ts` at `197`, `252`, `419`, `568`, and
`jobs/functions.ts` at `540-541`.

**There is no ETA surface in `apps/admin` or `apps/agent`.** Grep for
`eta|Eta|ETA` across both apps' `src/` returns exactly one hit, a comment in
[apps/agent/src/components/shift/gps-pinger.tsx:15](../../apps/agent/src/components/shift/gps-pinger.tsx#L15).

## 1.3 The haversine constants, and what breaks if min/max semantics change

Constants, all `static readonly` on the class
([eta.ts:58-62](../../packages/core/src/geo/eta.ts#L58-L62)):

| Constant            | Value | Stated reason ([eta.ts:36-55](../../packages/core/src/geo/eta.ts#L36-L55)) |
| ------------------- | ----- | -------------------------------------------------------------------------- |
| `ROAD_FACTOR`       | `1.5` | circuity factor for a dense grid with water crossings                      |
| `AVERAGE_SPEED_KMH` | `18`  | NYC surface-street average; **no notion of a highway**                     |
| `FLOOR_MINUTES`     | `5`   | nobody is anywhere in under five minutes                                   |
| `SPREAD`            | `0.3` | ±30%, then widened out to 5-minute steps                                   |
| `STEP_MINUTES`      | `5`   | rounding granularity                                                       |

`EARTH_RADIUS_KM = 6371.0088` at [coordinates.ts:28](../../packages/core/src/geo/coordinates.ts#L28);
the great-circle formula at [coordinates.ts:40-50](../../packages/core/src/geo/coordinates.ts#L40-L50).

**The known bias is deliberate and pinned by a test.**
`eta.test.ts` asserts `estimate(Midtown → JFK) === { minMinutes: 75, maxMinutes: 145 }`
([eta.test.ts:116-119](../../packages/core/src/geo/eta.test.ts#L116-L119)) against a real
~50-minute drive, with the reasoning written above it: the customer card only
ever shows a short in-zone hop, and `cutoffRiskMonitor` wants pessimism because
it makes the alert fire early.

### What breaks if min/max semantics change

Six assertions and three render paths depend on the current contract:

1. **`maxMinutes > minMinutes`, always** — `eta.test.ts:73-78`. A provider
   returning a point estimate must still widen, or this fails.
2. **Both ends are multiples of 5** — `eta.test.ts:80-86`. A Routes API's
   `duration` in seconds will not be.
3. **The range brackets the raw estimate** — `eta.test.ts:128-136`. This test
   reaches directly into `HaversineEtaEstimator.ROAD_FACTOR` and
   `.AVERAGE_SPEED_KMH`, so it is implementation-coupled and does not
   generalise to a second implementation.
4. **Monotonicity** — `eta.test.ts:121-126`.
5. **`formatEtaRange(null) === "ETA on the way"`** — `eta.test.ts:150-152`.
6. **`estimate({from: X, to: X})` floors at 5–10 min** — `eta.test.ts:66-71`.

Render paths:

- `DriverCandidateView.etaLabel` is **preformatted server-side** by
  `formatEtaRange` before it crosses to the client
  ([page.tsx:242](../../apps/web/src/app/trips/%5BbookingId%5D/page.tsx#L242),
  consumed at [trip-driver.tsx:135](../../apps/web/src/components/trip-driver.tsx#L135)).
  A `hasEta` boolean rides alongside and only drives a `Badge` variant
  ([trip-driver.tsx:134](../../apps/web/src/components/trip-driver.tsx#L134)) — the
  client never sees the numbers.
- `SelectedDriverView.etaLabel` — same shape, rendered at
  [trip-driver.tsx:225](../../apps/web/src/components/trip-driver.tsx#L225).
- `cutoffRiskMonitor` takes **only `maxMinutes`**
  ([functions.ts:544](../../packages/core/src/jobs/functions.ts#L544)) and
  subtracts it from the cutoff. It also reports `driveSource: "estimator" | "configured_default"`
  in the alert detail ([functions.ts:558-561](../../packages/core/src/jobs/functions.ts#L558-L561)),
  which is the field to extend when a provider lands.

**Consequence:** narrowing the range (which a real routing provider would do)
makes `cutoffRiskMonitor` alert LATER, because it consumes the pessimistic end.
That is a behaviour change in the unsafe direction and needs a decision, not a
default.

## 1.4 Address coordinates today

### Schema

`addresses.lat` / `addresses.lng` are nullable `doublePrecision`, and
`addresses.place_id` is a nullable `text` column already commented
_"Google Places ID, when the address came from autocomplete"_
([identity.ts:66-69](../../packages/db/src/schema/identity.ts#L66-L69)).
Indexes: `addresses_user_id_idx`, `addresses_zip_idx` — **no spatial index**.

`airports.lat`/`lng` are **NOT NULL** with range CHECKs
([airports.ts:40-41, 51-52](../../packages/db/src/schema/airports.ts#L40-L52)).

`zip_centroids` is `zip varchar(5)` PK + `lat`/`lng` NOT NULL, with two range
CHECKs against a transposed import
([geo.ts:24-37](../../packages/db/src/schema/geo.ts#L24-L37)).

### The one writer

`ensureAddress` ([customers.ts:277-329](../../packages/core/src/services/customers.ts#L277-L329)):

```
277  export async function ensureAddress(db, userId, input)
281    const zip = assertInCoverage(input.zip)
283-296 SELECT … WHERE user_id = ? AND line1 = ? AND zip = ?     ← dedupe
297    if (found) return found;                                  ← EARLY RETURN
299    let lat = input.lat ?? null; let lng = input.lng ?? null
300-310  if either is null → SELECT lat,lng FROM zip_centroids WHERE zip = left(zip,5)
312-326  INSERT … (lat, lng, place_id: input.placeId ?? null)
```

The header already documents the intended autocomplete landing:
_"A caller that DOES supply coordinates always wins, so the day autocomplete
ships this becomes the fallback with no change here"_
([customers.ts:270-272](../../packages/core/src/services/customers.ts#L270-L272)).

**That claim is true only for a NEW address.** Line 297 returns the existing row
before line 299 is reached, so a repeat address never gains coordinates. See §6.3.

### Production callers

`ensureAddress` has exactly **one** non-test caller:
[apps/web/src/lib/checkout.ts:100-106](../../apps/web/src/lib/checkout.ts#L100-L106).
It passes `line1`, `line2?`, `city`, `state`, `zip` — and **no `lat`, `lng` or
`placeId`**. Everything else in the grep (18 files) is `*.integration.test.ts`.

There is a second address-writing module,
[packages/core/src/services/addresses.ts](../../packages/core/src/services/addresses.ts)
(`assertInCoverage` at lines 50 and 75) — the saved-address CRUD for
`/dashboard`. It is a separate path from the funnel's.

### Readers of address coordinates

| Reader                                    | Line                                                                                          | What it does with them                                |
| ----------------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `loadSelectionContext` (driver selection) | [driver-selection.ts:184-197](../../packages/core/src/services/driver-selection.ts#L184-L197) | selects `addresses.lat/lng`, wraps in `toCoordinates` |
| Customer trip page                        | [page.tsx:253-266](../../apps/web/src/app/trips/%5BbookingId%5D/page.tsx#L253-L266)           | ETA + "N km away"                                     |
| `cutoffRiskMonitor`                       | [functions.ts:538-541](../../packages/core/src/jobs/functions.ts#L538-L541)                   | loads ALL addresses wholesale, maps by id             |

### `place_id` today

Written by nothing (`ensureAddress` line 324 passes `input.placeId ?? null`, and
no caller supplies it). Read by three surfaces, all of which build a Google Maps
deep link and all of which already handle its absence:

- [apps/agent/src/lib/job.ts:153-159](../../apps/agent/src/lib/job.ts#L153-L159) (`mapsUrl`)
- [apps/agent/src/app/tasks/[taskId]/page.tsx:104-106](../../apps/agent/src/app/tasks/%5BtaskId%5D/page.tsx#L104-L106)
- selected through core at [agent-visit.ts:230](../../packages/core/src/services/agent-visit.ts#L230),
  [pickup.ts:125](../../packages/core/src/services/pickup.ts#L125),
  [tasks.ts:159](../../packages/core/src/services/tasks.ts#L159)

So **the payoff for `place_id` is already built and waiting**: the moment
autocomplete writes one, every driver's map link stops being a free-text search.

### `zip_centroids` coverage

- **837 rows** — `grep -c '^  { zip:' packages/db/src/zip-centroids.ts` → `837`.
- Source: US Census 2023 National ZCTA Gazetteer, prefixes 100–119 (NY) and
  070–079 (NJ), plus one hand-entered row for `10281`
  ([zip-centroids.ts:1-39](../../packages/db/src/zip-centroids.ts#L1-L39)).
- Loaded into the table by the seed
  ([seed.ts:226-236](../../packages/db/src/seed.ts#L226-L236), 200-row chunks,
  `onConflictDoUpdate` on lat/lng) and by migration
  [0028_geo_zip_centroids.sql:66](../../packages/db/drizzle/0028_geo_zip_centroids.sql#L66)
  as a snapshot, so the same migration's address backfill (line 944) has
  something to join against.
- **Runtime reads the TABLE, not the file** — `ensureAddress` queries
  `zip_centroids` ([customers.ts:302-306](../../packages/core/src/services/customers.ts#L302-L306)).
  The TS module is used only by the seed and by tests.
- A guard test asserts every coverage ZIP has a centroid and that the dataset is
  strictly larger than coverage
  ([zip-centroids.test.ts:18-25](../../packages/core/src/geo/zip-centroids.test.ts#L18-L25)).

## 1.5 The funnel address step — where autocomplete mounts

### The step

`/book/address` is **retired**: it is a three-line `redirect("/book/pickup")`
([address/page.tsx:7-9](../../apps/web/src/app/book/address/page.tsx#L7-L9)).
`AddressStepForm` ([address-step-form.tsx](../../apps/web/src/components/address-step-form.tsx))
still exists and still points its retry link at `/book/address` (line 27) — it is
**dead code**; nothing imports it (grep for `AddressStepForm` finds only its own file).

The live step is **`/book/pickup`** (address + bags, one submit):

- Page: [apps/web/src/app/book/pickup/page.tsx](../../apps/web/src/app/book/pickup/page.tsx) — reads the draft, loads saved addresses for a signed-in customer, renders the form.
- Form: [apps/web/src/components/pickup-step-form.tsx](../../apps/web/src/components/pickup-step-form.tsx)
- Action: `submitPickup` at [apps/web/src/app/book/actions.ts:326-395](../../apps/web/src/app/book/actions.ts#L326-L395)

### The fields, exactly as they are

Five inputs, **all controlled** through a single `address` state object
([pickup-step-form.tsx:61-79](../../apps/web/src/components/pickup-step-form.tsx#L61-L79)):

| Field                  | `name`  | Line    | `autoComplete`   | Required                   |
| ---------------------- | ------- | ------- | ---------------- | -------------------------- |
| Street address         | `line1` | 140-147 | `address-line1`  | yes                        |
| Apartment/floor/buzzer | `line2` | 154-160 | `address-line2`  | no                         |
| City                   | `city`  | 166-172 | `address-level2` | yes                        |
| State                  | `state` | 177-186 | `address-level1` | yes, `maxLength=2`         |
| ZIP                    | `zip`   | 190-199 | `postal-code`    | yes, `inputMode="numeric"` |

**The mount point is already marked.** Immediately after the `line1` input:

```tsx
148  {/* TODO(maps): Google Places autocomplete, which also gives us the
149      lat/lng and place_id the drive-time estimate needs. */}
```

— [pickup-step-form.tsx:148-149](../../apps/web/src/components/pickup-step-form.tsx#L148-L149)

Saved addresses fill the same controlled state on one tap
([lines 104-113](../../apps/web/src/components/pickup-step-form.tsx#L104-L113)),
and `SavedAddressOption` carries **no coordinates**
([lines 24-32](../../apps/web/src/components/pickup-step-form.tsx#L24-L32)) — the
page maps only id/label/line1/line2/city/state/zip
([pickup/page.tsx:41-49](../../apps/web/src/app/book/pickup/page.tsx#L41-L49)).

### Validation, in order (`submitPickup`)

1. `line1 && city && state && zip` all non-empty — else `"Fill in street, city, state, and ZIP."` (lines 338-340)
2. `bagCount` integer 1–10 (lines 341-343)
3. `checkCoverage(zip)` → `malformed` gives `"That ZIP code does not look right."`; `out_of_area` returns `outOfCoverageZip`, which swaps the whole form for `OutOfAreaCapture` (lines 345-353, and [pickup-step-form.tsx:72-74](../../apps/web/src/components/pickup-step-form.tsx#L72-L74))
4. **The ZIP-sync reconciliation** (lines 355-374)
5. `writeDraft` + `syncDraftRow` + `redirect(nextIncompleteStep(next))` (lines 376-393)

### The priced-ZIP guard — what autocomplete must satisfy

Three touchpoints, in order of severity:

**(a) The step-level reconciliation.** `quotedZip = draft.quotedZip ?? draft.zip`
([actions.ts:370](../../apps/web/src/app/book/actions.ts#L370)); if the address ZIP
differs and `confirmZipChange !== "1"`, the action returns
`{ zipMismatch: { quotedZip, addressZip } }`
([actions.ts:371-374](../../apps/web/src/app/book/actions.ts#L371-L374)) and the form
renders a two-button panel: _"Update quote to N"_ (resubmits with
`confirmZipChange=1`) or _"Use a different address"_
([pickup-step-form.tsx:226-252](../../apps/web/src/components/pickup-step-form.tsx#L226-L252)).
Confirming **also clears the chosen pickup window**
([actions.ts:387-389](../../apps/web/src/app/book/actions.ts#L387-L389)), because the
window's lead-time price and drive-time headroom were derived from the old location.

**(b) The hard guard in core.** `createBooking` takes a **required** `quotedZip`
([create-booking.ts:101](../../packages/core/src/services/create-booking.ts#L101)) and
throws `QuoteZipMismatchError` when it disagrees with the address's ZIP
([create-booking.ts:177-179](../../packages/core/src/services/create-booking.ts#L177-L179)),
after `assertInCoverage` (line 173). Coverage alone is explicitly not enough.

**(c) The draft schema.** `quotedZip` is its own optional field
([booking-draft-schema.ts:151](../../apps/web/src/lib/booking-draft-schema.ts#L151)),
documented as _"which ZIP were you quoted?" has no answer once one value has
overwritten the other_.

**Therefore, for Tier 5 autocomplete:** a selected suggestion must write
`line1/line2/city/state/zip` **through `setAddress`** (the inputs are controlled;
writing to the DOM would be discarded), and the ZIP it writes will be compared
against `draft.quotedZip` on submit like any typed ZIP. Nothing new is needed to
make the guard hold — but see §6.2 for the interaction that gets worse.

**Coordinates have nowhere to travel today.** The draft cookie schema
([booking-draft-schema.ts:135-139](../../apps/web/src/lib/booking-draft-schema.ts#L135-L139))
has `line1/line2/city/state/zip` and **no `lat`, `lng` or `placeId`**. The
`booking_drafts` DB mirror is an opaque `jsonb` payload
([drafts.ts:28-31](../../packages/db/src/schema/drafts.ts#L28-L31)), so it needs no
migration — but the cookie schema, the `PayableDraft` pick in
[checkout.ts:45](../../apps/web/src/lib/checkout.ts#L45), and the `ensureAddress`
call at [checkout.ts:100-106](../../apps/web/src/lib/checkout.ts#L100-L106) all do.

## 1.6 `distanceKm` — the hardcoded 20

`PriceInput.distanceKm` ([pricing/engine.ts:97](../../packages/core/src/pricing/engine.ts#L97))
feeds `distanceCents = round(distanceMultiplier × distanceKm)`
([engine.ts:173](../../packages/core/src/pricing/engine.ts#L173)). The active rule's
`distanceMultiplier` is **45 cents/km** ([seed.ts:267](../../packages/db/src/seed.ts#L267)).

**Four funnel call sites pass the literal `20`, each marked `TODO(maps)`:**

| Call site                                         | Line                                                | Purpose                                        |
| ------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------- |
| `apps/web/src/lib/checkout.ts`                    | [127](../../apps/web/src/lib/checkout.ts#L127)      | the price the booking is actually written with |
| `apps/web/src/app/book/actions.ts` (`submitSlot`) | [432](../../apps/web/src/app/book/actions.ts#L432)  | window re-check                                |
| `apps/web/src/app/book/slot/page.tsx`             | [78](../../apps/web/src/app/book/slot/page.tsx#L78) | the window picker's prices                     |
| `apps/web/src/app/book/pay/page.tsx`              | [66](../../apps/web/src/app/book/pay/page.tsx#L66)  | the review page's quote                        |

**The marketing estimator does not.** It uses
`TYPICAL_DISTANCE_KM = { JFK: 26, LGA: 13, EWR: 19 }`
([pricing/actions.ts:30-34, 66](../../apps/web/src/app/%28marketing%29/pricing/actions.ts#L30-L34))
against a mirrored copy of the launch rule
([pricing/actions.ts:17-27](../../apps/web/src/app/%28marketing%29/pricing/actions.ts#L17-L27)),
with the comment _"keep in sync with the seed until a `getActivePricingRule` core
service exists"_. See §6.4.

`create-booking.ts:236` and `payment-intent.ts:109` pass `input.distanceKm`
straight through; `windows.ts:158` and `quote.ts:53` likewise. So a real distance
threaded from the funnel needs **no core change** — only the four literals.

## 1.7 Existing Google / Maps references and dead adapters

**No Maps SDK, no client, no adapter, dead or otherwise.** The complete inventory:

| Reference                                                      | Where                                                                                                                                                                                       | State                                                                               |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `GOOGLE_MAPS_API_KEY` in the env schema                        | [apps/web/src/env.ts:196, 263](../../apps/web/src/env.ts#L196), [apps/agent/src/env.ts:108, 139](../../apps/agent/src/env.ts#L108)                                                          | parsed, **never read** by any code path                                             |
| Its hint string                                                | [web/env.ts:309](../../apps/web/src/env.ts#L309), [agent/env.ts:159](../../apps/agent/src/env.ts#L159)                                                                                      | literally _"Stubbed in this scaffold."_                                             |
| Dev status panel row                                           | [web/env.ts:617-619](../../apps/web/src/env.ts#L617-L619), [agent/env.ts:279-283](../../apps/agent/src/env.ts#L279-L283)                                                                    | agent's `fallback` reads _"Route ETA uses a fixed estimate."_ — **stale**, see §4.6 |
| `.env.example` entries                                         | [apps/web/.env.example:105-107](../../apps/web/.env.example#L105-L107), [apps/agent/.env.example:60-63](../../apps/agent/.env.example#L60-L63), [.env.example:109](../../.env.example#L109) | commented, blank                                                                    |
| `mapsUrl()` — a plain `google.com/maps/search/?api=1` **link** | [apps/agent/src/lib/job.ts:153-159](../../apps/agent/src/lib/job.ts#L153-L159)                                                                                                              | live, needs no key                                                                  |
| The same link inline on the task page                          | [apps/agent/src/app/tasks/[taskId]/page.tsx:104-106](../../apps/agent/src/app/tasks/%5BtaskId%5D/page.tsx#L104-L106)                                                                        | live                                                                                |

**`apps/admin` does not read `GOOGLE_MAPS_API_KEY` at all** — it is absent from
[apps/admin/src/env.ts](../../apps/admin/src/env.ts).

`GOOGLE_MAPS_API_KEY` is listed in [docs/ENVIRONMENT.md §3](../ENVIRONMENT.md) as
`○ ○ —` (web, agent, admin) and **"Stubbed"**, and in §6.6 as one of four
_"shared read-only keys"_ exempt from the per-scope-row rule.

---

# 2. Error / ops visibility surfaces (Sentry targets)

## 2.1 `OpsAlerter` — the interface and its one implementation

```ts
84  export interface OpsAlerter {
85    alert(event: {
86      severity: "info" | "warning" | "critical";
87      title: string;
88      detail?: Record<string, unknown>;
89    }): Promise<void>;
90  }
```

— [notifications/notifier.ts:84-90](../../packages/core/src/notifications/notifier.ts#L84-L90)

`ConsoleOpsAlerter` ([notifier.ts:92-102](../../packages/core/src/notifications/notifier.ts#L92-L102))
maps severity onto `console.error` / `console.warn` / `console.log` with the
prefix `[ops:<severity>]`, and always resolves.

The intent is already written down:

```
107  * TODO(sentry): forward `critical` and `warning` to Sentry via SENTRY_DSN, and
108  * page on `critical`. A missed cutoff alert nobody sees is not an alert.
```

— [notifier.ts:107-108](../../packages/core/src/notifications/notifier.ts#L107-L108)

Wiring: required on `CoreConfig` ([config.ts:120](../../packages/core/src/config.ts#L120)),
optional on input ([config.ts:144](../../packages/core/src/config.ts#L144)), defaulted at
[config.ts:161](../../packages/core/src/config.ts#L161), and passed through
`RuntimeOptions.opsAlerter` ([runtime.ts:62](../../packages/core/src/runtime.ts#L62),
resolved at [runtime.ts:103](../../packages/core/src/runtime.ts#L103)).

**No app passes an `opsAlerter`** — same six `createRuntime`/`tryCreateRuntime`
calls as §1.1. Every environment runs `ConsoleOpsAlerter`. **There is no
`SentryOpsAlerter` and no other implementation anywhere in the repo.**

## 2.2 Every `opsAlerter.alert` call site, with severity

**17 call sites: 12 in jobs, 5 in services.**

### In `packages/core/src/jobs/functions.ts`

| Line                                                    | Severity                                             | Title shape                             | Function                   |
| ------------------------------------------------------- | ---------------------------------------------------- | --------------------------------------- | -------------------------- |
| [223](../../packages/core/src/jobs/functions.ts#L223)   | `warning`                                            | Confirmation email failed for booking … | `bookingConfirmationEmail` |
| [336](../../packages/core/src/jobs/functions.ts#L336)   | `warning`                                            | Reminder email failed …                 | `pickupReminder`           |
| [394](../../packages/core/src/jobs/functions.ts#L394)   | **`critical`**                                       | Exception email failed …                | `exceptionOpsAlertEmail`   |
| [576](../../packages/core/src/jobs/functions.ts#L576)   | `critical` if `minutesRemaining < 0`, else `warning` | Booking … at risk of missing bag drop   | `cutoffRiskMonitor`        |
| [635](../../packages/core/src/jobs/functions.ts#L635)   | **`critical`**                                       | No agent check-in for booking …         | `agentNoShowCheck`         |
| [737](../../packages/core/src/jobs/functions.ts#L737)   | `warning`                                            | Driver-selected email failed …          | `driverSelectedEmail`      |
| [852](../../packages/core/src/jobs/functions.ts#L852)   | `warning`                                            | Bag-drop delivered email failed …       | `bagdropDeliveredEmail`    |
| [924](../../packages/core/src/jobs/functions.ts#L924)   | `warning`                                            | No driver available for booking …       | `driverPoolEmptyOpsAlert`  |
| [956](../../packages/core/src/jobs/functions.ts#L956)   | **`critical`**                                       | No-driver alert email failed …          | `driverPoolEmptyOpsAlert`  |
| [1079](../../packages/core/src/jobs/functions.ts#L1079) | `warning`                                            | Agent-assigned email failed …           | `agentAssignedEmail`       |
| [1225](../../packages/core/src/jobs/functions.ts#L1225) | `warning`                                            | Bags-sealed email failed …              | `bagsSealedEmail`          |
| [1331](../../packages/core/src/jobs/functions.ts#L1331) | `warning`                                            | Customer exception email failed …       | `exceptionCustomerEmail`   |

### In `packages/core/src/services/`

| Line                                                                                   | Severity       | Title shape                                         |
| -------------------------------------------------------------------------------------- | -------------- | --------------------------------------------------- |
| [agent-visit.ts:612](../../packages/core/src/services/agent-visit.ts#L612)             | `warning`      | Visit exception on booking …                        |
| [payment-lifecycle.ts:99](../../packages/core/src/services/payment-lifecycle.ts#L99)   | **`critical`** | Payment capture failed for booking …                |
| [payment-lifecycle.ts:313](../../packages/core/src/services/payment-lifecycle.ts#L313) | **`critical`** | Refund/void failed for cancelled booking …          |
| [pickup.ts:378](../../packages/core/src/services/pickup.ts#L378)                       | `warning`      | Seal … presented on booking … does not belong to it |
| [pickup.ts:564](../../packages/core/src/services/pickup.ts#L564)                       | `warning`      | Pickup exception on booking …                       |

### Two semantics a Sentry adapter must honour

1. **`severity: "info"` is never used.** All 17 sites are `warning` or `critical`.
2. **Every service-layer site is wrapped in its own `try/catch`** that logs and
   swallows — e.g. [pickup.ts:376-386](../../packages/core/src/services/pickup.ts#L376-L386),
   commented _"an alerter that is down must not turn a refused seal into a 500 in
   front of a customer's front door"_. The **jobs-layer sites are NOT wrapped**;
   an alerter that throws there fails the Inngest step and triggers a retry.

## 2.3 Current error handling, per app

### Error boundaries

Exactly three files, one per app, all identical in behaviour: `"use client"`,
a `useEffect(() => console.error(error), [error])`, and an `EmptyState` with a
`reset()` button.

- [apps/web/src/app/error.tsx](../../apps/web/src/app/error.tsx) (33 lines)
- [apps/admin/src/app/error.tsx](../../apps/admin/src/app/error.tsx) (28 lines)
- [apps/agent/src/app/error.tsx](../../apps/agent/src/app/error.tsx) (32 lines)

All three already receive `error: Error & { digest?: string }` — the exact shape
`Sentry.captureException` wants.

**`global-error.tsx` does not exist in any app** (`find apps -path '*/node_modules'
-prune -o -path '*/.next' -prune -o -name 'global-error.tsx' -print` → no output).
This matters: Next's root-layout render errors bypass `error.tsx` entirely, and
`@sentry/nextjs` documents `global-error.tsx` as the required capture point for
them.

`not-found.tsx` **does** exist in all three apps
([web](../../apps/web/src/app/not-found.tsx) · [admin](../../apps/admin/src/app/not-found.tsx) ·
[agent](../../apps/agent/src/app/not-found.tsx)) — it is not an error sink and
needs no instrumentation, but it is worth knowing it is there.

### Route-handler catch conventions

23 route handlers exist. The convention, from the two most load-bearing:

**`/api/webhooks/stripe`** ([route.ts](../../apps/web/src/app/api/webhooks/stripe/route.ts))
— three distinct catches, each with a deliberate status:

| Line                                                                 | Catches                    | Response                                              | Reason (in the file)                |
| -------------------------------------------------------------------- | -------------------------- | ----------------------------------------------------- | ----------------------------------- |
| [33-38](../../apps/web/src/app/api/webhooks/stripe/route.ts#L33-L38) | `getCore()` throwing       | **503**                                               | _"Stripe retries a 503"_            |
| [43-49](../../apps/web/src/app/api/webhooks/stripe/route.ts#L43-L49) | `WebhookVerificationError` | **400** + `console.warn`; anything else **re-thrown** | signature rejection is not an error |
| [70-74](../../apps/web/src/app/api/webhooks/stripe/route.ts#L70-L74) | handler failure            | **500** + `console.error`                             | _"let Stripe redeliver"_            |

That `throw error` at line 48 is the only unhandled throw path in the file, and it
is the one a Sentry request handler would catch.

**`/api/driver-position`** ([route.ts:36, 54](../../apps/agent/src/app/api/driver-position/route.ts#L36))
and **`/api/ticket-uploads`** ([route.ts:69](../../apps/web/src/app/api/ticket-uploads/route.ts#L69))
follow the same shape: bare `catch` → JSON error + status, `console.error` for the
unexpected branch.

**Summary: every error path in the product terminates at `console.*`.** There is
no other sink.

### Inngest failure handling

**`onFailure` does not exist.** Grep for `onFailure|inngest/function.failed|retries:`
across `apps/` and `packages/` returns **zero matches**. No function declares a
retry count, and nothing captures terminal (retry-exhausted) failures. Inngest's
own dashboard is the only record.

## 2.4 Env / boot-gate inventory — the prod env pass checklist

### `apps/web` — [src/env.ts](../../apps/web/src/env.ts) (655 lines)

**Gate A — `OTP_LOG_HMAC_KEY`, unconditional on a database.**
[env.ts:336-341](../../apps/web/src/env.ts#L336-L341). Fires whenever
`typeof window === "undefined" && env.DATABASE_URL`, in **every** NODE_ENV.
Requires a key of **≥ 32 characters**. This one is not exempted by `coming_soon`
or by the build phase.

**Gate B — `assertProductionSecurityConfig()`**
([env.ts:393-415](../../apps/web/src/env.ts#L393-L415)), invoked at
[env.ts:421](../../apps/web/src/env.ts#L421) when
`isProd && NEXT_PUBLIC_SUPABASE_URL && !isComingSoon()`. Refuses on any of:

| Var                              | What its absence silently disables        |
| -------------------------------- | ----------------------------------------- |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | CAPTCHA off across the whole funnel       |
| `SUPABASE_SERVICE_ROLE_KEY`      | orphaned GoTrue users never deleted       |
| `DATABASE_URL`                   | OTP throttle and claim reconciliation off |
| `AUTH_SCHEMA_AVAILABLE="false"`  | reconciliation explicitly disabled        |

**Gate C — transactional email + extraction + push**, one `if` block at
[env.ts:452-548](../../apps/web/src/env.ts#L452-L548), conditioned on
`isProd && NEXT_PHASE !== "phase-production-build" && NEXT_PUBLIC_SUPABASE_URL && !isComingSoon()`:

| Throw        | Line                                  | Requires                                                                                                                       |
| ------------ | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| RESEND       | [460](../../apps/web/src/env.ts#L460) | `RESEND_API_KEY`                                                                                                               |
| OPS          | [468](../../apps/web/src/env.ts#L468) | `OPS_ALERT_EMAIL`                                                                                                              |
| EXTRACTION   | [492](../../apps/web/src/env.ts#L492) | `ANTHROPIC_API_KEY`                                                                                                            |
| VAPID trio   | [523](../../apps/web/src/env.ts#L523) | `VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` + `VAPID_SUBJECT` — **only when `NEXT_PUBLIC_PUSH_NOTIFICATIONS_ENABLED === "true"`** |
| VAPID public | [542](../../apps/web/src/env.ts#L542) | `NEXT_PUBLIC_VAPID_PUBLIC_KEY` — same condition                                                                                |

### `apps/admin` — [src/env.ts](../../apps/admin/src/env.ts) (331 lines)

`assertProductionBootConfig()` ([env.ts:215-264](../../apps/admin/src/env.ts#L215-L264)),
invoked at [env.ts:272-278](../../apps/admin/src/env.ts#L272-L278) when
`isProd && NEXT_PHASE !== "phase-production-build"`. **No `coming_soon` exemption.**
Requires: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_AGENT_APP_URL`; plus all four VAPID
values when push is on (all-or-none check, [lines 246-255](../../apps/admin/src/env.ts#L246-L255)).

### `apps/agent` — [src/env.ts](../../apps/agent/src/env.ts) (306 lines)

`assertProductionBootConfig()` ([env.ts:197-235](../../apps/agent/src/env.ts#L197-L235)),
invoked at [env.ts:244-250](../../apps/agent/src/env.ts#L244-L250), same conditions.
Requires: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`; plus the
four VAPID values when push is on. **`SUPABASE_SERVICE_ROLE_KEY` is deliberately
absent from this app's schema** ([ENVIRONMENT.md §5.3](../ENVIRONMENT.md)).

### The consolidated prod-required set

| Variable                                    | web |     agent      |     admin      | Gate                                                     |
| ------------------------------------------- | :-: | :------------: | :------------: | -------------------------------------------------------- |
| `DATABASE_URL`                              |  ●  |       ●        |       ●        | web: Gate B; agent/admin: not gated but the app is inert |
| `OTP_LOG_HMAC_KEY` (≥32)                    |  ●  |       —        |       —        | Gate A — **fires even in coming_soon**                   |
| `NEXT_PUBLIC_SUPABASE_URL`                  |  ●  |       ●        |       ●        | B / agent / admin                                        |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`             |  —  |       ●        |       ●        | agent / admin                                            |
| `SUPABASE_SERVICE_ROLE_KEY`                 |  ●  |   **never**    |       ●        | B / admin                                                |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY`            |  ●  |       ○        |       ○        | B (web only) — but see §4.5                              |
| `NEXT_PUBLIC_AGENT_APP_URL`                 |  ○  |       —        |       ●        | admin                                                    |
| `RESEND_API_KEY`                            |  ●  |       —        |       —        | C                                                        |
| `OPS_ALERT_EMAIL`                           |  ●  |       —        |       —        | C                                                        |
| `ANTHROPIC_API_KEY`                         |  ●  |       —        |       —        | C                                                        |
| 4× VAPID                                    |  ●  |       ●        |       ●        | C / agent / admin — **only while push is on**            |
| `STRIPE_SECRET_KEY`                         |  ●  |       —        |       ○        | **not gated**                                            |
| `STRIPE_WEBHOOK_SECRET`                     |  ●  |       —        |       —        | **not gated**                                            |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`        |  ●  |       —        |       —        | **not gated**                                            |
| `CRON_SECRET`                               |  ●  |       —        |       —        | **not gated**                                            |
| `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY` |  ○  | ○ (event only) | ○ (event only) | **not gated**                                            |
| `SENTRY_DSN`                                |  ○  |       ○        |       ○        | **not gated, and not read**                              |

The four Stripe/cron rows are the notable hole: nothing refuses a production boot
with payments unconfigured. `stripeCheckoutState()`
([apps/web/src/lib/core.ts:55-58](../../apps/web/src/lib/core.ts#L55-L58)) degrades
to `"fake"` or `"misconfigured"` at the pay step instead.

## 2.5 `next.config.mjs` — what `withSentryConfig` will wrap

All three files are near-identical:
[web](../../apps/web/next.config.mjs) · [admin](../../apps/admin/next.config.mjs) · [agent](../../apps/agent/next.config.mjs).

Common to all three:

| Key                                   | Value                                                                                                      | Line (web) |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------- |
| `reactStrictMode`                     | `true`                                                                                                     | 8          |
| `headers()`                           | one entry for `/sw.js`: `Cache-Control: no-cache, no-store, must-revalidate` + `Service-Worker-Allowed: /` | 9-31       |
| `transpilePackages`                   | `["@koolee/ui", "@koolee/core", "@koolee/db"]`                                                             | 33         |
| `outputFileTracingRoot`               | `path.join(__dirname, "../../")`                                                                           | 35         |
| `experimental.optimizePackageImports` | `["@koolee/ui", "lucide-react"]`                                                                           | 37         |

**`apps/agent` alone** adds `experimental.serverActions.bodySizeLimit: "4mb"`
([agent/next.config.mjs:38-44](../../apps/agent/next.config.mjs#L38-L44)) for bag photos.

**There is no other plugin.** No `withPWA`, no `withBundleAnalyzer`, no
composition. `export default nextConfig` is a bare object in every file — so
`withSentryConfig(nextConfig, …)` is a single-wrap with nothing to compose
against. Neither `productionBrowserSourceMaps` nor `webpack`/`turbopack` keys
are set anywhere.

Note: **the `/sw.js` header rule is the one thing that must survive the wrap.**
It is what makes web push work at all, and its loss is silent
([f3-hosted-setup.md §4](../features/f3-hosted-setup.md), "the smoke test that
actually matters", step 4).

## 2.6 Instrumentation files

**`instrumentation.ts`, `instrumentation-client.ts` and `instrumentation-node.ts`
do not exist in any app.** Verified:

```
find apps packages -path '*/node_modules' -prune -o -path '*/.next' -prune \
  -o -name 'instrumentation*' -print
→ (no output)
```

The only middleware-shaped file is [apps/web/src/proxy.ts](../../apps/web/src/proxy.ts)
(Next 16's renamed middleware), matching `/trips/*`, `/dashboard/*`, `/book/*`,
`/login` ([proxy.ts:83](../../apps/web/src/proxy.ts#L83)).

## 2.7 Sentry, as it exists today

`grep -rn "SENTRY_DSN|@sentry|sentry"` over `apps/` + `packages/` + `package.json`
returns **13 lines, and not one of them is code that runs**:

- Schema + raw + status-panel rows in each app's `env.ts` (web 212/267/631-633,
  admin 130/158/311-313, agent 116/141/286-288)
- The `TODO(sentry)` comment at [notifier.ts:107](../../packages/core/src/notifications/notifier.ts#L107)

There is **no `@sentry/nextjs` dependency** in any `package.json`.
There is **no `NEXT_PUBLIC_SENTRY_DSN`** — `SENTRY_DSN` is server-only, so the
browser half of Sentry needs a new variable (see §6.5).

`.env.example` carries a commented entry in all three apps
([web:123-124](../../apps/web/.env.example#L123-L124), admin:84-85, agent:75-76).

**Stack versions**, for SDK compatibility: `next ^16.2.12`, `react ^19.0.0`,
`react-dom ^19.0.0` ([apps/web/package.json:29-32](../../apps/web/package.json#L29-L32)),
Node `>=24` ([package.json:7-9](../../package.json#L7-L9), `.nvmrc` → `24`),
`pnpm@11.18.0`.

---

# 3. Launch data state — what seeds vs what must be real

## 3.1 Coverage ZIPs

**Canonical list: [packages/db/src/coverage-zips.ts](../../packages/db/src/coverage-zips.ts)**
— pure data, zero imports, consumed via the `@koolee/db/coverage-zips` subpath so
client bundles never pull the Postgres driver (file header, lines 1-15).

| Area                    | Const                   |   Count | Line                                                    |
| ----------------------- | ----------------------- | ------: | ------------------------------------------------------- |
| Manhattan               | `MANHATTAN_ZIPS`        |      46 | [18-25](../../packages/db/src/coverage-zips.ts#L18-L25) |
| Brooklyn                | `BROOKLYN_ZIPS`         |      38 | [28-34](../../packages/db/src/coverage-zips.ts#L28-L34) |
| Queens                  | `QUEENS_ZIPS`           |      61 | [37-46](../../packages/db/src/coverage-zips.ts#L37-L46) |
| Bronx                   | `BRONX_ZIPS`            |      25 | [49-54](../../packages/db/src/coverage-zips.ts#L49-L54) |
| Staten Island           | `STATEN_ISLAND_ZIPS`    |      12 | [57-60](../../packages/db/src/coverage-zips.ts#L57-L60) |
| Hudson County NJ        | `HUDSON_COUNTY_NJ_ZIPS` |      16 | [63-66](../../packages/db/src/coverage-zips.ts#L63-L66) |
| **`ALL_COVERAGE_ZIPS`** | flat union              | **198** | [69-76](../../packages/db/src/coverage-zips.ts#L69-L76) |

**These are REAL values, not dev placeholders** — all five NYC boroughs plus the
Hudson County EWR corridor, _"widened for launch-demo completeness (2026-08)"_
([nyc-zips.ts:23-27](../../packages/core/src/coverage/nyc-zips.ts#L23-L27)).

**But that same header carries an unclosed launch obligation:**

> _"Before real sales, re-verify each area against the drive-time assumptions the
> cutoff maths relies on — an out-of-area booking that gets sold is a booking that
> misses its flight."_
> — [nyc-zips.ts:24-27](../../packages/core/src/coverage/nyc-zips.ts#L24-L27)

Coverage lives in **code, not a table**
([nyc-zips.ts:18-21](../../packages/core/src/coverage/nyc-zips.ts#L18-L21)): changing
it is a deploy. `waitlistZoneOpenedSweep` exists precisely because of that
([functions.ts:655-659](../../packages/core/src/jobs/functions.ts#L655-L659)) — a
daily 10:00 ET sweep that emails waitlist signups whose ZIP is covered _now_.

### Consumers

| Consumer                                                  | Line                                                                                                 |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `checkCoverage` in the funnel (flight step + pickup step) | [book/actions.ts:221, 345](../../apps/web/src/app/book/actions.ts#L221)                              |
| `checkCoverage` on waitlist signup                        | [(marketing)/waitlist/actions.ts:42](../../apps/web/src/app/%28marketing%29/waitlist/actions.ts#L42) |
| `assertInCoverage` in `ensureAddress`                     | [customers.ts:282](../../packages/core/src/services/customers.ts#L282)                               |
| `assertInCoverage` in `createBooking`                     | [create-booking.ts:173](../../packages/core/src/services/create-booking.ts#L173)                     |
| `assertInCoverage` in the saved-address CRUD              | [addresses.ts:50, 75](../../packages/core/src/services/addresses.ts#L50)                             |
| `isInCoverage` in `autoAssignBooking`                     | [auto-assign.ts:506](../../packages/core/src/services/auto-assign.ts#L506)                           |
| `isInCoverage` in the waitlist sweep                      | [waitlist/notify-covered.ts:67](../../packages/core/src/waitlist/notify-covered.ts#L67)              |

### How agent AND driver zones consume it

Both roles share **one table, `agent_zones`**, discriminated at read time:

- **Agents:** `listActiveAgents` filters `staff_members.role = 'agent' AND active`
  ([dispatch.ts:64-72](../../packages/core/src/services/dispatch.ts#L64-L72)).
- **Drivers:** `eligibleShifts` runs an `EXISTS` against `agent_zones` on the
  shift's `staff_user_id`, filtering on **`can_drive`** rather than role
  ([driver-selection.ts:142-152](../../packages/core/src/services/driver-selection.ts#L142-L152),
  with the reasoning at lines 137-141 — _"198 live rows, an admin CRUD, and an FK
  to `users` that already fits a driver"_).
- The eligibility `WHERE` also requires an open shift, an active truck, and
  `staff_members.active` ([driver-selection.ts:161-167](../../packages/core/src/services/driver-selection.ts#L161-L167)).

A driver with no zone rows is not excluded — they only appear via the widening
fallback, framed to the customer as _"coming from a little further out"_
([driver-selection.ts:233-238](../../packages/core/src/services/driver-selection.ts#L233-L238),
[trip-driver.tsx:101-103](../../apps/web/src/components/trip-driver.tsx#L101-L103)).

**Admin surface: `/zones`** ([page.tsx](../../apps/admin/src/app/zones/page.tsx),
[actions.ts](../../apps/admin/src/app/zones/actions.ts): `addZones` at 28,
`removeZone` at 71). It lists **agents only** — see §6.9.

## 3.2 Pricing rules

**Schema.** [packages/db/src/schema/billing.ts:87-127](../../packages/db/src/schema/billing.ts#L87-L127).
The invariant is enforced by the database:

```
121  uniqueIndex("pricing_rules_one_active_key").on(t.active).where(sql`${t.active}`)
```

— a partial unique index, so a second `active = true` row is impossible
(migration 0020; the `#41/#51` fixture-leakage class).

**The single active rule, as seeded** ([seed.ts:264-271](../../packages/db/src/seed.ts#L264-L271)):

| Field                 | Value                                                                                                     |
| --------------------- | --------------------------------------------------------------------------------------------------------- |
| `name`                | `launch-v1`                                                                                               |
| `baseFeeCents`        | `2900` ($29.00)                                                                                           |
| `perBagCents`         | `1500` ($15.00)                                                                                           |
| `distanceMultiplier`  | `"45.0000"` (45¢/km)                                                                                      |
| `leadTimeMultipliers` | `[{≤600min: ×1.4}, {≤960: ×1.2}, {≤1440: ×1.1}]` ([seed.ts:38-42](../../packages/db/src/seed.ts#L38-L42)) |
| `discountRules`       | `[{ kind: "family", minBags: 3, percent: 10 }]`                                                           |

The curve's own header calls them **"Placeholder numbers — tune in the DB or
replace with the real dynamic-pricing algorithm at the engine seam"**
([seed.ts:31-36](../../packages/db/src/seed.ts#L31-L36)).

### Where launch values would be set — and the trap

**There is no admin UI for pricing.** `find apps/admin/src/app -name 'page.tsx'`
returns 14 routes: `/`, `/agreements`, `/blocks`, `/bookings`, `/bookings/[id]`,
`/exceptions`, `/login`, `/login/reset`, `/set-password`, `/shifts`, `/staff`,
`/staff/[userId]`, `/trucks`, `/zones`. **No `/pricing`.**

So the only paths to a launch price are (a) editing `seed.ts` and re-running the
seed, or (b) direct SQL.

**And the seed does not merge — it converges.**
[seed.ts:256-291](../../packages/db/src/seed.ts#L256-L291):

```
272-275  UPDATE pricing_rules SET active = false WHERE active = true
276-280  SELECT … WHERE name = 'launch-v1'
281-286  if found:  UPDATE … SET {every LAUNCH_RULE field}, active = true
287-289  else:      INSERT … active = true
```

A hand-tuned `launch-v1` row is **overwritten field-by-field** by the next
`pnpm seed`. Rows are only deactivated, never deleted, so history survives — but
the live numbers do not. See §6.6.

## 3.3 Airline cutoffs and airports

### Airports — three rows, real coordinates

[seed.ts:59-80](../../packages/db/src/seed.ts#L59-L80):

| Code | Name                          | tz               | lat     | lng      |
| ---- | ----------------------------- | ---------------- | ------- | -------- |
| JFK  | John F. Kennedy International | America/New_York | 40.6446 | -73.7797 |
| LGA  | LaGuardia                     | America/New_York | 40.7743 | -73.8722 |
| EWR  | Newark Liberty International  | America/New_York | 40.6895 | -74.1787 |

Documented as the **passenger terminal complex, not the airfield reference point**
([seed.ts:53-58](../../packages/db/src/seed.ts#L53-L58)). Upserted on `code` with
`set: { name, tz, lat, lng }` ([seed.ts:210-220](../../packages/db/src/seed.ts#L210-L220)).

**No cutoff config lives on `airports`.** The table is `code`, `name`, `tz`,
`lat`, `lng`, `created_at` and three CHECKs
([airports.ts:24-54](../../packages/db/src/schema/airports.ts#L24-L54)). Adding a
fourth airport is a DDL statement against `airports_code_check`, not an
`ALTER TYPE`, by design (header lines 20-22) — but `AIRPORT_CODES` in
[enums.ts](../../packages/db/src/schema/enums.ts) is also a TS union that the
draft schema, the pricing estimator and the marketing pages all read.

### Airline cutoffs — 128 placeholder rows

`airline_cutoffs` is keyed `UNIQUE (airline_iata, airport_code, scope)`
([airports.ts:80-84](../../packages/db/src/schema/airports.ts#L80-L84)) and carries a
`source` text column for provenance (line 75).

The seed generates one row per airline **per scope**
([seed.ts:161-180](../../packages/db/src/seed.ts#L161-L180)) from
`AIRLINES_BY_AIRPORT` ([seed.ts:99-158](../../packages/db/src/seed.ts#L99-L158)):

| Airport   | Airlines |    Rows |
| --------- | -------: | ------: |
| JFK       |       30 |      60 |
| LGA       |        9 |      18 |
| EWR       |       25 |      50 |
| **Total** |   **64** | **128** |

(counted by parsing the literal out of `seed.ts` with node.)

**Every value is a placeholder:** `DOMESTIC_CUTOFF_MINUTES = 45`,
`INTERNATIONAL_CUTOFF_MINUTES = 60`
([seed.ts:91-92](../../packages/db/src/seed.ts#L91-L92)), and every row's `source`
is literally

```
seed: placeholder — VERIFY <IATA> <scope> bag-drop policy at <APT> before production use
```

The block header states the stakes plainly: _"This is the single most
safety-critical row in the database: every sellable pickup slot is derived from
it"_ ([airports.ts:56-62](../../packages/db/src/schema/airports.ts#L56-L62)) and
_"ops must verify against the airline before these drive real sales"_
([seed.ts:83-89](../../packages/db/src/seed.ts#L83-L89)).

**There is no admin UI for cutoffs**, and the seed's upsert
(`set: { cutoffMinutesBeforeDeparture, source }`,
[seed.ts:247-252](../../packages/db/src/seed.ts#L247-L252)) **resets verified values
back to 45/60**. See §6.6.

## 3.4 Agreement versions

### What is seeded

Exactly one version, `version = 1`, inserted with
`onConflictDoNothing({ target: agreementVersions.version })`
([seed.ts:415-433](../../packages/db/src/seed.ts#L415-L433)). Title
`"Koolee booking agreement"` ([seed.ts:381](../../packages/db/src/seed.ts#L381)),
`effective_from` fixed at `2026-01-01T05:00:00Z`
([seed.ts:390](../../packages/db/src/seed.ts#L390)) — midnight New York, chosen so
the customer-facing "in effect from" line does not read as an off-by-one bug.

The body ([seed.ts:392-413](../../packages/db/src/seed.ts#L392-L413)) has five
`##` sections — _What you are booking_ · _Identity_ · _Your bags_ · _Money_ ·
_If something goes wrong_ — and closes with:

> _"Placeholder terms for launch. Replace this version at the admin console's
> agreements page with the legally reviewed text before taking real bookings."_

**The seed is idempotent by doing nothing**, not by refreshing — a version in
effect is frozen at the database (migration 0024), and publishing a new one on
every seed run would mint v2, v3, v4… ([seed.ts:321-360](../../packages/db/src/seed.ts#L321-L360)).

### The "§9.3 re-accept language" — **does not exist**

Searched for and not found:

- `grep -rn "9\.3"` across all `*.md`, `*.ts`, `*.tsx` → the only match is
  `docs/run-reports/RUN-REPORT-10.md:1188` (_"### 9.3 Resume checklist, in order"_),
  which is unrelated.
- `PROJECT-STATUS.md` has **no §9 at all** — its top-level sections stop at
  `## 7. Standing constraints` (line 554).
- The **seeded agreement body has no numbered sections and no re-accept clause.**
  It contains no sentence about changing terms, acceptance of changes, or
  continued use.

**What DOES contradict the pinning model** is a different document — the public
marketing Terms of Service, which is a hardcoded array of seven sections in
[apps/web/src/app/(marketing)/terms/page.tsx:13-42](../../apps/web/src/app/%28marketing%29/terms/page.tsx#L13-L42):

> **"7. Changes to these terms** — Koolee may update these terms; material
> changes will be notified to customers with active bookings. **Continued use
> after changes take effect constitutes acceptance.**"
> — [terms/page.tsx:39-41](../../apps/web/src/app/%28marketing%29/terms/page.tsx#L39-L41)

That is a _re-acceptance_ rule. The booking agreement's rule is the opposite:

> _"Every booking needs one acceptance, before the visit. That acceptance PINS the
> version, and that version governs the booking for its whole life. A new version
> never disturbs a booking already in flight."_
> — [agreements.ts:30-36](../../packages/core/src/services/agreements.ts#L30-L36)

The page is marked _"Draft — this document is a working draft under legal review
and is not yet in force"_ ([terms/page.tsx:54-57](../../apps/web/src/app/%28marketing%29/terms/page.tsx#L54-L57))
and carries `robots: { index: false }` (line 10). **Stating the mismatch as a
fact, and no further:** the two documents describe different regimes for what a
published change does to an existing booking. Which one is right is a legal call.

### The publish path for a corrected v2

| Layer         | Location                                                                                                                                                                          |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Admin page    | [apps/admin/src/app/agreements/page.tsx](../../apps/admin/src/app/agreements/page.tsx) + [agreements-workbench.tsx](../../apps/admin/src/app/agreements/agreements-workbench.tsx) |
| Server action | `publishAgreement` at [agreements/actions.ts:47](../../apps/admin/src/app/agreements/actions.ts#L47) — admin session required at line 53, zod at 41-45                            |
| Core          | `publishAgreementVersion` at [agreements.ts:364-400](../../packages/core/src/services/agreements.ts#L364-L400)                                                                    |

Rules the publish enforces:

- `version = max(version) + 1` inside a transaction ([agreements.ts:383-387](../../packages/core/src/services/agreements.ts#L383-L387))
- **No retroactive `effective_from`** — refused past `PUBLISH_CLOCK_SKEW_MS` ([agreements.ts:375-381](../../packages/core/src/services/agreements.ts#L375-L381))
- "Current" is derived, never stored: `max(version) WHERE effective_from <= now()` ([agreements.ts:92-103](../../packages/core/src/services/agreements.ts#L92-L103))
- `effectiveFrom` is parsed as **UTC** from the `datetime-local` field ([actions.ts:35-39](../../apps/admin/src/app/agreements/actions.ts#L35-L39))

The hosted doc already prefers this path over the seed:
_"Preferred — publish the real terms from the admin console at `/agreements`…
Dev only — run the seed, which upserts the placeholder v1"_
([agreements-and-passport-hosted-setup.md §4](../features/agreements-and-passport-hosted-setup.md)).

## 3.5 Trucks, staff, zones, `can_drive` — the prod path

| Thing               | Admin UI                    | Actions                                                                                                                               | Gap                                               |
| ------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| **Trucks**          | `/trucks`                   | `createTruckAction:48`, `updateTruckAction:83`, `setTruckActiveAction:110` ([actions.ts](../../apps/admin/src/app/trucks/actions.ts)) | none for create/edit/deactivate                   |
| **`can_drive`**     | `/shifts` → "Who may drive" | `setCanDriveAction:93` ([actions.ts](../../apps/admin/src/app/shifts/actions.ts))                                                     | none                                              |
| **Shifts**          | `/shifts`                   | `forceEndShiftAction:47`                                                                                                              | drivers open their own shifts in the agent app    |
| **Staff**           | `/staff`                    | `inviteStaff:39`, `deactivateStaff:114` ([actions.ts](../../apps/admin/src/app/staff/actions.ts))                                     | **the first admin cannot be invited — see below** |
| **Zones**           | `/zones`                    | `addZones:28`, `removeZone:71`                                                                                                        | lists **agents only** (§6.9)                      |
| **Blackouts**       | `/blocks`                   | `createBlock:40`, `removeBlock:92`                                                                                                    | none                                              |
| **Agreements**      | `/agreements`               | `publishAgreement:47`                                                                                                                 | none                                              |
| **Pricing rules**   | **none**                    | —                                                                                                                                     | **seed or SQL only**                              |
| **Airline cutoffs** | **none**                    | —                                                                                                                                     | **seed or SQL only**                              |
| **Airports**        | **none**                    | —                                                                                                                                     | **seed or SQL only**                              |
| **Coverage ZIPs**   | **none**                    | —                                                                                                                                     | **code change + deploy**                          |

### The first-admin bootstrap

`seedLocalStaff` **refuses any non-local Supabase host** — a hard skip, not a
warning ([seed.ts:468-472](../../packages/db/src/seed.ts#L468-L472)), because its
roster's passwords are published in the source file. The escape hatch is
`pnpm --filter @koolee/db bootstrap:staff`
([bootstrap-staff.ts:13-49](../../packages/db/src/bootstrap-staff.ts#L13-L49)): the
operator supplies `BOOTSTRAP_EMAIL` / `BOOTSTRAP_PASSWORD` at the call site, so
nothing about the account is knowable from the repo. It creates the GoTrue user,
the `public.users` row with the same id, and the `staff_members` row.

A bulk sibling exists for dev rosters: `pnpm create:staff <database-url>` with
generated passwords ([create-staff.ts:12-53](../../packages/db/src/create-staff.ts#L12-L53)),
including a `--zones` flag that round-robins all 198 coverage ZIPs.

### `staff_members` constraints worth knowing before launch data entry

- `role` is CHECK-constrained to **`agent` or `admin`** only —
  `check("staff_members_role_check", sql`${t.role} in ('agent', 'admin')`)`
  ([staff.ts:58](../../packages/db/src/schema/staff.ts#L58)). The `user_role` enum
  carries `driver`, and the CHECK excludes it on purpose: _"DRIVING IS A
  CAPABILITY, NOT A THIRD ROLE"_ ([staff.ts:22-28](../../packages/db/src/schema/staff.ts#L22-L28)).
- `can_drive` defaults **false** ([staff.ts:47](../../packages/db/src/schema/staff.ts#L47)).
- One row per user (`staff_members_user_id_key`).

### The two DEV trucks

`DEV Truck A — 30 bags` and `DEV Truck B — 12 bags`
([seed.ts:195-198](../../packages/db/src/seed.ts#L195-L198)), upserted on `name` with
`set: { bagCapacity }` — `active` is deliberately **not** reset
([seed.ts:293-303](../../packages/db/src/seed.ts#L293-L303)), so deactivating them
survives a re-seed. The hosted doc's §4.1 instructs taking them out of service.

`trucks.reserved_spaces` exists, is editable in the admin form
([truck-forms.tsx:117-121](../../apps/admin/src/app/trucks/truck-forms.tsx#L117-L121)),
labelled _"not yet enforced"_ on screen
([trucks/page.tsx:96-97](../../apps/admin/src/app/trucks/page.tsx#L96-L97)), and is
read by **nothing** — `listCandidateDrivers` computes
`bagCapacity − bagsOnBoard` with no reserve subtracted
([driver-selection.ts:229-231](../../packages/core/src/services/driver-selection.ts#L229-L231),
[ops.ts:49-58](../../packages/db/src/schema/ops.ts#L49-L58)).

**The seed opens no shifts**, deliberately: _"An open shift means 'somebody is out
driving right now', and a seed asserting that on a machine nobody is driving from
would put phantom drivers in front of customers"_
([seed.ts:306-308](../../packages/db/src/seed.ts#L306-L308)).

---

# 4. Hosted / prod configuration inventory

## 4.1 The definitive prod bring-up list

Compiled from five hosted-setup docs plus `ENVIRONMENT.md`, `MIGRATIONS.md`,
`payments.md`, `storage-and-avatars.md` and `realtime-signals.md`, deduplicated
and ordered by dependency. Each row cites its source.

### A. Database

| #   | Step                                                                                                                                                                                                                          | Source                                                                                            |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| A1  | Merge to `main` → `.github/workflows/migrate.yml` applies pending migrations to the prod project using secret `PROD_DIRECT_DATABASE_URL` (session pooler, **port 5432**, `postgres.<ref>@aws-0-<region>.pooler.supabase.com`) | [MIGRATIONS.md §9.5](../MIGRATIONS.md)                                                            |
| A2  | The workflow's last step runs `db:status` and fails red on hash drift                                                                                                                                                         | [MIGRATIONS.md §9.5](../MIGRATIONS.md)                                                            |
| A3  | **Pre-check for 0025** before merging: `SELECT booking_id, count(*) FROM agreement_acceptances GROUP BY booking_id HAVING count(*) > 1` must return zero rows                                                                 | [agreements-and-passport-hosted-setup.md §2](../features/agreements-and-passport-hosted-setup.md) |
| A4  | **0029 drops `drivers`, `routes`, `agents`** and `RAISE EXCEPTION`s if any has grown a row — a red CI migrate step here means investigate, never force                                                                        | [driver-and-pickup-hosted-setup.md §2](../features/driver-and-pickup-hosted-setup.md)             |
| A5  | Ordering caveat: the migrate workflow runs **in parallel** with the Vercel deploy. A non-backward-compatible migration must not ride it                                                                                       | [MIGRATIONS.md §9.5](../MIGRATIONS.md)                                                            |
| A6  | `pnpm seed` against the target — **CI never seeds; this is always manual**                                                                                                                                                    | [MIGRATIONS.md §9 step 4](../MIGRATIONS.md)                                                       |
| A7  | Hosted carries one **orphan journal row** on purpose. Leave it alone                                                                                                                                                          | [PROJECT-STATUS §3.1](../../PROJECT-STATUS.md)                                                    |

### B. Storage buckets

All four are **declared in code and converged by migration** — there is nothing to
click ([storage-and-avatars.md §1](../features/storage-and-avatars.md), single source
of truth `packages/core/src/uploads/buckets.ts`).

| Bucket            | Created by                                 | `file_size_limit` | Public    |
| ----------------- | ------------------------------------------ | ----------------- | --------- |
| `bag-photos`      | 0008, policies fixed by 0009               | 5 MiB             | **false** |
| `passport-photos` | 0022, policies fixed by 0023               | 10 MiB            | **false** |
| `ticket-uploads`  | 0026 (was a runtime `createBucket` before) | 12 MiB            | **false** |
| `avatars`         | 0026 config + 0027 policies                | 3 MiB             | **false** |

| #   | Verification                                                                                                                                                                                          | Source                                                                                            |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| B1  | `select id, public, file_size_limit, allowed_mime_types from storage.buckets order by id` — `public` must be `false` on **every** row                                                                 | [storage-and-avatars.md §4](../features/storage-and-avatars.md)                                   |
| B2  | `select policyname, cmd, qual, with_check from pg_policies where schemaname='storage' and tablename='objects' and policyname like 'avatars%'` — must match on the first path segment                  | [storage-and-avatars.md §4](../features/storage-and-avatars.md)                                   |
| B3  | Same query for `passport_photos%` — both policies must call `public.is_active_staff`, **not** an inline EXISTS                                                                                        | [agreements-and-passport-hosted-setup.md §3](../features/agreements-and-passport-hosted-setup.md) |
| B4  | **Dashboard → Storage → Settings**: the project-wide upload ceiling (50 MB default) has **no SQL surface** and must stay above every `bucketMaxBytes`. The one storage number not tracked in the repo | [storage-and-avatars.md §1](../features/storage-and-avatars.md)                                   |

### C. Realtime

| #   | Step                                                                                                                                                                                                                                                                          | Source                                                  |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| C1  | 0030 sets `REPLICA IDENTITY FULL` and runs `ALTER PUBLICATION supabase_realtime ADD TABLE public.booking_signals` — **CI does it**                                                                                                                                            | [f2-hosted-setup.md §2](../features/f2-hosted-setup.md) |
| C2  | Confirm under **Database → Replication** that the publication exists and lists `booking_signals`. The migration block is a no-op if `supabase_realtime` does not exist                                                                                                        | [f2-hosted-setup.md §2](../features/f2-hosted-setup.md) |
| C3  | Verify the **GRANT**: `select grantee, privilege_type from information_schema.role_table_grants where table_name='booking_signals' and privilege_type='SELECT'` → `authenticated`, and nobody else. **Missing grant = realtime silently dead** (0031 exists for exactly this) | [f2-hosted-setup.md §1](../features/f2-hosted-setup.md) |
| C4  | Expect `relrowsecurity = t`, `relreplident = f`, exactly one policy (`booking_signals_select_watchable`), and **four** triggers on `custody_events`                                                                                                                           | [f2-hosted-setup.md §1](../features/f2-hosted-setup.md) |

### D. Supabase auth (dashboard-only; travels with no migration)

| #   | Setting                                                                                                                                                        | Source                                                                                         |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| D1  | **Custom SMTP** — Authentication → Notifications → Email. Resend: `smtp.resend.com`, port `465`, username the literal `resend`, password a Resend API key      | [ENVIRONMENT.md §6.6](../ENVIRONMENT.md)                                                       |
| D2  | **`{{ .Token }}` in three templates** — _Confirm signup_, _Magic Link_, _Change Email Address_. A template holding only `{{ .ConfirmationURL }}` sends a link  | [ENVIRONMENT.md §6.6](../ENVIRONMENT.md)                                                       |
| D3  | **OTP length = 6.** `verifyOtp` validates `/^\d{6}$/`; the project defaulted to 8                                                                              | [ENVIRONMENT.md §6.6](../ENVIRONMENT.md), [auth.md §2.6](../features/auth.md)                  |
| D4  | **Site URL** = the production origin (`{{ .ConfirmationURL }}` is built from it)                                                                               | [ENVIRONMENT.md §6.6](../ENVIRONMENT.md)                                                       |
| D5  | **Turnstile SECRET key** → Auth → Attack Protection. CAPTCHA is a **PROJECT** setting, so enabling it gates the staff apps' `signInWithPassword`/`recover` too | [ENVIRONMENT.md §5.2](../ENVIRONMENT.md)                                                       |
| D6  | **Anonymous sign-ins must stay ENABLED** — the funnel starts with `signInAnonymously()`                                                                        | [staff.ts:11-15](../../packages/db/src/schema/staff.ts#L11-L15)                                |
| D7  | **Twilio Verify credentials** live only in the dashboard, never in app env                                                                                     | [ENVIRONMENT.md §5.1](../ENVIRONMENT.md), [auth.md §1](../features/auth.md)                    |
| D8  | **No test phone numbers** in the prod dashboard, and the `[auth.sms.test_otp]` block must not reach the prod project. **Two independent sources to check**     | [pre-launch-security.md §6](../../apps/web/docs/pre-launch-security.md), PROJECT-STATUS row 25 |

### E. Turnstile (Cloudflare)

| #   | Step                                                                                                                                                                    | Source                                                                                            |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| E1  | Two widgets, one per environment. Prod widget hostnames: `koolee.cloud` + **the prod agent host** + **the prod admin host**                                             | [ENVIRONMENT.md §5.2](../ENVIRONMENT.md), [f1-hosted-setup.md §2](../features/f1-hosted-setup.md) |
| E2  | An entry covers **only its own subdomains**. `dev.admin.koolee.cloud` is a subdomain of `admin.koolee.cloud`, _not_ of `dev.koolee.cloud` — the `110200` bug            | [f1-hosted-setup.md §2](../features/f1-hosted-setup.md)                                           |
| E3  | **Never** add the apex to the dev widget — it would let dev answer for production                                                                                       | [ENVIRONMENT.md §5.2](../ENVIRONMENT.md)                                                          |
| E4  | All three apps must use the **same site key** per environment (the secret is one per-Supabase-project value)                                                            | [ENVIRONMENT.md §5.2](../ENVIRONMENT.md)                                                          |
| E5  | The deployed widget currently renders a **visible "Verify you are human" checkbox**, not the invisible widget the docs describe. Either switch the mode or fix the docs | [f1-hosted-setup.md §2](../features/f1-hosted-setup.md), PROJECT-STATUS row 24                    |
| E6  | `*.vercel.app` previews **cannot** pass the captcha (Public Suffix List)                                                                                                | [ENVIRONMENT.md §6.6](../ENVIRONMENT.md)                                                          |

### F. Inngest

| #   | Step                                                                                                                                                                                                                                                                 | Source                                                                                                                                       |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | The app id is **hardcoded `"koolee"`** for every environment ([client.ts:151](../../packages/core/src/jobs/client.ts#L151)). Syncing a dev URL into the **Production** Inngest environment repoints prod's app at dev — prod crons then run against the dev database | [ENVIRONMENT.md §6.6](../ENVIRONMENT.md)                                                                                                     |
| F2  | Separate **per-environment signing keys** are what make F1 safe: Inngest routes a sync by the key that authenticated it                                                                                                                                              | [ENVIRONMENT.md §6.6](../ENVIRONMENT.md)                                                                                                     |
| F3  | Sync URL: `https://<origin>/api/inngest`. **Only `apps/web` serves it** — agent and admin are send-only                                                                                                                                                              | [inngest/route.ts](../../apps/web/src/app/api/inngest/route.ts), [functions.ts:686-690](../../packages/core/src/jobs/functions.ts#L686-L690) |
| F4  | `INNGEST_SIGNING_KEY` on `apps/web` only; `INNGEST_EVENT_KEY` on all three                                                                                                                                                                                           | [ENVIRONMENT.md §3](../ENVIRONMENT.md)                                                                                                       |

### G. Vercel

| #   | Step                                                                                                                                                                             | Source                                                                                            |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| G1  | ONE project for `apps/web`. `main` → Production scope + `koolee.cloud`; every other branch → Preview scope + `dev.koolee.cloud` pinned to `dev`                                  | [ENVIRONMENT.md §6.6](../ENVIRONMENT.md)                                                          |
| G2  | **Env vars bake at build time**, server-side ones included. Changing one does nothing to existing deployments — redeploy with **build cache off**                                | [ENVIRONMENT.md §6.6](../ENVIRONMENT.md), [f1-hosted-setup.md §1](../features/f1-hosted-setup.md) |
| G3  | **Every variable naming an external service needs two rows**, one per scope. Exceptions (shared read-only): `AEROAPI_KEY`, `GOOGLE_MAPS_API_KEY`, `RESEND_API_KEY`, `SENTRY_DSN` | [ENVIRONMENT.md §6.6](../ENVIRONMENT.md)                                                          |
| G4  | `NODE_ENV` is `production` in Preview too — every boot gate fires on `dev.koolee.cloud`                                                                                          | [ENVIRONMENT.md §6.6](../ENVIRONMENT.md)                                                          |
| G5  | **Deployment Protection must be OFF for Preview**, or `/api/inngest` and `/api/webhooks/stripe` get a 302 to `vercel.com/sso-api`                                                | [ENVIRONMENT.md §6.6](../ENVIRONMENT.md)                                                          |
| G6  | **Open TODO:** `dev.koolee.cloud` needs `X-Robots-Tag: noindex`, gated on `VERCEL_ENV === "preview"` (not `!== "production"`, so a missing var fails safe)                       | [ENVIRONMENT.md §6.6](../ENVIRONMENT.md)                                                          |

### H. Stripe

See §4.3 for the full live-mode delta.

### I. Push (only if the kill switch is turned on)

All four VAPID values in **all three** apps, one pair per environment, generated
once with `pnpm push:vapid` — regenerating invalidates every stored subscription
([f3-hosted-setup.md §2–3](../features/f3-hosted-setup.md)). Registry list in §4.7.

## 4.2 ALLOWED CHECK — `db:status` against staging: **SKIPPED**

No staging connection was available:

```
DIRECT_DATABASE_URL: unset
DATABASE_URL: unset
STAGING_DATABASE_URL: unset
STAGING_DIRECT_DATABASE_URL: unset
```

Reading `packages/db/.env` (which would have shown its target host) was **denied
by the permission layer**, so its contents are unknown to this session. Nothing
was run against any database.

**What replaces it — the number Tier 5 needs, from the checkout:**

```
ls packages/db/drizzle/*.sql | wc -l           →  33
grep -c '"tag"' packages/db/drizzle/meta/_journal.json →  33
```

**33 migrations, `0000_init` … `0032_push_subscriptions`.** The newest four, all
of which shipped LOCAL-ONLY per PROJECT-STATUS §3 and are therefore the ones a
prod day-one apply must cover:

| Tag                            | Slice                                    |
| ------------------------------ | ---------------------------------------- |
| `0029_driver_fleet_and_shifts` | Tier 4 — **drops three tables**, guarded |
| `0030_booking_signals`         | F2 realtime                              |
| `0031_booking_signals_grant`   | F2 — the GRANT that 0030 forgot          |
| `0032_push_subscriptions`      | F3 push                                  |

Expected `db:status` output on a fully-migrated hosted project:
**`33 of 33 (matched by content hash)`**, plus one orphan journal row on hosted
which is expected and must be left alone (PROJECT-STATUS §3.1).

**PROJECT-STATUS carries an OPEN item that this check would have closed:**

> _"**B1 remains OPEN** — hosted migration state is documented as done but has
> never been verified from a shell"_ — [PROJECT-STATUS.md:202-206](../../PROJECT-STATUS.md)

It is still open. The last recorded hosted verification was **21/21** at the
v0.2.0 release (2026-08-23, PROJECT-STATUS §3), i.e. through `0020`. Twelve
migrations (`0021`–`0032`) have been generated since. **Whether prod has any of
them is unverified by this session and, per B1, unverified by anyone.**

## 4.3 Stripe — current handling and the live-mode delta

### What exists

| Piece                                                                         | Location                                                                                                                          |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Provider (the only place the SDK may be imported; an ESLint rule enforces it) | [payments/stripe/provider.ts](../../packages/core/src/payments/stripe/provider.ts)                                                |
| Factory / config union                                                        | [payments/factory.ts:16-23](../../packages/core/src/payments/factory.ts#L16-L23)                                                  |
| Webhook route                                                                 | [apps/web/src/app/api/webhooks/stripe/route.ts](../../apps/web/src/app/api/webhooks/stripe/route.ts)                              |
| Replay guard                                                                  | `payment_webhook_events`, `UNIQUE (provider, event_id)` ([billing.ts:135-148](../../packages/db/src/schema/billing.ts#L135-L148)) |
| Idempotency key                                                               | `payments`, `UNIQUE (provider, provider_ref)` ([billing.ts:49](../../packages/db/src/schema/billing.ts#L49))                      |

### Nothing is hardcoded test-mode

Verified by reading the provider. The client is constructed **lazily**, from
`config.secretKey`, with no environment read
([provider.ts:52-66](../../packages/core/src/payments/stripe/provider.ts#L52-L66)).
The only pinned constant is the **API version**:

```
62      apiVersion: "2026-07-29.dahlia",
```

— [provider.ts:62](../../packages/core/src/payments/stripe/provider.ts#L62), with the
note that it _"must match the installed SDK's pinned version
(`Stripe.LatestApiVersion`) exactly"_. `stripe ^22.4.0`
([packages/core/package.json:35](../../packages/core/package.json#L35)).

Flow constants: `capture_method: "manual"` and
`automatic_payment_methods: { enabled: true }`
([provider.ts:80-81](../../packages/core/src/payments/stripe/provider.ts#L80-L81)).
Handled event types, all four
([provider.ts:282-292](../../packages/core/src/payments/stripe/provider.ts#L282-L292)):
`payment_intent.amount_capturable_updated`, `.succeeded`, `.canceled`,
`.payment_failed`.

`verifyWebhook` **refuses without a secret** rather than trusting an unverified
payload ([provider.ts:222-227](../../packages/core/src/payments/stripe/provider.ts#L222-L227)).

### The live-flip delta — the factual basis for the runbook

| Change                                                                                                | Where                                     | Note                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `STRIPE_SECRET_KEY` → live `sk_live_…`                                                                | `apps/web` **and** `apps/admin` (refunds) | selected at [apps/web/src/lib/core.ts:26-37](../../apps/web/src/lib/core.ts#L26-L37) and [apps/admin/src/lib/core.ts:22-27](../../apps/admin/src/lib/core.ts#L22-L27)                    |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` → live `pk_live_…`                                               | `apps/web` only                           | **must be flipped in the same deploy** — a live secret without a live publishable key puts the pay step into `"misconfigured"` ([core.ts:47-58](../../apps/web/src/lib/core.ts#L47-L58)) |
| **Create a new webhook endpoint in LIVE mode** pointing at `https://koolee.cloud/api/webhooks/stripe` | Stripe dashboard                          | test-mode endpoints do not carry over                                                                                                                                                    |
| `STRIPE_WEBHOOK_SECRET` → the **new** live endpoint's `whsec_…`                                       | `apps/web` only                           | a stale test secret makes every live event a signed-400                                                                                                                                  |
| Subscribe the endpoint to the four event types above                                                  | Stripe dashboard                          | not automated                                                                                                                                                                            |
| Redeploy **with build cache off**                                                                     | Vercel                                    | [ENVIRONMENT.md §6.6](../ENVIRONMENT.md)                                                                                                                                                 |

**Nothing in code changes**, and no migration is involved. `apps/admin` reads no
`STRIPE_WEBHOOK_SECRET` at all ([admin/src/env.ts:122](../../apps/admin/src/env.ts#L122)),
which is correct — only web receives webhooks.

**The quiet one**, verbatim from the existing checklist:

> _"`CRON_SECRET` set, and the Inngest capture cron actually running — **without
> it, authorizations are never captured and expire.** … Everything looks healthy:
> bookings complete, bags move, customers are happy, and no money arrives."_
> — [payments.md §8](../features/payments.md)

## 4.4 Supabase auth — what degrades with no Twilio

### The two channels

The funnel's verify step opens on **phone** and offers email as an escape hatch:
`const [channel, setChannel] = React.useState<Channel>("phone")`
([verify-flow.tsx:39](../../apps/web/src/app/book/verify/verify-flow.tsx#L39)), with a
link reading _"Traveling without a US number? Use email instead"_
([verify-flow.tsx:263](../../apps/web/src/app/book/verify/verify-flow.tsx#L263)).

`sendOtp` has four modes — `phone_change | sms | email_change | email`
([actions/auth.ts:56](../../apps/web/src/actions/auth.ts#L56)) — with a full email
path at [auth.ts:355-408](../../apps/web/src/actions/auth.ts#L355-L408) and a phone
path at [auth.ts:410-478](../../apps/web/src/actions/auth.ts#L410-L478).

**Email is a signup channel, not just a lookup** — it calls the email branch with
`shouldCreateUser: true`, _"That matters while phone verification waits on Twilio
business approval: there has to be at least one way in"_
([auth.md §2.6](../features/auth.md)).

### Where phone verification is read

| Reader                | Line                                                                                               | Effect with no verified phone                                               |
| --------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `profileCompleteness` | [profile-completeness.ts:58](../../packages/core/src/services/profile-completeness.ts#L58)         | `verify_phone` stays in `missing` → **the profile can never read complete** |
| `requireVerifiedUser` | [auth/guards.ts:31](../../packages/core/src/auth/guards.ts#L31)                                    | passes on `emailVerifiedAt` alone — **not a phone-only gate**               |
| Profile page badge    | [dashboard/profile/page.tsx:109, 134, 139](../../apps/web/src/app/dashboard/profile/page.tsx#L109) | renders an unverified badge + a verify CTA                                  |

`requireVerifiedUser` is **exported but has no production caller** — grep finds
only its definition and the barrel re-export at
[auth/index.ts:25](../../packages/core/src/auth/index.ts#L25).

**So with no Twilio:** every customer can still sign up, book and pay by email;
`ProfileCompletenessCard` shows a permanent "verify phone" gap for everyone; and
the operational cost is the one stated in the completeness header — _"a verified
phone, which is how a driver reaches somebody standing in a lobby with three
bags"_ ([profile-completeness.ts:11-12](../../packages/core/src/services/profile-completeness.ts#L11-L12)).
`users.phone` is still captured; only `phone_verified_at` is not.

Note also that phone OTP is **not** what gates the booking — `requireVerifiedUser`
accepts an email-verified account, and the funnel's own gate is the verify step,
which accepts either channel.

## 4.5 Turnstile — where hostnames matter

Ten source files mount or read the widget:

| App          | Field component                                                                 | Login                                                                             | Reset                                                                 | Action reader                                                                                                                  |
| ------------ | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| web          | [turnstile-gate.tsx](../../apps/web/src/components/auth/turnstile-gate.tsx)     | [login/login-flow.tsx](../../apps/web/src/app/login/login-flow.tsx)               | —                                                                     | [actions/auth.ts](../../apps/web/src/actions/auth.ts)                                                                          |
| web (funnel) | same                                                                            | [book/verify/verify-flow.tsx](../../apps/web/src/app/book/verify/verify-flow.tsx) | —                                                                     | [book/actions.ts](../../apps/web/src/app/book/actions.ts), [book/flight/page.tsx](../../apps/web/src/app/book/flight/page.tsx) |
| admin        | [turnstile-field.tsx](../../apps/admin/src/components/auth/turnstile-field.tsx) | [login/page.tsx](../../apps/admin/src/app/login/page.tsx)                         | [login/reset/page.tsx](../../apps/admin/src/app/login/reset/page.tsx) | [actions/auth.ts](../../apps/admin/src/actions/auth.ts)                                                                        |
| agent        | [turnstile-field.tsx](../../apps/agent/src/components/auth/turnstile-field.tsx) | [login/page.tsx](../../apps/agent/src/app/login/page.tsx)                         | [login/reset/page.tsx](../../apps/agent/src/app/login/reset/page.tsx) | [actions/auth.ts](../../apps/agent/src/actions/auth.ts)                                                                        |

`NEXT_PUBLIC_TURNSTILE_SITE_KEY` is in **all three** env schemas
([web:89](../../apps/web/src/env.ts#L89), [admin:119](../../apps/admin/src/env.ts#L119),
[agent:106](../../apps/agent/src/env.ts#L106)) — but the **boot gate exists only in
`apps/web`** ([env.ts:394-397](../../apps/web/src/env.ts#L394-L397)). A production
admin or agent deploy missing the site key boots clean and then fails every
sign-in with what looks like a wrong password — the exact symptom
`ENVIRONMENT.md §8` documents.

The app never calls `siteverify`; Supabase verifies the forwarded `captchaToken`
([ENVIRONMENT.md §5.2](../ENVIRONMENT.md), [web/env.ts:86-88](../../apps/web/src/env.ts#L86-L88)).

## 4.6 Contradictions found between docs, or between docs and code

Four, all launch-relevant:

**(1) Turnstile subdomain coverage — two docs disagree with each other.**

- `ENVIRONMENT.md §5.2` (corrected): _"an entry covers only ITS OWN subdomains …
  `dev.admin.koolee.cloud` … is a subdomain of `admin.koolee.cloud`, not of
  `dev.koolee.cloud`"_.
- `ENVIRONMENT.md §6.6` (**not corrected**): _"Hostname entries already cover
  subdomains, so adding the apex to the dev widget would silently make it valid
  for production."_

The second sentence is the belief that caused the `110200` outage. It is still in
the file, two sections below its own correction.

**(2) `jobs-and-notifications.md §7` is stale on two counts.**

> _"**Driver ETA is a fixed estimate**, so the cutoff monitor under-alerts."_

False since Tier 4 — `cutoffRiskMonitor` asks the estimator and takes `maxMinutes`
([functions.ts:542-546](../../packages/core/src/jobs/functions.ts#L542-L546)).

> _"**Admin-raised exceptions don't emit** `booking/exception_raised` — only the
> webhook payment-cancelled path does."_

False — `apps/admin` now injects `inngestEmitter`
([admin/src/lib/core.ts:91, 102](../../apps/admin/src/lib/core.ts#L91)) for exactly
this reason, and core emits from the transition itself.

**(3) `apps/agent/src/env.ts:281` claims a Maps fallback that does not exist.**

`fallback: "Route ETA uses a fixed estimate."` — the agent app renders no ETA at
all, and the ETA that does exist is haversine, not fixed.
Same class of stale text in [apps/web/.env.example:105](../../apps/web/.env.example#L105):
_"Drive time uses a fixed estimate."_

**(4) `docs/run-reports/README.md` index is two reports behind** — it lists
RUN-REPORT-1..8 plus the Tier 4 preflight, and omits RUN-REPORT-9 (F2) and
RUN-REPORT-10 (F3), both of which exist.

## 4.7 Inngest — the full registry prod must run

**15 functions.** Thirteen from core's shared factory
([functions.ts:1392-1406](../../packages/core/src/jobs/functions.ts#L1392-L1406)) plus
two declared in the app ([apps/web/src/lib/inngest.ts:79-96](../../apps/web/src/lib/inngest.ts#L79-L96)).

| #   | id                            | Trigger                                   |
| --- | ----------------------------- | ----------------------------------------- |
| 1   | `booking-confirmation-email`  | event `booking/confirmed`                 |
| 2   | `booking-pickup-reminder`     | event `booking/confirmed`                 |
| 3   | `assignment-horizon-sweep`    | **cron `*/5 * * * *`**                    |
| 4   | `exception-ops-alert-email`   | event `booking/exception_raised`          |
| 5   | `waitlist-zone-opened-sweep`  | **cron `TZ=America/New_York 0 10 * * *`** |
| 6   | `cutoff-risk-monitor`         | **cron `*/5 * * * *`**                    |
| 7   | `agent-no-show-check`         | event `booking/agent_no_show_check`       |
| 8   | `driver-selected-email`       | event `booking/driver_selected`           |
| 9   | `bagdrop-delivered-email`     | event `booking/delivered_to_bagdrop`      |
| 10  | `driver-pool-empty-ops-alert` | event `booking/driver_pool_empty`         |
| 11  | `agent-assigned-email`        | event `booking/agent_assigned`            |
| 12  | `bags-sealed-email`           | event `booking/bags_sealed`               |
| 13  | `exception-customer-email`    | event `booking/exception_raised`          |
| 14  | `cleanup-anonymous-users`     | **cron `TZ=America/New_York 0 4 * * *`**  |
| 15  | `capture-due-bookings`        | **cron `*/5 * * * *`**                    |

**Four crons**, three of them `*/5`.

### Registration

- Served from **`apps/web` only**: `serve({ client: inngest, functions })` at
  [api/inngest/route.ts:21-24](../../apps/web/src/app/api/inngest/route.ts#L21-L24),
  pinned `runtime = "nodejs"` and `dynamic = "force-dynamic"`.
- Agent and admin build a client for **sending only** — no `/api/inngest` route
  exists in either (`find apps -path '*inngest*'` returns four paths, all under
  `apps/web`). A function added there _"would silently never run"_
  ([functions.ts:686-690](../../packages/core/src/jobs/functions.ts#L686-L690)).
- **v4 note: the signing key is on the CLIENT, not on `serve()`** —
  [inngest-client.ts:17-22](../../apps/web/src/lib/inngest-client.ts#L17-L22),
  `isDev: env.NODE_ENV !== "production"`.
- Options threaded at [inngest.ts:80-93](../../apps/web/src/lib/inngest.ts#L80-L93):
  `opsAlertEmail` ← `OPS_ALERT_EMAIL`, `appOrigin` ← `NEXT_PUBLIC_APP_URL`,
  `agentAppOrigin` ← `NEXT_PUBLIC_AGENT_APP_URL`, `adminAppOrigin` ←
  `NEXT_PUBLIC_ADMIN_APP_URL`, `supportEmail` ← `SITE.contactEmail` (site copy,
  not env).

### Manual trigger routes

`POST /api/jobs/capture-due` and `POST /api/jobs/cleanup-anon`, both guarded by
`CRON_SECRET` via `x-cron-secret` or `Authorization: Bearer`, and both **503 when
the secret is unset** — _"refuses to run without one so it can never be triggered
anonymously in production"_
([capture-due/route.ts:24-38](../../apps/web/src/app/api/jobs/capture-due/route.ts#L24-L38)).

---

# 5. Launch checklist seed

Deduplicated from `PROJECT-STATUS.md` (§3 snapshot, §4 tracker, §3.1),
`apps/web/docs/pre-launch-security.md`, the five hosted-setup docs, and the
"Deferred, with reasons" sections of RUN-REPORT-5/7/8/9/10.

**The judgement column is `Class`. Everything to its left is a citation.**

## 5.1 Launch-blocking

| #   | Item                                                                                                                                                                                                          | Source                                                                                                                                                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L1  | **Verify hosted migration state from a shell** (`db:status` against prod and dev). PROJECT-STATUS's prose is not proof; last shell-verified state was 21/21 on 2026-08-23, and the repo is now at 33          | PROJECT-STATUS:202-206 (**B1, still OPEN**), §4.2 above                                                                                                         |
| L2  | **Verify the 128 airline-cutoff rows against real airline policy.** Every row's `source` says "placeholder — VERIFY … before production use"; the cutoff is what decides whether a pickup can make the flight | [seed.ts:83-89](../../packages/db/src/seed.ts#L83-L89), [airports.ts:56-62](../../packages/db/src/schema/airports.ts#L56-L62), PROJECT-STATUS:228-232           |
| L3  | **Re-verify each coverage area against the drive-time assumptions** the cutoff maths relies on                                                                                                                | [nyc-zips.ts:24-27](../../packages/core/src/coverage/nyc-zips.ts#L24-L27)                                                                                       |
| L4  | **Publish legally-reviewed agreement v2** at admin `/agreements`. The seeded v1 says so in its own last line                                                                                                  | [seed.ts:410-412](../../packages/db/src/seed.ts#L410-L412), [agreements-and-passport-hosted-setup.md §4](../features/agreements-and-passport-hosted-setup.md)   |
| L5  | **Stripe live mode**: live secret + publishable in the same deploy, a new live webhook endpoint, its `whsec_`, four event subscriptions                                                                       | [payments.md §8](../features/payments.md), §4.3                                                                                                                 |
| L6  | **`CRON_SECRET` set and the capture cron verified running.** Without it authorizations expire and no money arrives, with every other signal green                                                             | [payments.md §8](../features/payments.md)                                                                                                                       |
| L7  | **Verify BOTH test-OTP sources are absent from production** — the `config.toml` block AND any dashboard-entered test phone (`13322602829` is valid-format and passes the app's own validation)                | PROJECT-STATUS row 25, [pre-launch-security.md §6](../../apps/web/docs/pre-launch-security.md), [supabase/config.toml:311-320](../../supabase/config.toml#L311) |
| L8  | **Own Twilio account + business verification**                                                                                                                                                                | PROJECT-STATUS:228-232                                                                                                                                          |
| L9  | **Flip `NEXT_PUBLIC_LAUNCH_MODE` to `live` and redeploy with the cache off** — this arms five `apps/web` boot gates at once                                                                                   | PROJECT-STATUS:228-232, §2.4, §6.7                                                                                                                              |
| L10 | **Supabase auth dashboard, all four**: custom SMTP, `{{ .Token }}` in three templates, OTP length 6, Site URL                                                                                                 | [ENVIRONMENT.md §6.6](../ENVIRONMENT.md)                                                                                                                        |
| L11 | **Prod Turnstile widget hostnames** — apex + prod agent host + prod admin host, each listed explicitly                                                                                                        | [f1-hosted-setup.md §2](../features/f1-hosted-setup.md)                                                                                                         |
| L12 | **`NEXT_PUBLIC_TURNSTILE_SITE_KEY` on the admin and agent prod scopes.** Neither app gates on it at boot; its absence looks like a wrong password                                                             | §4.5                                                                                                                                                            |
| L13 | **Inngest: sync the PROD url into the PROD environment with the prod signing key.** The app id is hardcoded `"koolee"` — a wrong sync repoints prod at dev                                                    | [ENVIRONMENT.md §6.6](../ENVIRONMENT.md), [client.ts:151](../../packages/core/src/jobs/client.ts#L151)                                                          |
| L14 | **Bootstrap the first prod admin** with `pnpm bootstrap:staff` — the seed's staff roster hard-refuses non-local hosts, and `/staff` invites need an admin session to reach                                    | [bootstrap-staff.ts:13-30](../../packages/db/src/bootstrap-staff.ts#L13-L30), [seed.ts:468-472](../../packages/db/src/seed.ts#L468-L472)                        |
| L15 | **Enter the real fleet at `/trucks` and take both `DEV Truck …` fixtures out of service**                                                                                                                     | [driver-and-pickup-hosted-setup.md §4.1](../features/driver-and-pickup-hosted-setup.md)                                                                         |
| L16 | **Grant `can_drive` at `/shifts`.** Defaults false; nothing works until it is done — no shift, no driver shortlist, every sealed booking reads "needs a driver"                                               | [driver-and-pickup-hosted-setup.md §4.2](../features/driver-and-pickup-hosted-setup.md)                                                                         |
| L17 | **Populate `agent_zones` for prod staff.** The seed's zone round-robin runs only inside the local-only staff block                                                                                            | [seed.ts:627-643](../../packages/db/src/seed.ts#L627-L643)                                                                                                      |
| L18 | **Confirm `booking_signals` is in `supabase_realtime` AND that `authenticated` holds the SELECT grant.** A missing grant is silently dead realtime                                                            | [f2-hosted-setup.md §1](../features/f2-hosted-setup.md)                                                                                                         |
| L19 | **Confirm every storage bucket has `public = false`**                                                                                                                                                         | [storage-and-avatars.md §4](../features/storage-and-avatars.md)                                                                                                 |
| L20 | **Deployment Protection OFF for Preview**, or Inngest cannot sync and Stripe cannot deliver                                                                                                                   | [ENVIRONMENT.md §6.6](../ENVIRONMENT.md)                                                                                                                        |

## 5.2 Launch-data (real values replacing seeded placeholders)

| #   | Item                                                                                                                                                 | Source                                                                                |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| D1  | Airline cutoffs — 128 rows, no admin UI, seed-or-SQL only, **and the seed overwrites them**                                                          | §3.3, §6.6                                                                            |
| D2  | Pricing rule `launch-v1` — base $29 / bag $15 / 45¢ per km / the lead curve / the 3-bag 10% family discount. No admin UI; **the seed overwrites it** | §3.2, §6.6                                                                            |
| D3  | `RESEND_FROM` — defaults to Resend's sandbox sender; must be the verified domain                                                                     | [web/env.ts:132-138](../../apps/web/src/env.ts#L132-L138)                             |
| D4  | `OPS_ALERT_EMAIL` — a real monitored inbox                                                                                                           | [web/env.ts:116-121](../../apps/web/src/env.ts#L116-L121)                             |
| D5  | `NEXT_PUBLIC_AGENT_APP_URL` / `NEXT_PUBLIC_ADMIN_APP_URL` on `apps/web` — deep links on staff pushes                                                 | [f3-hosted-setup.md §3](../features/f3-hosted-setup.md)                               |
| D6  | `ASSIGNMENT_HORIZON_HOURS` must **match** between web and admin, or the console's badges disagree with the sweep                                     | [f3-hosted-setup.md §5](../features/f3-hosted-setup.md)                               |
| D7  | The `agreements` v2 body, from legal                                                                                                                 | §3.4                                                                                  |
| D8  | The marketing `/terms` page's seven sections — currently marked "Draft … not yet in force"                                                           | [terms/page.tsx:54-57](../../apps/web/src/app/%28marketing%29/terms/page.tsx#L54-L57) |

## 5.3 Post-launch (deliberate deferrals, each with a recorded reason)

| #   | Item                                                                                                                            | Source                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| P1  | **SMS** — parked on A2P registration. `NotificationDispatcher` is the seam; there is no code                                    | [notifications.md §2](../features/notifications.md), RUN-REPORT-9 §7.3                     |
| P2  | **AeroAPI flight lookup** — stubbed                                                                                             | PROJECT-STATUS row 15                                                                      |
| P3  | **`reserved_spaces` enforcement** — one subtraction in `listCandidateDrivers` plus a test                                       | [ops.ts:49-58](../../packages/db/src/schema/ops.ts#L49-L58), RUN-REPORT-7                  |
| P4  | **A map on the customer trip page** — deliberate; distance + ETA answer the question                                            | [trip-driver.tsx:34-38](../../apps/web/src/components/trip-driver.tsx#L34-L38)             |
| P5  | **`cutoffRiskMonitor` measuring from the DRIVER's position** rather than the pickup address — `driver_positions` is right there | [functions.ts:467-470](../../packages/core/src/jobs/functions.ts#L467-L470), RUN-REPORT-7  |
| P6  | **Driver-no-show check** (`agentNoShowCheck`'s twin, with the airline cutoff as its deadline)                                   | RUN-REPORT-7                                                                               |
| P7  | **Reassignment machinery** — `agentNoShowCheck` pages a human rather than trying the next agent                                 | [functions.ts:632-634](../../packages/core/src/jobs/functions.ts#L632-L634)                |
| P8  | **Offline outbox for custody capture**                                                                                          | RUN-REPORT-9 §7.3                                                                          |
| P9  | **Retention sweep** for orphaned avatar, bag and passport objects                                                               | RUN-REPORT-9 §7.3, [agreements-and-passport.md §7](../features/agreements-and-passport.md) |
| P10 | **Notification history / per-moment preferences / escalation ladders**                                                          | RUN-REPORT-10 §5.4, [f3-hosted-setup.md §7](../features/f3-hosted-setup.md)                |
| P11 | **Rejected-bag / lost-bag exception flows** — manual overrides via `/exceptions` for now                                        | PROJECT-STATUS row 17 (💤)                                                                 |
| P12 | **Seal technology decision** (RFID vs printed QR) — `bags.seal_id` is opaque, so neither needs a migration                      | PROJECT-STATUS row 18 (💤)                                                                 |
| P13 | **React Native app** — out of scope                                                                                             | PROJECT-STATUS row 20 (💤)                                                                 |
| P14 | **A Playwright harness** — none exists; standing one up is its own slice                                                        | RUN-REPORT-7                                                                               |
| P15 | **`custody_events` SELECT grant** — its subscription has never worked and nothing subscribes                                    | RUN-REPORT-9 §7.3                                                                          |
| P16 | **`X-Robots-Tag: noindex` on `dev.koolee.cloud`** while it serves the live funnel publicly                                      | [ENVIRONMENT.md §6.6](../ENVIRONMENT.md) TODO                                              |
| P17 | **Route optimisation, position history, background GPS, customer-facing driver profiles**                                       | RUN-REPORT-7                                                                               |
| P18 | **`ASSIGNMENT_HORIZON_HOURS` in `apps/agent`** — the app neither assigns nor renders at-risk state                              | RUN-REPORT-10 §5.4                                                                         |

## 5.4 Blocked-external

| #   | Item                                                           | Blocked on                                                                             | Source                                                                         |
| --- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| B1  | Phone verification at scale                                    | Twilio business approval                                                               | [auth.md §2.6](../features/auth.md)                                            |
| B2  | SMS notifications                                              | A2P 10DLC registration                                                                 | [notifications.md §2](../features/notifications.md)                            |
| B3  | The tab-closed push delivery matrix                            | A manual pass in a real Chrome; Chrome-for-Testing subscribes to FCM _preprod_         | RUN-REPORT-10 §5.4                                                             |
| B4  | `notificationclick` focus-or-open                              | Same manual pass — no protocol command clicks a notification                           | RUN-REPORT-10 §5.4                                                             |
| B5  | Whether `ANTHROPIC_API_KEY` reaches the running staging server | One line in Vercel runtime logs: `[ticket-upload] extraction {…"extractor":"claude"…}` | RUN-REPORT-8 §6.5, [f1-hosted-setup.md §1](../features/f1-hosted-setup.md)     |
| B6  | Turnstile widget mode (Managed vs Invisible)                   | A Cloudflare dashboard setting; docs and deployment disagree                           | PROJECT-STATUS row 24, [f1-hosted-setup.md §2](../features/f1-hosted-setup.md) |
| B7  | Legal review of the agreement body and `/terms`                | Counsel                                                                                | §3.4                                                                           |

---

# 6. Gaps & risks — **judgement, separated from facts**

Everything above is observation. Everything below is my read of it. One line of
claim, one line of evidence.

**6.1 — `EtaEstimator.estimate` is synchronous, and a Routes API is not.**
Making it `Promise<EtaRange>` touches all five consumers in §1.2 — including
`toCandidate`, which is called inside an `Array.map` over the shortlist
([driver-selection.ts:243](../../packages/core/src/services/driver-selection.ts#L243)) and
would become four network calls per page render unless batched. Evidence:
[eta.ts:29](../../packages/core/src/geo/eta.ts#L29).

**6.2 — Autocomplete will make the ZIP-mismatch dialog fire more often, not less.**
Today a customer types a ZIP and usually types the one they were quoted for. An
autocomplete suggestion supplies an _authoritative_ ZIP, which will disagree with
a hand-typed quoted ZIP more often — and confirming the change **clears the
already-chosen pickup window** ([actions.ts:387-389](../../apps/web/src/app/book/actions.ts#L387-L389)),
sending the customer back a step. Worth deciding whether the flight step should
also use autocomplete so both ZIPs come from the same source.

**6.3 — Once autocomplete ships, repeat addresses will never gain real coordinates.**
`ensureAddress` returns the existing row at
[customers.ts:297](../../packages/core/src/services/customers.ts#L297), before the
coordinate branch at line 299. A customer booking from the same home address a
second time keeps the ZIP centroid forever, and `place_id` stays null, so the
driver's map link stays a free-text search. The dedupe key is
`(user_id, line1, zip)` — it ignores `line2` and `city` — so this also collapses
two apartments at one street address into one row.

**6.4 — The public price quote and the funnel price already disagree.**
Marketing prices JFK at 26 km, the funnel at 20
([pricing/actions.ts:31](../../apps/web/src/app/%28marketing%29/pricing/actions.ts#L31) vs
[checkout.ts:127](../../apps/web/src/lib/checkout.ts#L127)); at 45¢/km that is
**$2.70** on a JFK trip, in the direction of the estimator quoting _higher_.
Threading a real distance in Tier 5 closes the gap, but it also changes every
price — including the marketing page's, which is a **mirrored copy** of the rule
([pricing/actions.ts:11-15](../../apps/web/src/app/%28marketing%29/pricing/actions.ts#L11-L15))
and will drift again the moment the DB rule is tuned.

**6.5 — `SENTRY_DSN` is server-only, so half of Sentry has no variable.**
The schema entry is `SENTRY_DSN`, not `NEXT_PUBLIC_SENTRY_DSN`
([web/env.ts:212](../../apps/web/src/env.ts#L212)), and Next only inlines
`NEXT_PUBLIC_*`. Browser-side capture needs a new public variable in all three
apps. Compounding it: `ENVIRONMENT.md §6.6` lists `SENTRY_DSN` as one of four
_"shared read-only keys"_ exempt from the two-rows-per-scope rule — which, if
followed, merges preview and production errors into one Sentry project.

**6.6 — `pnpm seed` is a destructive operation on a launched database, and the
docs tell you to run it.**
It resets all 128 cutoff rows to 45/60 and overwrites `source`
([seed.ts:247-252](../../packages/db/src/seed.ts#L247-L252)) and rewrites the active
pricing rule field-by-field ([seed.ts:281-286](../../packages/db/src/seed.ts#L281-L286)).
`MIGRATIONS.md §9` step 4 says _"Seed reference data if the project is new: `pnpm
seed` … Idempotent"_, and `driver-and-pickup-hosted-setup.md §3` says
_"`DATABASE_URL='<hosted pooled url>' pnpm seed` — Idempotent, as always."_
It is idempotent with respect to _itself_, not with respect to ops's work. This is
the highest-consequence item in the report: L2 can be silently undone by a
routine command that two docs recommend.

**6.7 — The `coming_soon` exemption means launch day is the first time five gates fire.**
`apps/web`'s Gates B and C are both conditioned on `!isComingSoon()`
([env.ts:421](../../apps/web/src/env.ts#L421), [env.ts:452-457](../../apps/web/src/env.ts#L452-L457)).
Production runs `coming_soon` today (PROJECT-STATUS:325-337), so
`NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`,
`OPS_ALERT_EMAIL` and `ANTHROPIC_API_KEY` have **never been enforced there**.
Flipping to `live` arms all five in one redeploy. `f1-hosted-setup.md §1` already
names the mitigation for one of them — _"set the key anyway, so launch day is not
the moment the gate first fires"_ — and the same reasoning applies to the other
four. A rehearsal deploy with `live` on a throwaway preview would surface the
whole set at once.

**6.8 — Nothing gates a production boot on Stripe or `CRON_SECRET`.**
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
and `CRON_SECRET` are all `optionalString` with no assertion (§2.4). A live deploy
missing the publishable key renders the pay step as `"misconfigured"`
([core.ts:55-58](../../apps/web/src/lib/core.ts#L55-L58)) — which is honest, but it
is discovered by a customer rather than by the boot. Missing `CRON_SECRET` is
worse: `/api/jobs/*` 503s and the Inngest cron still runs, so the only visible
symptom is money that never arrives.

**6.9 — `/zones` cannot assign zones to a driver who is not an agent.**
The page lists `listActiveAgents`, which filters `role = 'agent'`
([dispatch.ts:69](../../packages/core/src/services/dispatch.ts#L69)), while driver
eligibility keys on `can_drive`
([driver-selection.ts:166](../../packages/core/src/services/driver-selection.ts#L166)).
`setCanDriveAction` takes any `userId` with a staff row
([shifts/actions.ts:93-120](../../apps/admin/src/app/shifts/actions.ts#L93-L120)) and
`staff_members.role` admits `admin`. An admin granted `can_drive` can open a
shift and be offered to customers, but has no way to be given zones — so they
would appear **only** through the widening fallback. Narrow today (v1 is one
person doing both jobs), but it is a silent downgrade rather than an error.

**6.10 — Migration/deploy parallelism plus a Maps-shaped schema change is a live hazard.**
`MIGRATIONS.md §9.5` warns that the migrate workflow and the Vercel deploy race.
Tier 5 will likely want new columns (a formatted address, a `place_id` on the
draft, possibly a coordinate source). Those are additive and safe — but any
_narrowing_ (e.g. making `addresses.lat/lng` NOT NULL after a backfill) must not
ride that workflow.

**6.11 — `withSentryConfig` must not eat the `/sw.js` headers.**
All three `next.config.mjs` files export a bare object with an `async headers()`
that is the only reason web push works ([f3-hosted-setup.md §4](../features/f3-hosted-setup.md),
step 4 of the smoke test). The wrap is mechanically simple — there is no other
plugin to compose with (§2.5) — but the failure mode is silent, and the existing
smoke test is the only thing that would catch it.

**6.12 — Three apps, three Sentry decisions, and no `global-error.tsx` anywhere.**
Whether prod and preview share one project (§6.5), whether the three apps share
one or take three, and where the root-render capture point lives are all still
open. The `error.tsx` files already receive `error & { digest }` and are one
`Sentry.captureException` line from being instrumented (§2.3) — the missing piece
is the root boundary, not the route ones.

**6.13 — B1 has been open since 2026-08-28 and Tier 5 is where it stops being deferrable.**
PROJECT-STATUS:202-206 says hosted migration state _"is documented as done but
has never been verified from a shell."_ Twelve migrations have landed since the
last verified hosted state (§4.2), one of which drops three tables. A launch
cutover that has not run `db:status` against prod is a cutover working from prose.

---

## What was and was not touched

|                                        |                                                             |
| -------------------------------------- | ----------------------------------------------------------- |
| Databases contacted                    | **none** — not local, not `koolee_test`, not hosted         |
| Commands that wrote anything           | **one**: creating this file                                 |
| Migrations                             | none generated, none applied                                |
| Commits                                | none                                                        |
| ALLOWED CHECK (`db:status` vs staging) | **skipped** — no staging connection in the shell env (§4.2) |

Everything above was established by reading files in the checkout and by
`grep` / `find` / `wc` / one `node -e` parse of a literal in `seed.ts`.
