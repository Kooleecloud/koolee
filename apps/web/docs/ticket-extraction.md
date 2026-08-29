# Ticket extraction — upload → review form → confirm

Shipped 2026-08-09 (overnight run 1, Phase 3). Rewritten 2026-08-29: the model
no longer decides which leg matters — it transcribes every segment and
`select-segment.ts` picks deterministically. Free by default, Claude-powered
when a key is present.

## The one rule everything hangs off

**Extracted values NEVER persist directly to booking fields.** The pipeline
ends at a review-form PREFILL:

1. `/api/ticket-uploads` (route handler, nodejs runtime) stores the file and
   runs extraction synchronously;
2. the result lands in the **quarantined `ticketPrefill` cookie key**
   (`booking-draft-schema.ts`) — read by exactly one thing: the flight
   review form, as editable defaults (extracted fields get an attention
   ring; low confidence adds a check-everything banner);
3. pressing Continue (`submitFlight`) is the confirm step: the
   user-confirmed form values are promoted into the real draft keys and the
   prefill is cleared in the same write;
4. `syncDraftRow` explicitly strips `ticketPrefill`, so raw extraction never
   reaches the server-side draft row either;
5. on failure or an unreadable file, the UI says "we couldn't read this —
   please enter your flight details manually" and nothing changes.

## The seam

`TicketExtractor` in `packages/core/src/extraction/` mirrors the
`PaymentProvider` pattern:

