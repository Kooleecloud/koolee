# Run report 8 — Slice F1: bug fixes and terminal-state gates

**Branch:** `fix/f1-gates-and-bugs`, cut from `origin/dev` @ `499e835` with
`--no-track` (`branch.fix/f1-gates-and-bugs.merge` verified empty,
`git status -sb` shows no upstream). **No commits are made by this session** —
every phase below is checkpointed here and TD commits after review.

**One session, one branch.** No parallel sessions.

**Databases touched: LOCAL ONLY.** `127.0.0.1:54322` for migrations and the
seed, the disposable `koolee_test` for the integration tier. Hosted is never
contacted; no `DIRECT_DATABASE_URL` override is ever set.

**Out of scope (Slice F2):** realtime, the notifications matrix, the
upload-first funnel redesign, profiles/photos, task grouping and history
views. Nothing below touches those surfaces beyond what the gates require.

---

## Phase 0 — Ticket extraction: diagnosis only

TD's report, from staging: **multi-leg itineraries extract only one leg; the
traveler name is wrong; flight times are wrong. Works on local, fails hosted.**

No fixes are made in this phase. What follows is reproduction, isolation and
a proposed fix plan.

### 0.1 The fixture set

`docs/fixtures/failing-tickets/` does not exist in the checkout, so the set is
four real documents TD already has plus seven synthetic itineraries built with
the existing `makePdf` helper, plus one image rendered from a synthetic PDF to
exercise the vision path. Twelve documents in all.

| Fixture                         | What it is                                                                                                            | Expected legs | Expected chosen leg                                                |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------ |
| `real-yatra-round-trip.pdf`     | The real Yatra e-ticket (27 KB). Return leg printed FIRST in the text layer; durations printed beside departure times | 2             | EWR→DEL, `AI144`, 2017-12-12T13:15                                 |
| `real-multi-serviced-legs.pdf`  | Air India multi-city, TWO New York departures (JFK and EWR)                                                           | 2             | ambiguous — JFK→LHR `AI191` 2026-12-18T09:40, with EWR→CDG offered |
| `real-ua1189.pdf`               | United receipt, **SFO→JFK** — arrives in New York, departs somewhere we do not serve                                  | 1             | none; `no_serviced_origin`, origin SFO                             |
| `real-ua1189-generated.pdf`     | United receipt, JFK→SFO, one leg                                                                                      | 1             | JFK→SFO `UA1189` 2026-08-04T17:45                                  |
| `syn-round-trip.pdf`            | Round trip JFK→LAX / LAX→JFK, with a **purchaser** line and an **issue date** printed above the departure date        | 2             | JFK→LAX `DL411` 2026-09-14T07:45                                   |
| `syn-connecting-legs.pdf`       | Connecting legs EWR→ORD→SFO, same day                                                                                 | 2             | EWR→ORD `UA1189` 2026-10-03T06:15                                  |
| `syn-multi-city.pdf`            | JFK→LHR→CDG→EWR, three legs, three airlines                                                                           | 3             | JFK→LHR `BA178` 2026-11-14T19:30                                   |
| `syn-open-jaw.pdf`              | JFK out, MIA→EWR back, then a second EWR departure                                                                    | 3             | ambiguous — two serviced origins                                   |
| `syn-reversed-print-order.pdf`  | Yatra layout compressed: return leg first, durations beside times                                                     | 2             | EWR→DEL `AI144` 2026-12-15T13:15                                   |
| `syn-purchaser-vs-traveler.pdf` | Cardholder, loyalty-programme member and passenger are three different people                                         | 1             | JFK→NRT `NH9` 2026-09-30T11:05, pax **Yuki Nakamura**              |
| `syn-no-text-layer.pdf`         | A PDF with no text layer (the scanned-ticket case)                                                                    | 0             | unreadable                                                         |
| `syn-round-trip.png`            | `syn-round-trip.pdf` rendered to PNG — a photographed ticket                                                          | 2             | same as `syn-round-trip.pdf`                                       |

### 0.2 Reproduction — the two extractors, same twelve documents

Both extractors were run against every fixture with full diagnostics captured.
`legs` is `diagnostics.segments.length`, `alts` is
`result.alternativeSegments.length`, `conf` is the reported confidence.

**`HeuristicTicketExtractor` — the no-API-key path:**

```
fixture                        status      legs  alts  apt  flight  departure          pax                          conf
real-multi-serviced-legs.pdf   extracted   -     0     JFK  AI191   2026-12-18T09:40   Dana Whitfield Booking Ref   high
real-ua1189-generated.pdf      extracted   -     0     JFK  UA1189  2026-08-04T17:45   Jordan Alvarez               high
real-ua1189.pdf                extracted   -     0     -    UA1189  2026-07-25T08:15   Alex Mr Traveler             low
real-yatra-round-trip.pdf      extracted   -     0     EWR  UA2     2018-01-06T15:30   Basis. In Case Of            low
syn-connecting-legs.pdf        extracted   -     0     EWR  UA1189  2026-10-03T06:15   Karun Rathi                  high
syn-multi-city.pdf             extracted   -     0     JFK  BA178   2026-11-14T19:30   Adaeze Okonkwo               high
syn-no-text-layer.pdf          unreadable  -     -     -    -       -                  -                            -
syn-open-jaw.pdf               extracted   -     0     JFK  AA1420  2026-12-02T08:00   Wei Ms Chen                  low
syn-purchaser-vs-traveler.pdf  extracted   -     0     JFK  NH9     2026-09-30T11:05   Yuki Ms Nakamura             high
syn-reversed-print-order.pdf   extracted   -     0     EWR  -       2027-01-09T15:30   -                            high
syn-round-trip.pdf             extracted   -     0     JFK  DL411   2026-08-12T07:45   Jordan Mr Alvarez            high
syn-round-trip.png             unreadable  -     -     -    -       -                  -                            -
```

**`ClaudeTicketExtractor` — the API-key path (what local runs):**

```
fixture                        status      legs  alts  apt  flight  departure          pax                  conf  reason
real-multi-serviced-legs.pdf   extracted   2     1     JFK  -       2026-12-18T09:40   Dana Whitfield       low   ambiguous_serviced_origins
real-ua1189-generated.pdf      extracted   1     0     JFK  UA1189  2026-08-04T17:45   Jordan Alvarez       high  single_serviced_origin
real-ua1189.pdf                extracted   1     0     -    -       -                  Alex Traveler        low   no_serviced_origin
real-yatra-round-trip.pdf      extracted   2     0     EWR  AI144   2017-12-12T13:15   Karun Rathi          high  single_serviced_origin
syn-connecting-legs.pdf        extracted   2     0     EWR  UA1189  2026-10-03T06:15   Karun Rathi          high  single_serviced_origin
syn-multi-city.pdf             extracted   3     0     JFK  BA178   2026-11-14T19:30   Adaeze Okonkwo       high  single_serviced_origin
syn-no-text-layer.pdf          unreadable  0     -     -    -       -                  -                    -     no_segments
syn-open-jaw.pdf               extracted   3     1     JFK  AA1420  2026-12-02T08:00   Wei Chen             low   ambiguous_serviced_origins
syn-purchaser-vs-traveler.pdf  extracted   1     0     JFK  -       2026-09-30T11:05   Yuki Nakamura        high  single_serviced_origin
syn-reversed-print-order.pdf   extracted   2     0     EWR  AI101   2026-12-15T13:15   Karun Rathi          high  single_serviced_origin
syn-round-trip.pdf             extracted   2     0     JFK  DL411   2026-09-14T07:45   Jordan Alvarez       high  single_serviced_origin
syn-round-trip.png             extracted   2     0     JFK  DL411   2026-09-14T07:45   Jordan Alvarez       high  single_serviced_origin
```

### 0.3 Root cause — the extractor is not the same one in both environments

