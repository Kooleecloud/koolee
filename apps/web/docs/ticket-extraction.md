# Ticket extraction — upload → review form → confirm

Shipped 2026-08-09 (overnight run 1, Phase 3). The disabled upload button on
the flight step is now a working feature: free by default, Claude-powered
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

| Adapter                    | When                    | Notes                                                                                                                                                                                                                                                                  |
| -------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HeuristicTicketExtractor` | default (no key)        | In-process `unpdf` text extraction + targeted parsing. Multi-segment itineraries prefer the segment departing JFK/LGA/EWR; ambiguity → LOW confidence, never a guess. Scanned PDFs (no text layer) → unreadable.                                                       |
| `ClaudeTicketExtractor`    | `ANTHROPIC_API_KEY` set | Native PDF document block to `claude-haiku-4-5` (model ID in one constant, `CLAUDE_EXTRACTION_MODEL`), strict-JSON prompt, response parsed AND zod-validated server-side. Lazy SDK construction — import never throws without a key. Failures degrade to manual entry. |
| `FakeTicketExtractor`      | tests                   | Deterministic fixture, controllable failure.                                                                                                                                                                                                                           |

Selection is one env var: `apps/web/src/lib/core.ts` →
`resolveExtractionConfig()` → `createRuntime({ extraction })`. Core reads no
env. ESLint enforces the boundary exactly like Stripe's: `unpdf` only inside
`extraction/heuristic/`, `@anthropic-ai/sdk` only inside `extraction/claude/`.

The extraction-result zod schema (`ticketExtractionSchema`) validates IATA
shapes and pins the NYC-departure rule: only JFK/LGA/EWR are ever accepted
as an extracted origin — anything else is dropped (and confidence lowered)
before the result reaches the UI.

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
- `packages/core/src/extraction/claude.test.ts` — mocked API responses
  (good JSON, markdown-fenced, malformed, API error, non-NYC origin
  scrubbing). NO live calls.
- `apps/web/src/lib/ticket-upload-handler.test.ts` — limits, mime allowlist,
  private-bucket path, row + status writes, storage-failure degradation.
- `packages/core/src/services/ticket-uploads.integration.test.ts` — guest
  upload → attach at payment gate → confirmed (edited) values book; the raw
  extraction value provably appears in no table.