| Adapter                    | When                    | Notes                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HeuristicTicketExtractor` | default (no key)        | In-process `unpdf` text extraction + targeted parsing. Multi-segment itineraries prefer the segment departing JFK/LGA/EWR; ambiguity → LOW confidence, never a guess. Scanned PDFs (no text layer) → unreadable.                                                                                                                                                                                          |
| `ClaudeTicketExtractor`    | `ANTHROPIC_API_KEY` set | PDF as a native document block (JPEG/PNG as an image block) to `claude-haiku-4-5` (`CLAUDE_EXTRACTION_MODEL`), with a **forced `record_itinerary` tool call** rather than a strict-JSON prompt. Escalates to `CLAUDE_ESCALATION_MODEL` with adaptive thinking ONLY when the cheap pass comes back empty or ambiguous. Zod-validated server-side; lazy SDK construction; failures degrade to manual entry. |
| `FakeTicketExtractor`      | tests                   | Deterministic fixture, controllable failure.                                                                                                                                                                                                                                                                                                                                                              |

Selection is one env var: `apps/web/src/lib/core.ts` →
`resolveExtractionConfig()` → `createRuntime({ extraction })`. Core reads no
env. ESLint enforces the boundary exactly like Stripe's: `unpdf` only inside
`extraction/heuristic/`, `@anthropic-ai/sdk` only inside `extraction/claude/`.

The extraction-result zod schema (`ticketExtractionSchema`) validates IATA
shapes and pins the NYC-departure rule: only JFK/LGA/EWR are ever accepted
as an extracted origin — anything else is dropped (and confidence lowered)
before the result reaches the UI.

## Choosing the leg — deterministic, not modelled

The model's job is transcription: every segment it can see, with origin and
destination airports **and countries**, times, and free-form `notes`.
Choosing which segment we are actually servicing is
`packages/core/src/extraction/select-segment.ts`, in code, with a reason
recorded on every outcome:

| Situation                            | Reason                            | Result                                                                 |
| ------------------------------------ | --------------------------------- | ---------------------------------------------------------------------- |
| One segment departs JFK/LGA/EWR      | `single_serviced_origin`          | take it, high confidence                                               |
| Several serviced, one still upcoming | `single_upcoming_serviced_origin` | take the earliest unflown                                              |
| Two or more upcoming and serviced    | `ambiguous_serviced_origins`      | take the earliest, LOW confidence, offer the other as a one-click swap |
| None serviced                        | `no_serviced_origin`              | name the origin we cannot serve, leave the airport UNSET               |

Two rules that this replaced a guess with:

- **The airport dropdown never falls back to JFK** on a ticket we could not
  place. An unchosen dropdown reading "JFK" is indistinguishable from a value
  the customer picked. It renders a placeholder plus a sentence saying why.
- **Scope is derived from the destination COUNTRY** the model read, not from a
  domestic/international label it was asked to invent (`deriveScope`).
  Unknown country → unset, because domestic vs international selects a
  different bag-drop cutoff (45 vs 60 minutes) and a wrong guess there is an
  operational error.

**Each alternative carries its own scope**, derived from its own destination
country, so swapping legs cannot inherit the other leg's value or fall back to
domestic. (Found in the browser: swapping to a Paris leg showed "Domestic".)

Fields are validated **one at a time** — `AI - 101` normalises to `AI101`, and
a malformed timestamp no longer discards the flight number with it.

## The review form is remounted, not just re-rendered

Every field on the flight step is an _uncontrolled_ input seeded by
`defaultValue`, which React applies only on mount. A ticket upload and a leg
swap both re-render the page in place, so without a remount the mounted inputs
keep their old values while the prose around them updates — a form that
contradicts its own summary line. `page.tsx` derives a `formSeedKey` from the
values the form is seeded from and keys the form on it.

## Seeing what the model returned

`TICKET_EXTRACTION_DEBUG=1` makes the route return the whole diagnostics blob,
which `ticket-extraction-debug.tsx` renders under the upload card as a
collapsible panel with **Copy JSON**: every segment, the chosen index and
reason, dropped fields, both attempts with token usage and latency, plus the
model's own `readingNotes`. A structured one-line summary always goes to the
server log regardless of the flag.

⚠️ **Never set this on a production project.** The payload is a developer tool
containing a customer's itinerary. It is documented in `.env.example` and in
[docs/ENVIRONMENT.md](../../../docs/ENVIRONMENT.md).

## Storage + bookkeeping

- **Private** Supabase Storage bucket `ticket-uploads` (created idempotently,
  `public: false`), server-side upload only — never client-direct, no public
  URLs; any read-back must use short-lived signed URLs.
- 10 MB size limit, mime allowlist PDF + JPEG/PNG (images are accepted at
  the gate for a future OCR path — the heuristic reports them unreadable).
- Every upload gets a `ticket_uploads` row (migration `0005`): draft linkage,
  storage path, mime, size, SHA-256 checksum, extraction status. Pre-auth
  uploads key to the cookie draft's `draftId`; `attachTicketUploadsToUser`
  claims them for the verified user at the payment gate.
- Extraction runs synchronously in the request path — the customer is on the
  flight step waiting (Inngest deferral was decided against earlier).

## Local-dev quirk worth knowing

All three apps share `localhost` cookies (ports don't scope cookies), so
signing into the agent/admin app locally replaces the customer app's session
too. Not an issue in production (separate domains).

## Tests

- `packages/core/src/extraction/schema.test.ts` — valid/partial/garbage.
- `packages/core/src/extraction/heuristic.test.ts` — synthetic in-process
  PDFs (single-segment, multi-segment NYC preference, ambiguous → low
  confidence, no text layer → unreadable).
- `packages/core/src/extraction/select-segment.test.ts` — every selection
  reason, the flown-leg filter, per-field validation, `deriveScope`.
- `packages/core/src/extraction/claude.test.ts` — mocked tool-call responses
  (well-formed, malformed, API error, escalation trigger, non-NYC origin
  scrubbing). NO live calls.
- `packages/core/src/extraction/claude.live.test.ts` — an OPT-IN probe against
  the real API: `TICKET_PDF=… pnpm --filter @koolee/core exec vitest run
claude.live`. Skipped without a key, so prompt edits stay measurable without
  making CI depend on a paid call.
- `apps/web/src/lib/ticket-upload-handler.test.ts` — limits, mime allowlist,
  private-bucket path, row + status writes, storage-failure degradation, the
  swap alternatives, and each alternative carrying its own scope.
- `apps/web/src/lib/ticket-prefill-copy.test.ts` — the sentences the review
  form shows for each selection reason.
- `packages/core/src/services/ticket-uploads.integration.test.ts` — guest
  upload → attach at payment gate → confirmed (edited) values book; the raw
  extraction value provably appears in no table.