`resolveExtractionConfig()`
([apps/web/src/lib/core.ts:62](../../apps/web/src/lib/core.ts#L62)) is the
whole switch:

```ts
const apiKey = optionalEnv("ANTHROPIC_API_KEY");
return apiKey ? { kind: "claude", apiKey } : { kind: "heuristic" };
```

`ANTHROPIC_API_KEY` is **optional** in `apps/web/src/env.ts` and documented in
[docs/ENVIRONMENT.md](../ENVIRONMENT.md) §3 as `○` — "Absent → the free
in-process heuristic extractor". `apps/web/.env.local` sets it, so **local
runs Claude**. Nothing fails, warns, or shows in any UI when it is unset:
uploads still succeed, still say "extracted", and still prefill the form.

**Every one of TD's three symptoms is a property of the heuristic extractor,
and the table above reproduces all three:**

1. **"multi-leg itineraries extract only one leg."** The heuristic returns a
   flat single-leg `TicketExtractionResult` and **no `diagnostics` at all** —
   `legs` is blank on every row above because
   `HeuristicTicketExtractor.extract` never constructs a
   `TicketExtractionDiagnostics`. It also produced `alts=0` on all twelve
   documents, including `real-multi-serviced-legs.pdf`, which genuinely has
   two New York departures, and `syn-open-jaw.pdf`, which has two. The Claude
   path found 2/2, 3/3 and 2/2 legs on those same files and offered the
   alternative leg on both ambiguous ones. There is nothing in the heuristic
   that can report a second leg: `parseTicketTextHeuristics` sets exactly one
   `departureAirport`/`flightNumber`/`departureAtLocal` and returns.

2. **"traveler name wrong."** `PAX_RE`
   ([heuristic/extractor.ts:48](../../packages/core/src/extraction/heuristic/extractor.ts#L48))
   matches the word `PASSENGER` and then takes the next 2–4 capitalised words
   out of the **uppercased** document, so it cannot tell a name from a heading:
   - `real-yatra-round-trip.pdf` → `"Basis. In Case Of"` (it matched the
     phrase "…per passenger basis. In case of amendment…" in the cancellation
     terms);
   - `real-multi-serviced-legs.pdf` → `"Dana Whitfield Booking Ref"` (the name
     plus the label printed after it);
   - `real-ua1189.pdf` → `"Alex Mr Traveler"`, `syn-round-trip.pdf` →
     `"Jordan Mr Alvarez"`, `syn-purchaser-vs-traveler.pdf` →
     `"Yuki Ms Nakamura"` — the title is never stripped and lands in the
     middle of the reordered name.

   Claude returned the correct name on **all eleven** readable fixtures,
   including the one where the cardholder, the loyalty member and the
   passenger are three different people.

3. **"flight times wrong."** Two independent defects, both visible above:
   - **A duration is read as a clock time.** `TIME_RE` runs over the whole
     document when the `DEPART…` line carries no time, and e-tickets print
     `15:30 Hrs` (a duration) beside the route header. `real-yatra-round-trip`
     → `15:30`; `syn-reversed-print-order` → `15:30`. Both are durations. This
     is the exact failure the Claude prompt was written to prevent
     ([claude/extractor.ts:129](../../packages/core/src/extraction/claude/extractor.ts#L129)),
     and the heuristic has no such guard.
   - **The date and the time come from different rows.** The date is the
     _first_ date anywhere in the document and the time is the _first_ time
     anywhere, with no requirement that they belong to the same leg or even to
     a leg at all. `syn-round-trip.pdf` → `2026-08-12T07:45`: **August 12 is
     the issue date**, 07:45 is the September 14 departure time.
     `real-ua1189.pdf` → `2026-07-25T08:15`: July 25 is the date of issue.
     `real-yatra-round-trip` and `syn-reversed-print-order` both take the
     **return** leg's date with the outbound leg's origin.

   Where no time is found at all the code writes `pad(hh ?? 12)` — a silent
   midday guess — and the result still reports `confidence: "high"`.

The heuristic reports `confidence: "high"` on **7 of 10** documents it read,
including every one of the wrong answers above. It is not an honest fallback;
it is a confident one.

### 0.4 The local-vs-hosted delta, enumerated

| #   | Candidate difference                                                               | Verdict                                                     | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **`ANTHROPIC_API_KEY` present locally, absent hosted → silent heuristic fallback** | **PRIME SUSPECT — reproduces all three symptoms**           | §0.2/§0.3 above. `apps/web/.env.local:44` sets it; `env.ts:108` declares it `optionalString`; `core.ts:63` branches on it with no log, no warning and no boot gate. Confirmation that it is unset on `dev.koolee.cloud` is TD's to give (§0.6)                                                                                                                                                                                                                |
| 2   | Model id / version pinning                                                         | **RULED OUT**                                               | `CLAUDE_EXTRACTION_MODEL = "claude-haiku-4-5"` and `CLAUDE_ESCALATION_MODEL = "claude-sonnet-5"` are module constants in `claude/extractor.ts:49,56`. Neither is read from env in any app; `grep -rn "EXTRACTION_MODEL\|ESCALATION_MODEL" apps/` returns nothing                                                                                                                                                                                              |
| 3   | Prompt / tool-schema drift between environments                                    | **RULED OUT**                                               | `ITINERARY_TOOL` and `buildPrompt` are module constants. The only value that varies with the environment is `today`, and it feeds `selectSegment`'s "has this leg already flown?" test only — see #9                                                                                                                                                                                                                                                          |
| 4   | PDF-text path vs vision path selection                                             | **RULED OUT as an independent cause; it IS #1**             | The two paths are the two extractors. `ClaudeTicketExtractor.documentBlock` always sends the raw bytes as a `document`/`image` block and never runs `unpdf`; `HeuristicTicketExtractor` always runs `unpdf` and **refuses images outright** (`syn-round-trip.png` → `no text extraction for image/png yet`). A customer who photographs a ticket gets nothing at all on the heuristic path and a correct read on the Claude path                              |
| 5   | File size / downscale limits                                                       | **RULED OUT**                                               | `MAX_TICKET_UPLOAD_BYTES = 10 * 1024 * 1024` is a constant in `uploads/buckets.ts:46`, enforced identically in `handleTicketUpload`. No env var, no per-environment override. Migration 0026 sets the bucket's own limit from the same constant                                                                                                                                                                                                               |
| 6   | `TICKET_EXTRACTION_DEBUG`                                                          | **RULED OUT as a cause; it is why staging is opaque**       | `route.ts:84` uses it only to decide whether `diagnostics` is echoed to the browser. It is `1` in `apps/web/.env.local:66`. It does not touch extraction — but with it unset on staging there is no way to see which extractor ran, which is how this went unnoticed                                                                                                                                                                                          |
| 7   | API version header                                                                 | **RULED OUT**                                               | The SDK sets `anthropic-version` itself; no override anywhere, no env var                                                                                                                                                                                                                                                                                                                                                                                     |
| 8   | Streaming vs non-streaming                                                         | **RULED OUT**                                               | `client.messages.create` non-streaming on both passes, in code, in both environments                                                                                                                                                                                                                                                                                                                                                                          |
| 9   | Truncation of long documents                                                       | **NOT the reported bug; a real multi-leg hazard**           | `MAX_OUTPUT_TOKENS = 4096`, and the escalation pass sets `thinking: { type: "adaptive" }` — thinking tokens are drawn from the same budget. Highest observed output on the fixtures was 525 tokens, so nothing here truncated; a long multi-city itinerary that escalates could. Identical in both environments, so it is not the local/hosted delta                                                                                                          |
| 10  | **Vercel serverless `maxDuration`**                                                | **NOT the reported bug; a real hosted-only hazard**         | `apps/web/src/app/api/ticket-uploads/route.ts` exports no `maxDuration`. Measured extraction latency on the fixtures: 2.3 s–8.1 s, and the escalation path is the slow end (`real-multi-serviced-legs` 5.7 s, `syn-open-jaw` 8.1 s) — before the multipart read, the Storage write and two DB round-trips. The Vercel default is 10 s. A timeout shows as a failed upload, not as wrong data, so it does not explain TD's symptom; it is worth closing anyway |
| 11  | `@anthropic-ai/sdk` dynamic import under Next's bundler                            | **RULED OUT as the cause**                                  | `getClient()` does `await import("@anthropic-ai/sdk")` inside `runPass`'s `try`. If it failed on hosted, both passes would set `attempt.error` and `finish()` would return `unreadable` — the "we couldn't read this, enter manually" path. TD reports **wrong values**, not a failure to read. (`next build` tracing is verified in the Phase 1 gate regardless)                                                                                             |
| 12  | Server timezone (hosted UTC vs TD's local zone)                                    | **RULED OUT for the reported times; one real minor defect** | See §0.5                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

### 0.5 The three targeted tests the prompt asked for

**(a) Does the schema/prompt allow an array of legs, or force one?**

Split answer.

- **Claude path: yes, and it is the whole design.** `ITINERARY_TOOL.input_schema`
  declares `segments` as an `array` with `required: ["segments", "documentKind"]`,
  the prompt says "record EVERY flight segment … do not pick a favourite", and
  `selectSegment` makes the choice deterministically afterwards. The fixtures
  confirm it: 2, 2, 3, 3, 2 legs read on the five genuinely multi-leg documents.
- **Heuristic path: no. It structurally cannot report more than one leg.**
  `parseTicketTextHeuristics` returns a flat `TicketExtractionResult` with one
  airport, one flight number, one time, and `HeuristicTicketExtractor.extract`
  returns **no diagnostics object at all**, so `segments` and `chosenIndex` are
  absent rather than empty.
- **Review form: partial, by design, and it is the surface TD sees.**
  `alternativesFor()`
  ([ticket-upload-handler.ts:190](../../apps/web/src/lib/ticket-upload-handler.ts#L190))
  keeps only legs **departing JFK/LGA/EWR** and caps them at **2**;
  `selectSegment`'s own `alternatives` are already filtered to serviced origins
  before that. So on `syn-multi-city.pdf` (JFK→LHR→CDG→EWR) the model reads
  three legs and the customer is shown one, with no indication the document had
  three. That is defensible for the _swap offer_ — we cannot collect bags at
  CDG — but it is why "only one leg" is a fair description of what the customer
  sees even when extraction worked.

**(b) Are times reinterpreted through the server timezone?**

No, on the path that matters. `submitFlight`
([book/actions.ts:253](../../apps/web/src/app/book/actions.ts#L253)) converts
the form's wall clock with `airportLocalDateTime(departureAtLocal, airportTz)`,
which builds a `TZDate` in the **airport's** zone; the flight step renders it
back with `formatDateTimeLocalInAirportTz`. Both are documented in
[docs/TIME.md](../TIME.md) and carry the comment naming the exact bug they
exist to prevent ("`new Date("2026-09-01T18:30")` … the runtime applies the
SERVER's"). `grep -rn "new Date(" ` over the flight path finds no bare parse of
a wall-clock string. Extraction itself never parses a date into a `Date`:
`select-segment.ts` compares `YYYY-MM-DD` **as strings**, deliberately.

**One real defect, minor and not the reported one:** `todayUtc(now)`
([select-segment.ts:314](../../packages/core/src/extraction/select-segment.ts#L314))
takes the **UTC** date as the "has this leg already flown?" anchor. Between
20:00 and 24:00 New York time, UTC is already tomorrow, so a leg departing
later today is classified as past. On a round trip that flips
`earliest_upcoming_serviced_origin` (high confidence) to
`all_serviced_departures_past` (low confidence) and can pick the wrong leg.
It is a genuine hosted/local divergence in _behaviour near midnight_, it is
airport-local-time-rule non-compliance per §7, and it is worth fixing — but it
cannot produce a wrong _time_ on a leg, only a wrong _choice_ of leg, and only
inside a four-hour window. Listed for Phase 1.

**(c) Is the review form picking the wrong name field?**

No. The form maps `prefill.paxName` → the `paxName` input, one field, one hop:
`result.paxName` → `TicketPrefill.paxName`
([ticket-upload-handler.ts:170](../../apps/web/src/lib/ticket-upload-handler.ts#L170))
→ `paxNameDefault` ([flight/page.tsx:81](../../apps/web/src/app/book/flight/page.tsx#L81)).
There is no purchaser or loyalty field anywhere in the schema to confuse it
with. The wrong name is produced by the **extractor**: `syn-purchaser-vs-traveler.pdf`
prints a cardholder (Daniel Okoye), a loyalty member (Helena Okoye) and a
passenger (Yuki Nakamura), and Claude returned **Yuki Nakamura** while the
heuristic returned **"Yuki Ms Nakamura"** — right person, mangled string.
The heuristic's other failures (§0.3) are heading text, not the wrong person.

### 0.6 Two defects found in the CLAUDE path as well

Both are real, both are reproducible in the table above, and neither depends
on the hosted environment.

**Defect 1 — a flight number printed with a space is silently dropped.**
The model routinely splits `AI 191` into `airlineIata: "AI"` and
`flightNumber: "191"`. `normalizeSegment` tests the bare digits against
`FLIGHT_RE` and discards them:

```
real-multi-serviced-legs.pdf   dropped segments[0].flightNumber = "191"
real-multi-serviced-legs.pdf   dropped segments[1].flightNumber = "256"
real-ua1189.pdf                dropped segments[0].flightNumber = "1189"
syn-purchaser-vs-traveler.pdf  dropped segments[0].flightNumber = "9"
```

**Four of the twelve fixtures lose the flight number entirely** — the field the
airline-cutoff table is keyed by, and the field the customer is least likely to
notice is missing on a form that has already filled in everything else. The
airline code is right there in the same object.

**Defect 2 — one leg's flight number is reused for another on a scrambled
layout.** `syn-reversed-print-order.pdf` comes back with `AI101` on **both**
segments, at `confidence: "high"`, while the model's own `readingNotes` on the
same response says "The outbound flight (AI-144, Newark to Delhi …)". The
chosen leg therefore carries the correct origin and time with the **wrong
flight number**. The real Yatra PDF got this right (`AI144`), so it is a
layout-sensitivity, not a constant failure — but nothing in the prompt binds a
flight number to the row it is printed on.

### 0.7 Blocked on staging evidence

The one fact this session cannot establish from the checkout is **whether
`ANTHROPIC_API_KEY` is actually set on the `dev.koolee.cloud` Vercel scope.**
There is no Vercel CLI on this machine and no credential in the repo. What
would settle it, in order of preference:

1. **`vercel env ls preview`** (or the Vercel dashboard → Project → Settings →
   Environment Variables) for the web project — names only, no values needed.
   The presence or absence of `ANTHROPIC_API_KEY` in the Preview scope is the
   entire question.
2. **The server log line for one failing upload.**
   `handleTicketUpload` already writes one structured line per upload
   (`[ticket-upload] extraction {...}`) containing `"extractor"` — it reads
   `"heuristic"` or `"claude"`. Vercel → the deployment → Runtime Logs, filter
   `[ticket-upload]`. This is conclusive on its own.
3. **Debug-panel output for a failing upload.** Set
   `TICKET_EXTRACTION_DEBUG=1` on the **preview** scope only (never
   production — the payload contains the customer's itinerary), re-upload the
   failing ticket, and copy the panel. It shows `extractor`, every segment
   read, `chosenIndex`, `selectionReason` and `droppedFields`.

Phase 1 proceeds on the causes proven locally and does not wait on this: the
fix for #1 is to make the degrade impossible to happen silently, which is
correct whatever the current answer is.

### 0.8 Proposed fix plan (Phase 1)

| #   | Fix                                                                                                                                                                                                                                                                                                                   | Proven by               | Where                                                                                |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------ |
| 1   | **Fail-closed production boot gate on `ANTHROPIC_API_KEY`**, matching the `RESEND_API_KEY`/`OPS_ALERT_EMAIL` gate exactly (same exemptions: coming-soon, no Supabase, build phase)                                                                                                                                    | §0.3, §0.4 #1           | `apps/web/src/env.ts`                                                                |
| 2   | **Name the extractor in the boot diagnostics and in the upload log**, so "which extractor ran?" is answerable without a debug flag                                                                                                                                                                                    | §0.4 #6                 | `apps/web/src/lib/core.ts`, `apps/web/src/env.ts`                                    |
| 3   | **Compose a digits-only flight number with the airline code** in `normalizeSegment` instead of dropping it                                                                                                                                                                                                            | §0.6 defect 1           | `packages/core/src/extraction/select-segment.ts`                                     |
| 4   | **Bind the flight number to its own row** in the tool schema and prompt; require the designator in the value                                                                                                                                                                                                          | §0.6 defect 2           | `packages/core/src/extraction/claude/extractor.ts`                                   |
| 5   | **Rewrite the heuristic as a segment extractor** sharing `selectSegment` and emitting real diagnostics: legs as an array, a departure time that must come from the same row as its date, durations (`NN:NN Hrs`) refused, issue/booking dates refused, titles stripped from names, and **never `confidence: "high"`** | §0.3 all three symptoms | `packages/core/src/extraction/heuristic/extractor.ts`                                |
| 6   | **Render every extracted leg on the review form**, with the non-serviced ones shown read-only ("this ticket also has LHR → CDG — we collect bags in New York only") and the serviced ones as the existing one-click swap                                                                                              | §0.5 (a)                | `apps/web/src/lib/ticket-upload-handler.ts`, `apps/web/src/app/book/flight/page.tsx` |
| 7   | **Anchor "has this leg flown?" to airport-local time**, not UTC                                                                                                                                                                                                                                                       | §0.5 (b)                | `packages/core/src/extraction/select-segment.ts`                                     |
| 8   | **Set `maxDuration` on the upload route** to cover the escalation path                                                                                                                                                                                                                                                | §0.4 #10                | `apps/web/src/app/api/ticket-uploads/route.ts`                                       |
| 9   | **Fixture-based regression tests** asserting leg count, name and times for every fixture, with the fixtures built in code (`makePdf`) rather than committed binaries                                                                                                                                                  | —                       | `packages/core/src/extraction/fixtures.test.ts`                                      |

Model ids and parameters are **already pinned in code** (`claude/extractor.ts:49,56`)
and read from no environment variable — §0.4 #2 needs no change beyond a
comment saying so.

### 0.9 Phase 0 gate

No source file was modified in this phase. Diagnosis was run from two
throwaway scripts under `packages/core/` (`diag-fixtures.mts`, `diag-run.mts`,
`diag-text.mts`), deleted at the end of the session; fixtures live in the
session scratchpad, not in the repo. Gate deferred to Phase 1, which is the
first phase to touch code.

---

## Phase 1 — Ticket extraction: the fixes Phase 0 proved

Nine fixes, each traceable to a numbered finding above. Nothing speculative
was changed: the model ids were already pinned in code (§0.4 #2) and stayed
that way, and the timezone handling on the confirm path was already correct
(§0.5 b) and was not touched.

### 1.1 What landed

| #   | Fix                                                                                                                                                                                     | Where                                                                                                                                                                 | Proven by                |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| 1   | `ANTHROPIC_API_KEY` is a fail-closed **production boot gate**, alongside `RESEND_API_KEY` and `OPS_ALERT_EMAIL`, with the same three exemptions (coming-soon, no Supabase, build phase) | `apps/web/src/env.ts`                                                                                                                                                 | §0.3, §0.4 #1            |
| 2   | The dev status panel stops calling the fallback "out of scope for this scaffold" and says what it actually does                                                                         | `apps/web/src/env.ts`                                                                                                                                                 | §0.4 #6                  |
| 3   | A **digits-only flight number is reassembled** with the airline code beside it instead of being dropped                                                                                 | `packages/core/src/extraction/select-segment.ts`                                                                                                                      | §0.6 defect 1            |
| 4   | The tool schema and prompt **bind a flight number to its own printed row** and require the designator in the value                                                                      | `packages/core/src/extraction/claude/extractor.ts`                                                                                                                    | §0.6 defect 2            |
| 5   | The **heuristic extractor is a segment extractor**, sharing `selectSegment` and `assembleOutcome` with the model adapter, and is never `confidence: "high"`                             | `packages/core/src/extraction/heuristic/extractor.ts` (rewritten), `packages/core/src/extraction/read-result.ts` (new)                                                | §0.3, all three symptoms |
| 6   | The result carries **`legs` + `chosenLegIndex`** — every leg read, including the ones out of airports we do not serve — and the review form renders them                                | `extraction/types.ts`, `read-result.ts`, `apps/web/src/lib/ticket-upload-handler.ts`, `ticket-prefill-copy.ts`, `app/book/flight/page.tsx`, `booking-draft-schema.ts` | §0.5 (a)                 |
| 7   | "Has this leg already flown?" is anchored to **airport-local** time, not UTC                                                                                                            | `packages/core/src/extraction/select-segment.ts`                                                                                                                      | §0.5 (b)                 |
| 8   | `maxDuration = 60` on the upload route                                                                                                                                                  | `apps/web/src/app/api/ticket-uploads/route.ts`                                                                                                                        | §0.4 #10                 |
| 9   | **18 fixture regression tests** across the three symptoms, all built in code                                                                                                            | `packages/core/src/extraction/fixtures.test.ts` (new)                                                                                                                 | —                        |

**No migration. No new environment variable.** Fix 1 makes an EXISTING optional
variable required in production; that is a deploy-config step for TD, recorded
in Phase 6, not a schema change.

### 1.2 The one structural change worth naming

`read-result.ts` is new, and it exists because both adapters were assembling
their own `TicketExtractionResult` and only one of them was doing it
correctly. The heuristic wrote a `departureAirport` straight out of its own
parse and never called `selectSegment` at all — which is _why_ it could not
report a second leg, offer a swap, or distinguish "departs SFO" from "we
couldn't read it". An extractor's job now stops at READING; which leg the
pickup is for, what may reach the airport dropdown, and what is offered as an
alternative are decided once, for every adapter, in `assembleOutcome`.

`cleanPaxName` moved there too, from the Claude adapter, and the heuristic's
own copy — which left the title in the middle of the reordered name
("Jordan Mr Alvarez") — is gone.

### 1.3 The heuristic, before and after, on the same twelve fixtures

```
                               BEFORE                                    AFTER
fixture                        legs  flight  departure          conf     legs  flight  departure          conf
real-multi-serviced-legs.pdf   -     AI191   2026-12-18T09:40   high  →  2     AI191   2026-12-18T09:40   low
real-ua1189-generated.pdf      -     UA1189  2026-08-04T17:45   high  →  1     UA1189  2026-08-04T17:45   low
real-ua1189.pdf                -     UA1189  2026-07-25T08:15   low   →  1     -       -                  low
real-yatra-round-trip.pdf      -     UA2     2018-01-06T15:30   low   →  2     -       -           (unreadable)
syn-connecting-legs.pdf        -     UA1189  2026-10-03T06:15   high  →  2     UA1189  2026-10-03T06:15   low
syn-multi-city.pdf             -     BA178   2026-11-14T19:30   high  →  3     BA178   2026-11-14T19:30   low
syn-open-jaw.pdf               -     AA1420  2026-12-02T08:00   low   →  3     AA1420  2026-12-02T08:00   low
syn-purchaser-vs-traveler.pdf  -     NH9     2026-09-30T11:05   high  →  1     NH9     2026-09-30T11:05   low
syn-reversed-print-order.pdf   -     -       2027-01-09T15:30   high  →  1     -       -           (unreadable)
syn-round-trip.pdf             -     DL411   2026-08-12T07:45   high  →  2     DL411   2026-09-14T07:45   low
syn-no-text-layer.pdf          unreadable                             →  unreadable
syn-round-trip.png             unreadable (images unsupported)        →  unreadable (images unsupported)

names   BEFORE: "Basis. In Case Of" · "Dana Whitfield Booking Ref" · "Alex Mr Traveler"
                "Jordan Mr Alvarez" · "Wei Ms Chen" · "Yuki Ms Nakamura"
        AFTER:  correct on every fixture that yields one, absent on the two it cannot read
```

**Five wrong answers presented as fact → zero.** Every remaining answer is
either correct or honestly `unreadable`. Two documents (the real Yatra e-ticket
and its compressed synthetic twin) now return `unreadable` where they used to
return a wrong flight number and a printed duration as the departure time —
that is the intended trade, and it is exactly the case the boot gate in fix 1
makes unreachable in production.

`real-ua1189.pdf` is worth calling out: it departs **SFO** and arrives JFK.
Both extractors now correctly report `no_serviced_origin`, and the review form
says "This ticket departs SFO" instead of silently offering JFK.

### 1.4 The Claude path, before and after

Same twelve fixtures, live API:

- **Flight numbers recovered on four fixtures** that previously lost them:
  `AI191`, `AI256`, `UA1189`, `NH9` — all cases where the model put the
  designator in `airlineIata` and the digits in `flightNumber` (§0.6 defect 1).
- **`syn-reversed-print-order.pdf` now returns `AI144`, not `AI101`** — the
  outbound leg's own flight number. Fix 4. The model's `readingNotes` had been
  naming AI-144 as the outbound while the tool input said AI101 on both legs.
- Leg counts, names and times: **12 of 12 correct**, up from 8 of 12 with a
  usable flight number.

Latency unchanged (2.1 s–7.7 s; escalation still fires only on the two
genuinely ambiguous documents).

### 1.5 Phase 1 gate

| Gate                                          | Result                                                                                                                                                                                        |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `turbo typecheck`                             | **6/6 pass**                                                                                                                                                                                  |
| `turbo lint`                                  | **6/6 pass** (two real catches on the way: `no-useless-escape`, and the repo's own ban on bare date-fns `format()` — `todayAtServicedAirports` now builds the string from `TZDate`'s getters) |
| `turbo test` (unit)                           | **core 423 passed / 1 skipped · web 89 passed**                                                                                                                                               |
| `pnpm --filter @koolee/core test:integration` | **180 passed / 3 skipped, 20 files** — `koolee_test` only, seed re-run clean                                                                                                                  |
| `pnpm --filter @koolee/web build`             | **pass**                                                                                                                                                                                      |
| Migrations                                    | **none**                                                                                                                                                                                      |

---

## Phase 2 — Funnel ZIP sync

### 2.1 The bug, stated precisely

The funnel takes a ZIP on the **flight step** (`submitFlight`) — that is the
value the coverage answer and the quote are built from — and a full address
two steps later on the **pickup step** (`submitPickup`). `submitPickup` ran
`checkCoverage` on the address ZIP and then wrote `zip: coverage.zip` straight
over the quoted one. Any covered ZIP was accepted, and nothing anywhere told
the customer their quote had moved.

Both ZIPs passing coverage is exactly why nothing complained, and it is not a
cosmetic difference:

- `zip_centroids` gives each ZIP its own coordinate, and that coordinate is
  where every drive-time estimate starts (`HaversineEtaEstimator`,
  `cutoffRiskMonitor`, the customer's driver ETA card);
- `agent_zones` maps ZIP → agent, so auto-assign sends a different person;
- `price()` takes `distanceKm`, which is stubbed at `20` today but is the
  Maps seam's output the moment it is real. The trap is already dug.

### 2.2 What landed

| #   | Thing                                                                                                              | Where                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| 1   | `quotedZip` on the booking draft — the ZIP the price and coverage answer were computed for, kept as its own field  | `apps/web/src/lib/booking-draft-schema.ts`                                            |
| 2   | `submitFlight` records `quotedZip` alongside `zip`                                                                 | `apps/web/src/app/book/actions.ts`                                                    |
| 3   | `submitPickup` reconciles: a mismatch returns `zipMismatch` instead of writing anything                            | `apps/web/src/app/book/actions.ts`                                                    |
| 4   | The inline notice and its two actions                                                                              | `apps/web/src/components/pickup-step-form.tsx`                                        |
| 5   | `CreateBookingInput.quotedZip` — **required**, checked against the pickup address's ZIP before anything is written | `packages/core/src/services/create-booking.ts`                                        |
| 6   | `QuoteZipMismatchError` (`QUOTE_ZIP_MISMATCH`)                                                                     | `packages/core/src/errors.ts`                                                         |
| 7   | Both checkout paths map the error to a message and route back to the pickup step                                   | `apps/web/src/app/book/actions.ts`, `apps/web/src/app/book/pay/actions.ts`            |
| 8   | 3 integration + 6 unit tests                                                                                       | `create-booking.integration.test.ts`, `apps/web/src/app/book/pickup-zip-sync.test.ts` |

**No migration.** The check is derived from two values that already exist —
`addresses.zip` and the ZIP the caller quoted — and nothing is stored.

### 2.3 The reconciliation, as the customer sees it

> This address is in **11201**, but your quote was for **10001**.
>
> [ Update quote to 11201 ] [ Use a different address ]
>
> Updating the quote re-checks coverage and pricing for 11201, and you will
> pick your pickup window again.

"Update quote to …" is a submit button carrying `confirmZipChange=1`, so this
is **one action, not two** — the address the customer already typed is the
address that gets re-quoted, with no state to marshal between actions and no
way for the two to disagree. It re-runs `checkCoverage` on the new ZIP (an
out-of-coverage one is refused with the existing waitlist capture, before
reconciliation is ever reached), sets `quotedZip`, and **clears the chosen
pickup window** — its lead-time price and its drive-time headroom were both
derived from the old location, which is the same reason `submitFlight` clears
the window when the flight moves.

"Use a different address" is a link back to `/book/pickup`, which re-renders
seeded from the draft — i.e. from the ZIP the quote is still for.

### 2.4 Why the server check is required, not optional

`quotedZip` is a **required** field on `CreateBookingInput`. A caller that
cannot say which ZIP it quoted has not established that the quote and the
address are the same place, and making it optional would let exactly that
caller through silently. The type change rippled into fifteen test files,
which is the ripple working: every one of them had to state the ZIP its
booking was quoted for.

The check normalizes to five digits, so `10001-2345` and `10001` are one
place — a customer whose autofill adds the +4 must not be told their address
moved.

The UI in §2.3 makes the error unreachable through the funnel. It is still
enforced in core because a server action stays a reachable POST whatever the
form renders — the same reasoning as the identity gate in §7.

### 2.5 Phase 2 gate

| Gate                                          | Result                                                                                                          |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `turbo typecheck`                             | **6/6 pass**                                                                                                    |
| `turbo lint`                                  | **6/6 pass**                                                                                                    |
| `turbo test` (unit)                           | **core 423 · web 95 · ui 85 · admin 27 · agent 12**                                                             |
| `pnpm --filter @koolee/core test:integration` | **183 passed / 3 skipped, 20 files** (was 180 — the three new ZIP cases), `koolee_test` only, seed re-run clean |
| `pnpm --filter @koolee/web build`             | **pass**                                                                                                        |
| Migrations                                    | **none**                                                                                                        |

---

## Phase 3 — Terminal-state and lateness gates (core)

### 3.1 The single source of truth

`packages/core/src/services/actionability.ts`. One object, five consumers, no
scattered date math.

Before it, five services each carried their own status array and **none of
them knew about time at all**. `paid` is `paid` whether the flight leaves in
three days or left an hour ago, so a booking past its bag-drop cutoff would
still accept an agreement, still take a passport upload, and still render the
customer a shortlist of drivers to choose between.

The object has **two independent axes**, deliberately not collapsed into one
enum:

- **standing** — `active` · `in_transit` · `handed_over` · `exception` ·
  `terminal`
- **phase** — `before_window_end` · `running_late` · `missed_cutoff` ·
  `departed`

Collapsing them loses the case the product cares about most: an
`agent_assigned` booking twenty minutes past its pickup window is late and
completely salvageable; the same booking twenty minutes past its bag-drop
cutoff is not. Same standing, different phase, opposite answers.

Anchors: `pickupWindowEnd`, the bag-drop cutoff (`computeBagDropCutoffAt` over
the **strictest** row across both scopes — bookings do not persist
domestic/international, and the looser row is a deadline that runs late), and
`departureAt`. All three are **instants**, compared as instants, which is
zone-free and therefore correct by construction. Nothing in the module formats
a time, which is why nothing in it needs a zone — rendering is Phase 4's job
and happens in the BOOKING's zone per docs/TIME.md.

Two functions, on purpose:

- `bookingActionability(subject, now)` — pure, no database. Every rule is a
  claim about time and ought to be provable without one.
- `getBookingActionability(db, booking, now)` — the thin part that fetches the
  one value a booking row does not carry.
- `assertActionable(config, booking, action, actor?)` — the enforcement.

### 3.2 The matrix as implemented

| Row                                                                                                                                                                   | Implemented      | Note                                                                                                                                                                                                           |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `canceled` — customer view only; agent/driver closed; admin unaffected                                                                                                | **as specified** | Status is spelled `cancelled` in the enum (`BookingStatus`), so the report and the code differ by one letter, not by meaning                                                                                   |
| `complete` / `delivered_to_bagdrop` onward — view + history; driver's own `complete` confirmation still available                                                     | **as specified** | The gate names **five** actions rather than exposing one boolean, and `confirmAirlineHandover` is not one of them — which is exactly what leaves the driver's confirmation working from `delivered_to_bagdrop` |
| `exception` — unchanged, gates must not block admin resolution                                                                                                        | **as specified** | The five gated actions are the customer's and the crew's. Ops resolves through `applyTransition` (`resume_transit` / `force_complete` / `cancel`), which this never touches. Integration-tested                |
| BEFORE pickup window end — everything as today                                                                                                                        | **as specified** |                                                                                                                                                                                                                |
| AFTER window end, BEFORE cutoff — "late but savable": customer MAY accept/upload, driver selection allowed, agent MAY run the visit, all three surfaces show a notice | **as specified** | The two customer actions are the ones that unblock a late visit; blocking them would refuse the rescue                                                                                                         |
| AFTER cutoff, bags not at bag drop — all forward actions block, clear message, exception raised exactly once, in-flight physical work carved out                      | **as specified** | Exactly-once and the carve-out are both mechanical — see §3.3                                                                                                                                                  |
| AFTER scheduled departure — same as missed, wording reflects departure                                                                                                | **as specified** |                                                                                                                                                                                                                |

**One entry adjusted, with evidence.** A booking with **no cutoff on record**
has no `missed_cutoff` phase at all — only `departed`. The instinct is to fall
back to something strict and it is wrong here: every other "be conservative"
rule in this codebase moves a _deadline_ earlier, which costs the customer
nothing, whereas this would move a _refusal_ earlier, which costs them their
pickup. We do not claim a deadline passed when we do not know the deadline,
and departure — which we do know — still catches the genuinely missed flight.
(`Unknown airline cutoff ⇒ refuse to sell` means such a booking should not
exist; this is what happens if a cutoff row is retired underneath one that
already does.) Pinned by two tests.

### 3.3 Two mechanical properties, not bookkeeping

**Exactly-once, without counting.** A blocked attempt raises the exception
through `applyTransition`, whose update is guarded `WHERE status = from`. The
second concurrent attempt loses the race and writes no custody event; and once
the row IS `exception`, `raisesException` is false for every attempt after it.
Both paths are integration-tested — sequential (three attempts) and concurrent
(`Promise.allSettled` on two). The emit stays `applyTransition`'s job, per the
standing rule about never re-adding an emit at a call site.

**The in-transit carve-out, without a special case.** The five gated actions
all belong to the phase BEFORE custody transfers. The driver's own steps —
`scanSealAtPickup`, `deliverToBagdrop`, `confirmAirlineHandover` — call none of
them, so a van already moving keeps moving with no exemption logic anywhere.
The one place it needed care is `startPickupTravel`, where the idempotency
check (`task.startedAt !== null → ok`) is deliberately placed BEFORE the gate:
a driver re-tapping the button must not now be refused, nor raise an exception
on a booking whose bags are already in the van. Ops still sees it —
`cutoffRiskMonitor` already scans `in_transit` bookings every five minutes and
alerts on exactly this case, so no second alert was added.

### 3.4 Enforcement points

| Function               | File                           | Note                                                                                                                                        |
| ---------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `acceptAgreement`      | `services/agreements.ts`       | Gate runs BEFORE the status list, so a booking ops already owns says "our team is sorting this out" rather than "this booking is exception" |
| `recordCustomerUpload` | `services/passport.ts`         |                                                                                                                                             |
| `listCandidateDrivers` | `services/driver-selection.ts` | A shortlist is an offer; offering one past the cutoff asks the customer to pick a driver who cannot make the flight                         |
| `selectDriver`         | `services/driver-selection.ts` | Checked at submit **as well as** at render — a shortlist drawn before the cutoff is still on screen after it                                |
| `arriveAtVisit`        | `services/agent-visit.ts`      |                                                                                                                                             |
| `startPickupTravel`    | `services/pickup.ts`           | After the idempotency check — see §3.3                                                                                                      |

New error: `BookingNotActionableError` (`BOOKING_NOT_ACTIONABLE`), carrying
`action`, `standing` and `phase`, with a message written for the person who
hit the wall — because that message is what every surface renders.

**No migration, no new column.** Actionability is derived entirely from
`bookings.status`, `pickup_window_end`, `departure_at` and the existing
`airline_cutoffs` rows. Nothing is stored.

### 3.5 Phase 3 gate

| Gate                                          | Result                                                                                                                                                                                                   |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `turbo typecheck`                             | **6/6 pass**                                                                                                                                                                                             |
| `turbo lint`                                  | **6/6 pass**                                                                                                                                                                                             |
| `turbo test` (unit)                           | **core 441 passed / 1 skipped** (was 423 — 18 new matrix tests) · web 95 · ui 85 · admin 27 · agent 12                                                                                                   |
| `pnpm --filter @koolee/core test:integration` | **200 passed / 3 skipped, 21 files** (was 183 — 11 in a new `actionability.integration.test.ts`, plus 2 in `pickup`, 2 in `agent-visit`, 2 in `driver-selection`), `koolee_test` only, seed re-run clean |
| Migrations                                    | **none**                                                                                                                                                                                                 |

---

## Phase 4 — UI reflection of the gates

Three surfaces made honest. No layout redesign — F2 owns that.

| Surface                  | What changed                                                                                                                                                                | File                                               |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| **Customer trip page**   | `actionability` replaces status-only reasoning for `preVisit` and `canChooseDriver`; the blocked reason and the running-late notice render above the cutoff countdown       | `apps/web/src/app/trips/[bookingId]/page.tsx`      |
| **Agent task view**      | One `ActionabilityNotice` above both branches (verification visit and pickup run) — amber for "running late" over controls that still work, red for blocked with the reason | `apps/agent/src/app/tasks/[taskId]/page.tsx`       |
| **Admin booking detail** | The same sentence the customer and the agent are reading, above the exception banner — it explains an exception when there is one and warns before there is one             | `apps/admin/src/app/bookings/[bookingId]/page.tsx` |

Every surface renders the string core produced rather than composing its own,
so the customer, the agent and the operator cannot be told three different
things about the same booking. The UI reflects; it never substitutes — the
gates in §3.4 stay the authority, and each of those surfaces is reachable as a
POST regardless of what it renders.

### 4.1 A disk that was 100% full — found by the build gate

`turbo build` succeeded but exited non-zero on `IO error: No space left on
device`. **`.turbo/cache` had grown to 616 GB**, leaving 1.5 GB free on a
926 GB volume.

Precisely: 5,070 FILES, which is ~1,690 entries (turbo writes three files per
entry — `<hash>.tar.zst`, `-manifest.json`, `-meta.json`). Most are small; a
few dozen were **18–19 GB each**, and those are the ones that had swallowed
the dev cache. (An earlier draft of this report said "5,070 entries at 18–19
GB each", which is 90+ TB and therefore obviously not what happened.)

The cause is in `turbo.json`:

```jsonc
"outputs": [".next/**", "!.next/cache/**", "dist/**"]
```

Next 16 keeps its **turbopack dev cache** at `.next/dev/`, not under
`.next/cache/`. So every `turbo build` on a checkout where anyone had run
`pnpm dev` tarred 38 GB of dev cache into the build cache — once per hash.

Fixed by adding `"!.next/dev/**"`, with the reasoning written at the line. The
cache was cleared (a build cache is regenerable by definition) and rebuilt:

```
before   616 GB   (5,070 files / ~1,690 entries; the largest 18-19 GB each)
after     37 MB   (3 entries, one per app)
```

At the time of the fix `apps/web/.next/dev` was **39 GB**, admin 6.2 GB and
agent 4.0 GB — ~49 GB of turbopack dev cache being re-archived on every miss.

**618 GB recovered.** Worth TD knowing this exists on any other machine that
has run `pnpm dev` and `turbo build` on this repo — the fix is in the tree, but
the accumulated cache is not, and `rm -rf .turbo/cache` is the whole cleanup.

### 4.2 Phase 4 gate

| Gate                | Result                                              |
| ------------------- | --------------------------------------------------- |
| `turbo typecheck`   | **6/6 pass**                                        |
| `turbo lint`        | **6/6 pass**                                        |
| `turbo test` (unit) | **core 441 · web 95 · ui 85 · admin 27 · agent 12** |
| `turbo build`       | **3/3 pass** — web, agent, admin                    |
| Migrations          | **none**                                            |

---

## Phase 5 — Auth polish

### 5.1 Every auth form in the product, and what changed

`grep -rln 'type="password"'` across all three apps returns **one file** —
`packages/ui/src/components/staff-auth-forms.tsx` — which is why this is a
small diff. The customer app is OTP-only and has no password field anywhere,
confirmed by that grep and by reading `apps/web/src/actions/auth.ts`.

| #   | Form                                     | App(s)       | Component           | What changed                                                                                                                                               |
| --- | ---------------------------------------- | ------------ | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Staff sign-in                            | agent, admin | `StaffLoginForm`    | Password → `PasswordField` (show/hide). Email gains `autoCapitalize="off" autoCorrect="off" spellCheck={false}`. **No `minLength` added** — see §5.3       |
| 2   | Password reset request                   | agent, admin | `PasswordResetForm` | Email input hardened as above. Unchanged otherwise: it already always reports success                                                                      |
| 3   | Set password (invite + recovery landing) | agent, admin | `SetPasswordForm`   | Password → `PasswordField`. `minLength` and the hint now read `PASSWORD_MIN_LENGTH` / `PASSWORD_RULE_COPY` instead of a literal `8` and a literal sentence |
| 4   | Staff invite                             | admin        | `app/staff/`        | Unchanged — it already trimmed AND lowercased, and is the standard the other two were brought up to                                                        |
| 5   | Customer profile — save name/email       | web          | `dashboard/profile` | `email` normalized (**was `.trim()` only** — the one real inconsistency) and the schema field now normalizes before validating                             |
| 6   | Customer profile — confirm email code    | web          | `dashboard/profile` | Normalization moved onto the schema; behaviour unchanged                                                                                                   |
| 7   | Customer OTP send (phone or email)       | web          | `actions/auth.ts`   | `email` field normalizes before validating; the four hand-written `.toLowerCase()` calls at use sites are gone                                             |
| 8   | Customer magic link                      | web          | `actions/auth.ts`   | Same                                                                                                                                                       |
| 9   | Customer post-booking email attach       | web          | `actions/auth.ts`   | Same                                                                                                                                                       |

**Three password inputs, all now `PasswordField`. Nine forms audited; six
changed.**

### 5.2 `PasswordField` — the details that made it a component

`packages/ui/src/components/password-field.tsx`. Three fields across two apps
have to behave identically, or a staff member moving between the agent PWA and
the admin console has to relearn the control.

- `type="button"` on the toggle. A bare `<button>` in a form defaults to
  `type="submit"`, so revealing the password would submit the form.
- `tabIndex={-1}`. Tabbing out of a password field should reach Sign in, not a
  decoration in between.
- `aria-pressed` plus a label that flips (`Show password` ⇄ `Hide password`) —
  the control announces what it will DO and what it currently IS.
- Visibility is component state and resets on mount, so a revealed password
  never survives a navigation.
- `autoComplete` is a **required** prop, typed to
  `"current-password" | "new-password"`. A default would silently pick the
  wrong side for half the call sites, which is what makes a password manager
  fill the wrong field.

### 5.3 Consistency, and the one place consistency would be wrong

The rules moved into `packages/ui/src/lib/credentials.ts`, behind the
`@koolee/ui/lib/credentials` subpath — pure, dependency-free, importable from
both a client component and a server action. Not `packages/core`: the length
rule is read by a client component (`minLength`) AND a server action (the zod
schema), and pulling `@koolee/core` into a client bundle drags `@koolee/db` and
drizzle with it. Same reasoning as `lib/photo`, per §7.

| Rule                    | Before                                                                                                                                                                           | After                                                                                                 |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Password min length     | `minLength={8}` in the form, `.min(8)` in the action, `"at least 8 characters"` in two message strings — four literals                                                           | `PASSWORD_MIN_LENGTH`, read by all four                                                               |
| Password max            | `.max(128)`                                                                                                                                                                      | `PASSWORD_MAX_LENGTH`                                                                                 |
| Email normalization     | invite: `.trim().toLowerCase()` · staff sign-in: `.trim()` · staff reset: `.trim()` · `saveProfile`: `.trim()` · four sites in `actions/auth.ts`: `.toLowerCase()` after parsing | `normalizeEmail` at every parse boundary; on the schema (`z.preprocess`) where the input is an object |
| Sign-in failure message | a literal, written twice                                                                                                                                                         | `SIGN_IN_FAILED_COPY`, once                                                                           |

**The email inconsistency was real, not cosmetic.** The admin invite creates
`alice@koolee.cloud` from `Alice@Koolee.cloud`; staff sign-in only trimmed. Any
comparison between our `users` row and what was typed had to hope GoTrue
normalized identically.

**Sign-in deliberately does NOT enforce the length floor.** It stays
`z.string().min(1)`. Enforcing today's minimum at the door would lock out an
account whose password predates it, and would publish the policy to anyone
without an account. The floor belongs where a password is SET, which is the
only place it can be enforced without either cost.

**No user-enumeration difference.** `signInStaff` returns one message for "no
such account" and "wrong password"; `sendPasswordReset` always returns
success. Both were already correct; both are now pinned by a test that asserts
the message names neither field as the thing that was wrong. The one
message that IS different — "that account doesn't have agent access" — appears
only after a **correct** password, so it tells an attacker nothing they did not
already have.

### 5.4 Verified in a real browser

Playwright's browser was locked by another session, so the bundled headless
Chromium was driven over raw CDP instead (`--remote-debugging-port`, a ~40-line
`Runtime.evaluate` script). Against the running agent app at
`localhost:3001/login`:

```
BEFORE:      password field  type="password"  autocomplete="current-password"  minLength=-1
             toggle          aria-label="Show password"  type="button"  tabIndex=-1  aria-pressed="false"
             email           autocapitalize="off"  spellcheck="false"
AFTER CLICK: password field  type="text"  value="hunter2secret"
             toggle          aria-label="Hide password"  aria-pressed="true"
             location        /login          ← the form did NOT submit
```

`minLength=-1` on the sign-in field is the §5.3 decision, observed. The
screenshot confirms the eye sits inside the field on the right and the
password is legible after the click.

### 5.5 Phase 5 gate

| Gate                                          | Result                                                                                |
| --------------------------------------------- | ------------------------------------------------------------------------------------- |
| `turbo typecheck`                             | **6/6 pass**                                                                          |
| `turbo lint`                                  | **6/6 pass**                                                                          |
| `turbo test` (unit)                           | **core 441 · web 95 · ui 92** (was 85 — 6 credential tests) **· admin 27 · agent 12** |
| `pnpm --filter @koolee/core test:integration` | **200 passed / 3 skipped**, `koolee_test` only                                        |
| `turbo build`                                 | **3/3 pass**                                                                          |
| Browser                                       | agent `/login` driven over CDP, toggle verified                                       |
| Migrations                                    | **none**                                                                              |

---

## Phase 6 — Docs and close-out

### 6.1 Manual hosted steps

**No migrations in this slice.** Nothing here adds a column, a table or an
index: actionability is derived entirely from `bookings.status`,
`pickup_window_end`, `departure_at` and the existing `airline_cutoffs` rows,
and the ZIP check compares two values that already exist. `pnpm db:status`
against local reads **30 of 30, matched by content hash, in sync** and is
unchanged by this branch.

There ARE hosted steps, and they are the fix for two of the three bugs:
[docs/features/f1-hosted-setup.md](../features/f1-hosted-setup.md).

1. **`ANTHROPIC_API_KEY` on the Preview and Production scopes of the `apps/web`
   project**, then redeploy with the build cache unchecked. `apps/web` now
   refuses to boot in production without it. This is very likely the whole of
   TD's reported extraction bug.
2. **Two Turnstile hostnames** on the dev widget — see §6.3.
3. **`rm -rf .turbo/cache`** on any other machine that has built this repo —
   see Phase 4 §4.1.

### 6.2 Docs updated

| Doc                                | Change                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `docs/features/f1-hosted-setup.md` | **New.** The three manual steps, each with why it exists and how to verify it took                                                                                                                                                                                                                                                                     |
| `docs/features/README.md`          | Indexes it                                                                                                                                                                                                                                                                                                                                             |
| `docs/ENVIRONMENT.md` §5.2         | **Corrected a claim that was wrong and had cost TD a debugging session** — see §6.3                                                                                                                                                                                                                                                                    |
| `docs/CODEBASE-MAP.md` ch. 5       | The extraction seam row now says the heuristic is dev-only; `read-result.ts` and the shared assembly documented; `actionability` added to the services list with the two-axis reasoning and the carve-out                                                                                                                                              |
| `docs/CODEBASE-MAP.md` ch. 6       | Which extractor runs and why it used to be invisible; `legs` on the result; the quoted-ZIP rule                                                                                                                                                                                                                                                        |
| `PROJECT-STATUS.md` §3             | New snapshot entry for the slice                                                                                                                                                                                                                                                                                                                       |
| `PROJECT-STATUS.md` §4             | Rows **80–84**                                                                                                                                                                                                                                                                                                                                         |
| `PROJECT-STATUS.md` §7             | **Nine new standing constraints** — the extractor is not a peer of its fallback; same-row date+time; `quotedZip` is required; one actionability service on two axes; late-but-savable allows everything; the in-transit carve-out needs no exemption; Turnstile hostname scoping; one credential rule module; `turbo.json` must exclude `.next/dev/**` |
| `docs/run-reports/README.md`       | Indexes this report                                                                                                                                                                                                                                                                                                                                    |

### 6.3 A documented claim that was false

`docs/ENVIRONMENT.md` §5.2 said:

> Turnstile hostname entries cover subdomains, so the existing `koolee.cloud` /
> `dev.koolee.cloud` widgets already cover the staff subdomains.

They do not. A Turnstile entry covers that hostname and **its own**
subdomains. `dev.admin.koolee.cloud` reads `dev` · `admin` · `koolee.cloud` —
a subdomain of `admin.koolee.cloud`, not of `dev.koolee.cloud`. This is TD's
`110200` ("unknown domain"), on both admin password reset and agent sign-in.

**Confirmed empirically rather than argued.** Site key
`0x4AAAAAAEEphyJv7s1q6VEp` — the one in the failing URL in TD's console —
renders and challenges cleanly on `localhost:3001` with **no Turnstile console
output at all**, driven over CDP. The only variable between working and
`110200` is the hostname. (Turnstile accepts `localhost` without an entry,
which is why it never reproduces on a laptop.)

§5.2 now carries the correct rule and a table of which hostnames each widget
needs. This is the third time this file's prose has been wrong about something
checkable — the same lesson §3.1 of PROJECT-STATUS records about migration
state, in a different file.

### 6.4 Deferred, with reasons

| Item                                                  | Why not now                                                                                                                                                                                                                                                  |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The heuristic extractor reading the real Yatra layout | It returns `unreadable` on that document rather than a wrong answer, which is the correct trade. Making a text-layer parser handle a table whose columns interleave is open-ended work for a path that the Phase 1 boot gate makes unreachable in production |
| OCR for photographed tickets on the heuristic path    | Same reasoning. The Claude adapter reads images natively and is what production uses                                                                                                                                                                         |
| `distanceKm` in pricing                               | Still the hardcoded `20` (`TODO(maps)`), untouched. It is why the ZIP mismatch had no visible price effect **yet** — the trap is dug and the guard is now in front of it                                                                                     |
| Widening `alternativeSegments` past 2                 | No fixture produced a third New York departure. The whole itinerary is now visible through `legs` regardless                                                                                                                                                 |
| Turnstile widget mode (Managed vs Invisible)          | The deployed widget renders a visible "Verify you are human" checkbox; the docs say invisible. A dashboard setting, not code, and not the cause of `110200`. Flagged in the setup doc                                                                        |

### 6.5 Blocked on staging evidence

One item, and Phase 1 was built so that it does not block the fix:

**Whether `ANTHROPIC_API_KEY` is actually set on the `dev.koolee.cloud`
scope.** No Vercel CLI on this machine, no credential in the repo. The
conclusive check is one line in the runtime logs —
`[ticket-upload] extraction {…"extractor":"claude"…}` vs `"heuristic"` — and
it needs no flag, no redeploy and no debug mode. Full procedure:
[RUN-REPORT-8 §0.7](#07-blocked-on-staging-evidence) and
[f1-hosted-setup.md §1](../features/f1-hosted-setup.md).

Everything else in Phase 0 was proven locally and is fixed.

### 6.6 The matrix: implemented as written vs adjusted

**As written, all seven rows** — see Phase 3 §3.2 for the row-by-row table.

**Two deviations, both recorded there:**

1. **Naming, not meaning.** The prompt's `canceled` / `complete` are spelled
   `cancelled` / `completed` in `BookingStatus`. The code follows the enum.
2. **One rule adjusted, with reasoning.** A booking with **no cutoff on
   record** has no `missed_cutoff` phase — only `departed`. Every other
   "be conservative" rule in this codebase moves a _deadline_ earlier, which
   costs the customer nothing; this would move a _refusal_ earlier, which
   costs them their pickup. We do not claim a deadline passed when we do not
   know the deadline, and departure still catches the genuinely missed flight.
   Two tests pin it.

### 6.7 Final gate

| Gate                                          | Result                                                                                       |
| --------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `turbo typecheck`                             | **6/6 pass**                                                                                 |
| `turbo lint`                                  | **6/6 pass**                                                                                 |
| `turbo test` (unit)                           | **core 441 + 1 skipped · web 95 · ui 92 · admin 27 · agent 12 = 667 passing**                |
| `pnpm --filter @koolee/core test:integration` | **200 passed / 3 skipped, 21 files** — `koolee_test` only, seed re-run clean                 |
| `turbo build`                                 | **3/3 pass** — web, agent, admin                                                             |
| `pnpm --filter @koolee/db db:status`          | **30 of 30, matched by content hash, in sync.** `Target host: 127.0.0.1`, read and confirmed |
| Migrations added                              | **none**                                                                                     |
| New environment variables                     | **none.** `ANTHROPIC_API_KEY` already existed; it is now REQUIRED in production              |
| Hosted databases contacted                    | **none**                                                                                     |
| Commits made                                  | **none** — TD commits after review                                                           |

### 6.8 Test count, start to finish

```
                       before   after
core unit                 423     441   (+18 actionability matrix)
core integration          180     200   (+11 actionability enforcement,
                                          +3 quoted ZIP, +2 pickup gate/carve-out,
                                          +2 visit gate, +2 driver-selection gate)
web unit                   86      95   (+3 env boot gate, +6 pickup ZIP sync)
ui unit                    85      92   (+6 credential rules, +1)
extraction (in core)       40      58   (+18 fixture regressions)
```

Every new test names the failure it exists to prevent.
