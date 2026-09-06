# Overnight Run 1 — RUN REPORT

**Branch:** `feat/overnight-run-1` (created from `dev` @ `4d80bb7` before the run; no git commands run during the run)
**Scope:** Phases 0–7 per `koolee-overnight-run-1-prompt.md`
**Protocol:** each phase gated on a fully green verification set (lint, typecheck, unit, integration 22/22+, build). No git. No live external API calls. Local Supabase stack only.

---

## Environment note (read before running any migration)

`pnpm test:env:doctor` at run start confirmed the known trap is still live:
`packages/db/.env` sets `DIRECT_DATABASE_URL` pointing at the **hosted**
Supabase project (`db.jpvlzoikcivxepgyrkho.supabase.co`). A bare
`pnpm db:migrate` would therefore hit the hosted database. Every migration in
this run is applied with both URLs explicitly pinned to the local stack
(`postgresql://postgres:postgres@127.0.0.1:54322/postgres`), exactly as
`scripts/test-env.sh` does. The hosted project was never touched.

---

## Phase 0 — Doc fix: launch-checklist item #25 wording

**Timestamp:** 2026-08-09 ~02:20 (local)

### Baseline (established BEFORE any change)

| Command                                       | Result                                                                                  |
| --------------------------------------------- | --------------------------------------------------------------------------------------- |
| `pnpm lint`                                   | PASS (6 packages)                                                                       |
| `pnpm typecheck`                              | PASS (6 packages)                                                                       |
| `pnpm test`                                   | PASS — core 176 passed / 22 skipped (integration files skip without env), web 36 passed |
| `pnpm --filter @koolee/core test:integration` | PASS — 22/22 (4 files) against the `pnpm test:env:up` stack                             |
| `pnpm build`                                  | PASS (web, agent, admin)                                                                |

Baseline was green before any edit — run proceeds.

### What was built

Docs only, no code:

- **`PROJECT-STATUS.md` item #25** rewritten to cover BOTH sources of test
  OTP numbers: the `[auth.sms.test_otp]` block in `supabase/config.toml` AND
  the hosted project's dashboard-entered test phone (the `13322602829`
  mirror). The launch verification now explicitly requires production to be a
  separate Supabase project and both sources to be independently verified
  absent from it. Also bumped the tracker's active-branch line to
  `feat/overnight-run-1`.
- **`apps/web/docs/pre-launch-security.md` §6**: added one paragraph making
  the same point — the valid-format number is a stronger bypass than the
  555s because it passes libphonenumber form validation, and it exists in two
  places (config.toml + hosted dashboard), both of which the launch check
  must cover.

### Files created/modified

- `PROJECT-STATUS.md` (modified — item #25 row, active-branch line)
- `apps/web/docs/pre-launch-security.md` (modified — §6 paragraph)
- `RUN-REPORT.md` (created)

### New tests

None (docs only).

### Verification (post-change)

Docs cannot affect the toolchain; the baseline table above is the gate run
for this phase (run immediately before the edits, all green).

### Judgment calls / TODOs

- None. Docs-only phase, executed as specified.

---

## Phase 1 — #12: Thread the verified customer session through the booking flow

**Timestamp:** 2026-08-09 ~02:35 (local)

### What was built

The booking flow already resolved `userId` from the Supabase session at the
pay gate (`confirmBooking` → `getAuthUser` → `createBooking`), so the work
here was: kill the dead placeholder path, close the remaining ownership gap
on list reads, and pin the upgrade semantics with acceptance tests against
the real GoTrue stack.

1. **Placeholder-customer path deleted** — `upsertCustomerByPhone`,
   `ensureCustomerWithAddress`, and the also-dead `upsertCustomerFromAuth`
   (plus their input types and exports) removed from
   `packages/core/src/services/customers.ts` / `services/index.ts`. Grep
   confirms zero remaining references. Header comment now states the model:
   every customer row is keyed by the auth uid; the anonymous session IS a
   valid customer at draft time.
2. **`listBookingsForSession`** added to `packages/core/src/services/bookings.ts`
   — the list-shaped counterpart of `getBookingForSession`. A customer
   session is pinned to its own `userId`; passing someone else's id throws
   `NotAuthorizedError` instead of silently narrowing. `/trips` and
   `/dashboard/profile` now go through it (helper
   `customerSessionFromAuthUser` added to `apps/web/src/lib/session.ts`).
3. **Draft/booking migration on upgrade — verified, not rebuilt.** Pinned by
   a new integration test against the local GoTrue stack: `updateUser` +
   `verifyOtp(phone_change)` upgrades the SAME auth row in place (uid
   unchanged), so bookings and drafts keyed to the anonymous user need no
   re-parenting. The reconciliation case (colliding anonymous claimant's
   draft deleted) stays exactly as pinned by acceptance test 15 — untouched.
   The phone-conflict sign-in branch (draft reparented onto the permanent
   account) stays as pinned by test 16 — untouched.
4. **`deleteAnonymousCustomer` hardened** — now refuses (returns false, no
   thrown FK error) when the anonymous row owns any booking, keeping the
   conflict flow's cleanup a clean no-op on an invariant-violating row.

### Files created/modified

- `packages/core/src/services/customers.ts` (placeholder path removed; delete guard)
- `packages/core/src/services/bookings.ts` (`listBookingsForSession`)
- `packages/core/src/services/index.ts` (exports)
- `packages/core/src/services/booking-ownership.integration.test.ts` (new)
- `apps/web/src/lib/session.ts` (`customerSessionFromAuthUser`)
- `apps/web/src/app/trips/page.tsx` (session-scoped list)
- `apps/web/src/app/dashboard/profile/page.tsx` (session-scoped list)
- `PROJECT-STATUS.md` (#12 → shipped; spec stub updated)

### New tests

`booking-ownership.integration.test.ts` (3 tests, GoTrue-backed, same
two-stage gating as the acceptance suite):

- "a booking created under an anonymous session ends up owned by the
  verified identity after the guarded in-place upgrade" — full production
  sequence (guardUpgradeOtpSend → updateUser → verifyOtp) with test phone
  `+15555550102`; asserts uid unchanged, booking ownership, and the /trips
  query returning it.
- "customer A cannot fetch customer B's booking through the core read path"
  — `getBookingForSession` 404s; `listBookingsForSession` pins + throws on a
  foreign userId filter.
- "deleteAnonymousCustomer refuses a row that owns bookings".

### Verification

| Command                                       | Result                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint`                                   | PASS                                                                                                                                                                                                                                                                                                                                                                                               |
| `pnpm typecheck`                              | PASS                                                                                                                                                                                                                                                                                                                                                                                               |
| `pnpm test`                                   | PASS — core 201 (includes integration, .env.test present), web 36                                                                                                                                                                                                                                                                                                                                  |
| `pnpm --filter @koolee/core test:integration` | PASS — 25/25 (22 existing + 3 new)                                                                                                                                                                                                                                                                                                                                                                 |
| `pnpm build`                                  | PASS (web, agent, admin)                                                                                                                                                                                                                                                                                                                                                                           |
| Browser E2E (Playwright)                      | PASS — two full funnel passes against the local stack: (a) signed-in user books; `/trips` lists it via the new session-scoped seam; (b) signed-out anonymous funnel → verify gate → `PHONE_EXISTS` conflict correctly reported pre-send → sign-in branch with test number `3322602829`/OTP → draft reparented → booking created under the permanent user → `/trips` shows ONLY that user's booking |

(`pnpm seed` was run once against the local stack with both DB URLs pinned
to `127.0.0.1` to restore reference data the integration suites truncate.)

### Judgment calls / TODOs

- `listBookings` (unscoped) remains exported for staff/admin surfaces; the
  customer-facing pages now use the session-scoped variant. Phase 2 puts
  staff surfaces behind `assertRole`.
- The E2E pay step ends at "Awaiting payment" (draft) because Stripe
  Elements mounting is a pre-existing TODO in `stripe-checkout.tsx` — same
  behavior as the tracker's documented E2E pass, unchanged by this phase.

---

## Phase 2 — #13: Staff auth for agent + admin (email/password, invite-only)

**Timestamp:** 2026-08-09 ~03:05 (local)

### What was built

1. **`staff_members` table** (migration `0004_common_post.sql`, additive
   only, applied to the local stack with pinned URLs): one row per user,
   role CHECK-constrained to agent/admin, `active` flag, `invited_by`,
   unique on user_id. Rows are never deleted — deactivation flips `active`.
2. **Core staff service** (`packages/core/src/services/staff.ts`):
   `getActiveStaffRole`, `requireStaffRole` (wraps the #9 `assertRole`
   seam; per-request lookup = immediate deactivation), `createStaffMember`
   (users row + role row in one tx; role validated server-side, only
   agent/admin ever assignable), `setStaffMemberActive`, `listStaffMembers`.
   The security-boundary rationale (signups must stay enabled for the
   anonymous funnel; the ROLE is the boundary) is stated in code comments in
   both core and both apps, as the prompt required.
3. **Dev stubs deleted** — `packages/core/src/auth/stubs.ts` removed after
   consulting its TODO(auth-*) spec; every requirement either implemented
   (real identity, role gating, task-scoping, real audit actor) or
   explicitly documented as dashboard-level (session TTL, GoTrue sign-in
   rate limits) in the new doc. Grep confirms zero references.
4. **Agent task scoping / canActOnBooking narrowed**: agents now answer
   `false` in the sync `canActOnBooking`; booking reads/transitions go
   through the new async `sessionCanActOnBooking` →
   `agentHasTaskForBooking` (assignment lookup). `getAssignedTask` resolves
   task detail only for its assignee; the agent task-detail page no longer
   trusts a `?booking=` query param.
5. **Agent app** (`apps/agent`): real login (email/password), reset +
   set-password pages, `/auth/callback` (invite/recovery token exchange),
   per-request session in `lib/session.ts`, all pages gated
   (home/tasks/task detail/scan → redirect to /login). **Least privilege
   enforced:** `SUPABASE_SERVICE_ROLE_KEY` removed from the agent env
   schema and `.env.example` (the run prompt pins this stance).
6. **Admin app** (`apps/admin`): same auth infrastructure (role `admin`),
   plus `/staff` — list (email, role, status), invite form (email + role),
   deactivate button; exactly those three capabilities. Invites call
   `inviteUserByEmail` with the service-role key (admin app only) and write
   the role row in the same action; agent invites redirect to the agent
   app's origin (new optional env `NEXT_PUBLIC_AGENT_APP_URL`). Self-
   deactivation is refused. All bookings/exceptions pages + manual
   transition action now sit behind the real admin session, so every
   custody event from an admin override carries the real staff user id.
7. **Shared UI** (`packages/ui/staff-auth-forms.tsx`): StaffLoginForm,
   PasswordResetForm, SetPasswordForm (client components taking the app's
   server action as a prop).
8. **Seed**: `pnpm seed` now creates admin@koolee.local /
   koolee-admin-dev-1 and agent@koolee.local / koolee-agent-dev-1 via the
   GoTrue admin REST API — HARD-REFUSED on any non-local Supabase host.
9. **Config**: `supabase/config.toml` `additional_redirect_urls` extended
   with :3001/:3002 `/auth/callback` (stack restarted via
   `supabase stop && pnpm test:env:up`; all 5 verify checks green after).
10. **Docs**: `apps/admin/docs/staff-auth.md` (design, boundary, seeded
    creds, hardening notes); PROJECT-STATUS #13 → shipped.

### Files created/modified

New: `packages/db/src/schema/staff.ts`, `packages/db/drizzle/0004_common_post.sql`,
`packages/core/src/services/staff.ts`, `packages/core/src/services/tasks.ts`,
`packages/core/src/services/staff-auth.integration.test.ts`,
`packages/ui/src/components/staff-auth-forms.tsx`,
`apps/agent/src/lib/supabase/server.ts`, `apps/agent/src/actions/auth.ts`,
`apps/agent/src/app/auth/callback/route.ts`, `apps/agent/src/app/login/reset/page.tsx`,
`apps/agent/src/app/set-password/page.tsx`,
`apps/admin/src/lib/supabase/{server,admin}.ts`, `apps/admin/src/actions/auth.ts`,
`apps/admin/src/app/auth/callback/route.ts`, `apps/admin/src/app/login/reset/page.tsx`,
`apps/admin/src/app/set-password/page.tsx`, `apps/admin/src/app/staff/{page,actions,staff-forms}.tsx`,
`apps/admin/docs/staff-auth.md`.

Modified: `packages/db/src/schema/{index,relations}.ts`, `packages/db/src/seed.ts`,
`packages/core/src/auth/{index,types}.ts` (stubs.ts DELETED),
`packages/core/src/services/{bookings,index}.ts`,
`apps/agent/src/{env.ts,.env.example,lib/session.ts}`,
`apps/agent/src/app/{page,login/page,scan/page,tasks/page,tasks/[taskId]/page}.tsx`,
`apps/admin/src/{env.ts,lib/session.ts}`,
`apps/admin/src/app/{page,layout,login/page,bookings/page,bookings/[bookingId]/page,exceptions/page}.tsx`,
`supabase/config.toml`, `packages/ui/src/index.ts`, `PROJECT-STATUS.md`.
Also: `apps/agent/.env.local` + `apps/admin/.env.local` repointed at the
LOCAL Supabase stack (hosted values preserved as comments) so staff auth
runs locally; admin `.env.local` gained `NEXT_PUBLIC_AGENT_APP_URL`.

### New tests

`staff-auth.integration.test.ts` (3 tests, GoTrue + Mailpit backed):

- role-guard matrix: customer / anonymous / unknown-uuid / wrong role /
  deactivated all throw `NotAuthorizedError`; matching role passes; flip of
  `active` fails the very next check.
- invite: `inviteUserByEmail` → auth user; `createStaffMember` writes users
  - role rows (invitedBy recorded); the invite email is asserted IN MAILPIT;
    roles outside agent/admin (customer, driver, superuser) throw; listing
    shows identity.
- password reset E2E through Mailpit: resetPasswordForEmail → email fetched
  from the Mailpit API → recovery token extracted → verifyOtp → new
  password set → old password rejected, new one signs in and passes the
  role gate.

### Verification

| Command                                       | Result                                                                                                                                                                                                                                                    |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint`                                   | PASS                                                                                                                                                                                                                                                      |
| `pnpm typecheck`                              | PASS                                                                                                                                                                                                                                                      |
| `pnpm test`                                   | PASS — core 204, web 36                                                                                                                                                                                                                                   |
| `pnpm --filter @koolee/core test:integration` | PASS — 28/28 (22 baseline + 3 Phase 1 + 3 Phase 2)                                                                                                                                                                                                        |
| `pnpm build`                                  | PASS (web, agent, admin)                                                                                                                                                                                                                                  |
| Stub grep                                     | clean — zero references to the deleted stubs                                                                                                                                                                                                              |
| Browser sanity (Playwright)                   | PASS — unauthenticated /bookings redirects to /login; admin@koolee.local signs into ops console; /staff lists both seeded accounts with invite form; admin account REFUSED in agent app ("doesn't have agent access"); agent@koolee.local lands on /tasks |

### Judgment calls / TODOs

- **Deactivation vs token revocation:** enforcement is the per-request role
  check (immediate). The JWT itself stays valid until expiry but reaches
  nothing. Documented; belt-and-braces ban via admin API left as a future
  hardening item.
- **Sign-in rate limiting:** relying on GoTrue's built-in limits
  (config.toml locally, dashboard hosted) rather than adding an app-level
  lockout. Documented in staff-auth.md.
- **Invite to an email that already has an account** returns a clear error
  instead of attaching a role to an existing (possibly customer) account —
  conservative on purpose; revisit if staff need to reuse personal emails.
- **`NEXT_PUBLIC_AGENT_APP_URL`** added (admin env) so agent invites land in
  the agent app; defaults to http://localhost:3001.
- **Integration suites truncate seeded staff rows** (public tables only);
  re-running `pnpm seed` restores them. Documented in staff-auth.md.
- The hosted Supabase project's dashboard will need the deployed staff-app
  callback URLs added to its redirect allowlist at launch (config.toml only
  covers local) — launch-checklist material, noted in staff-auth.md.

---

## Phase 3 — #14: Ticket extraction — schema, review form, storage, two adapters

**Timestamp:** 2026-08-09 ~03:25 (local)

### What was built

1. **`TicketExtractor` seam** (`packages/core/src/extraction/`, mirroring
   `PaymentProvider`): typed input (bytes + mime) → typed outcome
   (`extracted` | `unreadable`); extraction never throws for content
   reasons. ESLint boundary added exactly like Stripe's: `unpdf` importable
   only in `extraction/heuristic/`, `@anthropic-ai/sdk` only in
   `extraction/claude/`.
2. **Zod schema** (`ticketExtractionSchema`): IATA airline (2-char), flight
   number, local departure datetime, origin (ONLY JFK/LGA/EWR accepted — the
   NYC-departure rule is in the schema), destination (3-letter), passenger
   name — all optional (extraction is partial by nature) — plus a required
   overall `confidence: high|low` signal (chosen over per-field; the review
   form flags all prefilled fields, harder to miss).
3. **`ticket_uploads` table** (migration `0005`, additive, applied locally
   with pinned URLs): draft-cookie linkage (`draft_id`, deliberately no FK),
   nullable `user_id` attached at the payment gate, storage path, mime,
   size, SHA-256 checksum, extraction status enum.
4. **Storage**: PRIVATE Supabase bucket `ticket-uploads`, created
   idempotently (`public:false`, size + mime limits), server-side upload via
   the new `/api/ticket-uploads` route handler (nodejs runtime) — never
   client-direct; no public URLs.
5. **HARD-RULE mechanism — the quarantine**: extraction output goes into a
   dedicated `ticketPrefill` cookie key read ONLY by the flight review form
   as editable defaults (attention-ringed fields; low-confidence banner).
   `submitFlight` (the confirm step) promotes user-confirmed values into the
   real draft keys and clears the prefill in the same write; `syncDraftRow`
   strips it from the server-side mirror; `confirmBooking` never sees it.
   Verified by grep and by test (below).
6. **`FakeTicketExtractor`** — deterministic fixture, failure switch, call
   recorder.
7. **`HeuristicTicketExtractor`** (free default) — in-process `unpdf` text
   layer + targeted parsing (labelled flight numbers, segment detection
   `A → B`/`A TO B`, NYC-segment preference, ambiguity → LOW confidence,
   date/time/pax-name heuristics, scanned PDFs → unreadable). Absorbs and
   retires the old `flights/ticket-parser.ts` scaffold + `apps/web/lib/pdf.ts`.
8. **`ClaudeTicketExtractor`** — native PDF document block to the Messages
   API, model ID in ONE constant (`CLAUDE_EXTRACTION_MODEL =
"claude-haiku-4-5"`, current Haiku-class), strict-JSON prompt, response
   parsed + zod-validated server-side, non-NYC origins scrubbed. LAZY
   construction (dynamic import at first extract; module import never throws
   without a key). All tests mock the API — zero live calls.
9. **Selection**: `ANTHROPIC_API_KEY` set → Claude, else heuristic — wired
   through `apps/web/src/env.ts` → `resolveExtractionConfig()` →
   `createRuntime({extraction})`; `CoreConfig.ticketExtractor` defaults to
   the heuristic. Core reads no env.
10. **UI**: upload button ENABLED — client posts to the route handler,
    shows an extracting state, lands on the review form with prefilled,
    editable, flagged fields; every failure path renders "we couldn't read
    this — please enter your flight details manually" and changes nothing.
11. Extraction is synchronous in the request path (customer is waiting;
    Inngest deferred by prior decision). Guest uploads attach to the
    verified user in `confirmBooking` via `attachTicketUploadsToUser`.

### Files created/modified

New: `packages/db/src/schema/uploads.ts`, `packages/db/drizzle/0005_strong_zarda.sql`,
`packages/core/src/extraction/{types,fake,factory,index}.ts`,
`packages/core/src/extraction/heuristic/{index,extractor}.ts`,
`packages/core/src/extraction/claude/{index,extractor}.ts`,
`packages/core/src/extraction/test-utils/make-pdf.ts`,
`packages/core/src/extraction/{schema,heuristic,claude}.test.ts`,
`packages/core/src/services/ticket-uploads.ts`,
`packages/core/src/services/ticket-uploads.integration.test.ts`,
`apps/web/src/app/api/ticket-uploads/route.ts`,
`apps/web/src/lib/ticket-upload-handler.ts` (+ its test),
`apps/web/docs/ticket-extraction.md`.

Modified: `packages/core/src/{index,config,runtime}.ts`, `packages/core/package.json`
(exports + `unpdf`, `@anthropic-ai/sdk` deps), `packages/core/eslint.config.mjs`,
`packages/config/eslint/base.mjs`, `packages/db/src/schema/index.ts`,
`apps/web/src/lib/{core,booking-draft,booking-draft-schema,draft-sync}.ts`,
`apps/web/src/app/book/{actions.ts,flight/page.tsx}`,
`apps/web/src/components/ticket-upload.tsx`, `PROJECT-STATUS.md`.

Deleted: `packages/core/src/flights/` (parser + test — absorbed by the
heuristic adapter), `apps/web/src/lib/pdf.ts` (moved into core), `unpdf`
removed from apps/web deps.

### New tests (26)

- schema (6): valid / partial / garbage shapes; confidence required;
  LAX-cannot-proceed; `hasExtractedFields`.
- heuristic (6): typical single-segment confirmation; multi-segment
  preferring the NYC departure; ambiguous double-NYC → LOW confidence;
  no-text-layer → unreadable; images → unreadable; no-details PDF →
  unreadable. Fixtures are real PDFs generated in-process (make-pdf.ts).
- claude (7, all mocked): lazy construction; good JSON (asserts document
  block + the single model constant on the wire); fenced JSON; malformed
  JSON → unreadable; LAX scrubbed + confidence lowered; API error →
  unreadable; empty result → unreadable.
- upload handler (7): missing file; size limit pre-storage; mime allowlist;
  private-bucket path shape + row + checksum + status; prefill contract;
  unreadable → manual-entry copy + row marked; storage failure → no row.
- integration (1, local stack): guest upload row → extraction (fake, with a
  deliberately WRONG name) → user edits on review → attach at payment gate
  (idempotent, never re-assigns) → booking carries the confirmed name → the
  raw extraction value appears in NO table (ilike sweep across bookings,
  users, ticket_uploads, custody_events, bags).

### Verification

| Command                                       | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint`                                   | PASS                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `pnpm typecheck`                              | PASS                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `pnpm test`                                   | PASS — core 219, web 43                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `pnpm --filter @koolee/core test:integration` | PASS — 29/29                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `pnpm build`                                  | PASS (web, agent, admin)                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Grep gate                                     | `ticketPrefill` written only by the route handler, read only by the review form, cleared by `submitFlight`, stripped by `syncDraftRow`; `extract()` called only from the upload pipeline                                                                                                                                                                                                                                                                                                     |
| Browser E2E (Playwright, real PDF)            | PASS — uploaded `sample-eticket-UA1189.pdf` through the UI: heuristic read UA1189/JFK/date and honestly flagged LOW confidence (name came out "Alex Mr Traveler"); review form showed flagged editable fields + banner; user edit ("Alex Traveler") + confirm → funnel → booking `0aa9e7c8…` carries the CONFIRMED name; DB checks: private bucket (`public=f`), storage object present, upload row `extracted` + attached to the user at the payment gate, raw extraction name in zero rows |

### Judgment calls / TODOs

- **Overall confidence** (not per-field): the schema carries one signal and
  the form flags every prefilled field; per-field granularity can be added
  to the schema without breaking the seam.
- **Destination airports** validate by IATA shape only — a full
  airports-table cross-check would gate on DB access inside extractors;
  origin (the field that gates selling) IS pinned to the serviced airports.
- 10 MB limit adopted (prompt's suggestion) — supersedes the old 5 MB.
- Images (JPEG/PNG) pass the mime gate for a future OCR path and are
  honestly reported unreadable today.
- The route handler creates the private bucket idempotently at first upload
  rather than requiring a manual setup step.
- Local-dev quirk surfaced during E2E: the three apps share `localhost`
  cookies (ports don't scope cookies), so a staff sign-in on :3001/:3002
  replaces the customer session on :3000. Production domains differ; noted
  in ticket-extraction.md.
- README's env-table row for `ANTHROPIC_API_KEY` still says "out of scope" —
  superseded by this phase (left untouched to keep the diff focused; the
  feature doc is authoritative). TODO for TD if README should be re-synced.

---

## Phase 4 — Customer account area

**Timestamp:** 2026-08-09 ~10:10 (local)

### Interjected requirement (TD, mid-run): failed submissions must not reset forms

Handled first, repo-wide: React 19 resets uncontrolled form fields after
every form action, so a validation error wiped everything the user typed.
Added `usePreservedFormValues` to `packages/ui` (snapshot values at submit,
restore on error; passwords/files/hidden fields deliberately excluded) and
applied it to EVERY uncontrolled action form: funnel StepForm + ZIP +
address-step + out-of-area + waitlist, staff login/reset/set-password (both
apps), admin invite + manual-transition forms, profile, and the new address
forms. The customer login/verify flows were already fully controlled and
needed nothing. Live-verified in the browser: invalid flight number → error
shown, all other typed values intact.

### What was built

1. **Profile page** (`/dashboard/profile`, reworked): verified phone/email
   shown READ-ONLY with verification badges; display name editable; email
   attach (only for accounts without one) now routes through
   `guardUpgradeOtpSend` — closing a pre-existing gap where the profile
   email change bypassed the one-guard rule. Changing phone/email re-enters
   the existing verification flow — no second mechanism was built
   (TODO(account) marker for a dedicated change flow with returnTo).
2. **Saved addresses** (`/dashboard/addresses`): full CRUD with `label`
   (additive migration `0006`), session-scoped in core
   (`packages/core/src/services/addresses.ts`) — ownership in the WHERE
   clause, coverage asserted on every save, and deleting an address on a
   booking's record returns a typed conflict ("part of a booking's record")
   instead of a raw FK error.
3. **Funnel prefill**: the address step offers a logged-in customer's saved
   addresses as one-tap buttons (`useSavedAddress` action reads through the
   session-scoped core service); the guest manual form is unchanged.
4. **Booking detail** (`/trips/[id]`): now renders the custody timeline PLUS
   bag list (seal ids when present, "not yet sealed" otherwise) and payment
   summary (amount, status, provider) via new core
   `getBookingDetailForSession` — all scoped to that booking and authorized
   against the session. Card brand/last4: TODO(payments) pending Phase 5
   webhook metadata (payments table stores none today; card-on-file
   deliberately NOT added).
5. **Navigation shell**: Profile / Addresses / Trips links on both the
   dashboard and trips layouts.
6. Out of scope with TODO markers: saved payment methods
   (Stripe Customers/SetupIntents), notification preferences, account
   deletion.

### Files created/modified

New: `packages/core/src/services/addresses.ts`,
`packages/core/src/services/account-area.integration.test.ts`,
`packages/db/drizzle/0006_mighty_human_robot.sql`,
`packages/ui/src/lib/use-preserved-form.ts`,
`apps/web/src/app/dashboard/addresses/{page.tsx,actions.ts,address-forms.tsx}`.

Modified: `packages/db/src/schema/identity.ts` (label), `packages/core/src/errors.ts`
(ConflictError field union + docs), `packages/core/src/services/{bookings,index}.ts`
(`getBookingDetailForSession`), `packages/ui/src/index.ts`,
`packages/ui/src/components/staff-auth-forms.tsx`,
`apps/web/src/app/dashboard/{layout.tsx,profile/page.tsx,profile/actions.ts,profile/profile-form.tsx}`,
`apps/web/src/app/trips/{layout.tsx,[bookingId]/page.tsx}`,
`apps/web/src/app/book/{actions.ts,address/page.tsx}`,
`apps/web/src/components/{step-form,zip-step-form,address-step-form,out-of-area-capture,ticket-upload}.tsx`,
`apps/web/src/app/(marketing)/waitlist/waitlist-form.tsx`,
`apps/admin/src/{app/staff/staff-forms.tsx,components/transition-controls.tsx}`,
`PROJECT-STATUS.md` (#27, #28).

### New tests (4, integration)

`account-area.integration.test.ts`:

- address CRUD with label, uppercase-state normalisation, coverage rejection
  on BOTH create and update, list, delete;
- ownership: A cannot read/update/delete B's address (NotFound-shaped), B's
  row untouched after the attempts;
- deleting an address on a booking's record → typed ConflictError;
- booking detail returns that booking's timeline/bags/payments and ONLY that
  booking's (marker event on booking B never leaks into A's detail), and
  the session gate 404s A reading B's detail.

### Verification

| Command                                       | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint`                                   | PASS                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `pnpm typecheck`                              | PASS                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `pnpm test`                                   | PASS — core 223, web 43                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `pnpm --filter @koolee/core test:integration` | PASS — 33/33                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `pnpm build`                                  | PASS (web, agent, admin)                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Browser E2E (Playwright)                      | PASS — signed in via phone OTP (session had expired; login flow re-verified); added "Home" address through the UI; funnel: invalid flight number → error with ALL typed values preserved (live check of the interjected requirement); corrected → address step showed the saved address → one tap → bags → booked; `/trips/[id]` renders timeline + bag list ("not yet sealed") + payment summary; profile shows verified-phone badge and editable name |

### Judgment calls / TODOs

- Profile email attach now goes through the ONE guard (`guardUpgradeOtpSend`)
  — this was a pre-existing bypass, fixed while touching the file because
  the standing constraints forbid a second send path.
- Payment summary shows amount/status/provider; brand/last4 needs webhook
  metadata (Phase 5) — payments table stores none today. TODO left in the
  page.
- Address deletion is blocked (typed message) when a booking references the
  address — the custody record wins over tidiness.
- The one-guard fix means profile email attach is now throttle-limited like
  every other send (3/user/15min) — intentional.
- Payment rows created via Stripe test mode show status `failed` when the
  PaymentIntent requires client confirmation (pre-existing mapping in
  `createBooking`; Phase 5's webhook work is where payment status modeling
  gets finished).

---

## Phase 5 — Payment lifecycle close-out

**Timestamp:** 2026-08-09 ~10:20 (local)

### What was built

The webhook route (`/api/webhooks/stripe`, nodejs runtime, signature via
the `verifyWebhook` seam) and `handlePaymentEvent` already existed; this
phase closed the gaps the tracker deferred:

1. **Event-id idempotency** (`payment_webhook_events`, migration `0007`,
   applied locally with pinned URLs): a replayed provider event id no-ops
   before any work; ids are recorded only after successful handling so a
   crash lets redelivery finish the job; the pre-existing status-guarded
   updates stay underneath as the concurrency backstop.
2. **Auth expired/canceled handling refined**: `payment.cancelled`
   (Stripe's `payment_intent.canceled`, which also covers expiry) cancels
   the booking pre-transit; where the matrix forbids cancel (in transit
   onward) it lands as `raise_exception` — money-vanished-mid-transit is an
   ops case. NO new matrix transitions were needed: the existing 10×11
   matrix covers everything, its exhaustive tests stand unchanged.
3. **`captureBookingPayment`** (core; Phase 6's completion action calls
   it): captures via the seam, sets `payments.captured` + new
   `capture_ref` column, appends `booking.payment_captured` with the real
   actor. Capture FAILURE → booking to `exception` through the matrix +
   custody event with reason + `opsAlerter` critical — ops-visible, not a
   log line.
4. **`cancelBookingWithRefund`** (core): matrix-gated cancel, slot seat
   released (same semantics as the auth-failure compensation), then money
   unwound via the seam — captured → FULL refund (TODO(fee-policy): no fee
   rule exists in pricing_rules/core, so full refund by instruction),
   authorized → void. A failed unwind appends
   `booking.payment_unwind_failed` and pages ops.
5. **FakePaymentProvider parity**: `simulateWebhook()` builds the exact
   `{payload, signature}` pair the webhook path accepts. Stripe CLI local
   forwarding documented (doc only, tests don't require it).
6. Doc: `apps/web/docs/payments-lifecycle.md`.

### Files created/modified

New: `packages/core/src/services/payment-lifecycle.ts` (+ integration test),
`packages/db/drizzle/0007_new_stardust.sql`, `apps/web/docs/payments-lifecycle.md`.
Modified: `packages/db/src/schema/billing.ts` (`payment_webhook_events`,
`payments.capture_ref`), `packages/core/src/services/{webhooks,index}.ts`,
`packages/core/src/payments/fake.ts`, `PROJECT-STATUS.md` (#29).

### New tests (7, integration, FakePaymentProvider end-to-end)

- webhook: valid signature → payments row updated; duplicate event id →
  no-op with exactly one recorded id; invalid signature → typed
  verification error before any side effect;
- auth cancellation: pre-transit → booking `cancelled`; in transit →
  booking `exception`;
- capture at completion: provider state + payments row + custody event;
  capture failure → `exception` + critical ops alert;
- cancellation: un-captured auth voided + slot seat released; captured
  payment refunded in full (provider refund ledger asserted) + custody
  event; matrix refuses cancellation once in transit.

### Verification

| Command                                       | Result                   |
| --------------------------------------------- | ------------------------ |
| `pnpm lint`                                   | PASS                     |
| `pnpm typecheck`                              | PASS                     |
| `pnpm test`                                   | PASS — core 230, web 43  |
| `pnpm --filter @koolee/core test:integration` | PASS — 40/40             |
| `pnpm build`                                  | PASS (web, agent, admin) |

(Funnel untouched this phase — the browser E2E from Phase 4 remains the
current-state pass; Phase 6 re-runs it after the agent flow lands.)

### Judgment calls / TODOs

- Slot-seat release on cancellation: adopted from the existing
  compensation semantics in `createBooking` (a cancelled booking should not
  hold capacity). Logged here because the old admin manual-cancel path did
  not release seats; Phase 7's exception handling uses the new function.
- Refunds are always FULL — pinned by the prompt until a fee policy exists
  (TODO(fee-policy) in code).
- `capture_ref` column added because the fake provider (like some real
  PSPs) mints a distinct capture id; Stripe reuses the PaymentIntent id, so
  `capture_ref ?? provider_ref` is the refund target.
- Card brand/last4 for the customer payment summary (Phase 4 TODO) still
  needs Stripe metadata enrichment in the webhook — left as TODO(payments):
  the normalised `PaymentEvent` deliberately carries no card details yet.

---

## Phase 6 — Agent workflow: the verification visit

**Timestamp:** 2026-08-09 ~10:35 (local)

### What was built

1. **Core visit flow** (`packages/core/src/services/agent-visit.ts`):
   `arriveAtVisit` (idempotent, task → in_progress, `visit.arrived` event),
   `recordIdentityVerified` (`visit.identity_verified`), `recordBagSealed`
   (bag row seal/weight/photo + `bag.sealed` event; re-sealing refused —
   corrections are compensating events), `completeVerificationVisit`
   (refuses unsealed bags → matrix `complete_verification` with the real
   agent actor → task done → **Phase 5 capture**; thrown capture errors land
   in the same ops-visible exception path as provider failures),
   `reportVisitException` (typed reasons, note required for "other", matrix
   `raise_exception` + task failed + ops warning). Assignment IS the
   authorization on every function.
2. **Bag photos**: PRIVATE `bag-photos` bucket. The agent app holds no
   service key, so uploads run server-side as the signed-in agent over the
   anon key, gated by storage RLS (migration `0008`), with the staff check
   moved into a SECURITY DEFINER `is_active_staff()` (migration `0009`) so
   `staff_members` itself stays closed to PostgREST. Live-verified: agent
   upload OK, anonymous session denied by RLS.
3. **Agent app UI**: home is now TODAY's visits in slot order with status
   chips; task detail is the guided flow (steps unlock in order, completion
   disabled until every bag is sealed, GPS captured best-effort and attached
   to every step, always-visible "flag a problem" escape hatch). Pickup
   tasks keep their placeholder card (driver flow later, task split
   untouched). Old checklist scaffold deleted.
4. **Dev fix**: the payments factory now shares ONE FakePaymentProvider per
   process (its ledger is in-memory; per-request instances forgot every
   authorization before capture). Tests construct providers directly —
   unaffected.
5. Doc: `apps/agent/docs/verification-visit.md`.

### Judgment calls (creative-latitude log)

- **Screen order** arrive → ID → per-bag → complete, sequential unlock:
  matches the physical visit and makes the custody trail read like the
  visit happened. Exception hatch always visible.
- **GPS best-effort**: denied/unavailable geolocation degrades to null —
  never blocks a visit (bags at the door beat metadata).
- **Bag re-sealing refused** with an explicit "corrections are compensating
  events" message — append-only thinking surfaced in the agent UX.
- **Completion copy**: "charges the customer's card" + "in Koolee's custody
  until the airline's bag drop" — no overclaiming.
- **QR/RFID scan**: TODO(agent-flow); manual seal entry ships first (seal id
  stays opaque per decision #18).
- **Capture-failure UX**: agent sees "ops has been alerted — don't hand back
  the bags", not an error to retry into a double charge.
- `mark_awaiting_pickup` is NOT auto-fired on completion — staging for the
  driver stays a separate (later) step; booking rests at `verified_sealed`.

### Files created/modified

New: `packages/core/src/services/agent-visit.ts` (+ integration test),
`packages/db/drizzle/0008_bag_photos_bucket.sql`,
`packages/db/drizzle/0009_staff_check_function.sql`,
`apps/agent/src/app/tasks/[taskId]/{actions.ts,visit-flow.tsx}`,
`apps/agent/docs/verification-visit.md`.
Modified: `packages/core/src/services/index.ts`, `packages/core/src/errors.ts`
(ConflictError "seal"), `packages/core/src/payments/factory.ts` (shared fake),
`apps/agent/src/app/{page.tsx,tasks/[taskId]/page.tsx}`, `PROJECT-STATUS.md` (#30).
Deleted: `apps/agent/src/components/verification-checklist.tsx` (superseded scaffold).

### New tests (4, integration)

- full visit: arrive (idempotency asserted) → ID → both bags sealed
  (photos, weights) → completion → payment captured through the seam →
  booking `verified_sealed`, task done; EVERY agent-performed event carries
  the real actor id + role + timestamp; GPS and photo land in their
  columns; append-only re-proven against the visit's own trail;
- completion refused while a bag is unsealed;
- exception path: booking `exception`, task `failed`, event carries
  reason + note + actor;
- assignment scoping: another agent's task 404s at every step.

### Verification

| Command                                       | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint`                                   | PASS                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `pnpm typecheck`                              | PASS                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `pnpm test`                                   | PASS — core 234, web 43                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `pnpm --filter @koolee/core test:integration` | PASS — 44/44                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `pnpm build`                                  | PASS (web, agent, admin)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Browser E2E (agent app)                       | PASS — signed in as the seeded agent; home showed today's visit in slot order; guided flow: arrive → ID check → bag 1 sealed WITH photo (first attempt surfaced the storage-RLS grant bug → fixed via migration 0009 → retried, and the typed seal id/weight were preserved through the failure, proving the form-preservation fix under real conditions) → bag 2 sealed → complete → the SQL-seeded demo booking exercised the CAPTURE-FAILURE rail: booking → `exception`, agent shown the ops banner. DB verified: full ordered custody trail (created → arrived → identity → 2× sealed → verified_sealed → exception_raised) all with the real agent actor; seals + weight + photo on the bag rows; task done; 2 objects in the private bucket |

(The funnel was not touched this phase; the Phase 4 E2E pass stands.)

## Interjection (during Phase 7) — email-change confirmation gap (TD report)

**Timestamp:** 2026-08-09 ~11:15 (local)

TD reported: profile said "confirmation pending", Mailpit delivered a
6-digit code, but nothing outside the booking funnel accepted it.

**Fix:** `confirmEmailCode` server action + code-entry form rendered on
`/dashboard/profile` whenever an email is pending — the exact
`verifyOtp({ type: "email_change" })` call the funnel's proven verify step
uses (ONE mechanism, no second path), then `markEmailVerified` on success.
The local email template (`supabase/templates/email-change.html`) now tells
the user where to enter the code; stack restarted to apply it. Chose code
entry over a magic link: links need redirect-URL allow-listing per
environment and break when opened on another device; the code path already
exists and is env-independent.

Files: `apps/web/src/app/dashboard/profile/{actions.ts,confirm-email-form.tsx,page.tsx}`,
`supabase/templates/email-change.html`. Verified: template renders with the
new copy, action verifies + flips the badge to "verified" (TD's own account
completed the pending flow live during the run).

## Phase 7 — Admin ops console: dispatch, oversight, manual overrides

**Timestamp:** 2026-08-09 ~11:40 (local)

### What was built

1. **Core dispatch service** (`packages/core/src/services/dispatch.ts`):
   `listActiveAgents` (active `staff_members` with the agent role),
   `assignAgentToBooking` (assignee validated with the same per-request
   check the agent app runs; verification + pickup tasks upserted together
   with the slot window; `paid → agent_assigned` through the matrix on
   first assignment; `booking.agent_reassigned` compensating event on
   reassignment; completed visits refuse reassignment; validation runs
   BEFORE any task write so refusals leave no orphan tasks),
   `resolveExceptionBooking` (exactly the three matrix moves from
   `exception`, required reason recorded in the compensating event with the
   admin's real id; `cancel_and_refund` reuses the Phase 5 refund path),
   `getOpsDashboard` + `listBookingsBoard` (real queries only; `atRisk` =
   paid + unassigned + window within 12h), `getBookingAssignment`.
2. **Admin UI**: overview page now shows real counts with deep links;
   `/bookings` is a filterable dispatch board (status / airport / today,
   at-risk rows highlighted); booking detail rebuilt — full custody trail
   (actor role + id, timestamp, metadata, evidence photos via 5-minute
   signed URLs from the service-role client, degrading to a placeholder
   without a key), bags + seals, payment history, assignment panel,
   exception-resolution panel (only in `exception`), generic transition
   controls retained for legal-event overrides.
3. Doc: `apps/admin/docs/ops-console.md`.

### Judgment calls (creative-latitude log)

- **One assignee for both tasks in v1** — the task split stays in the
  schema (verification + pickup rows), so a later driver role is a query
  change, not a migration.
- **At-risk is a derived flag, not a scheduler**: 12h horizon constant in
  core (`AT_RISK_HORIZON_MS`), computed at read time. No background jobs.
- **Resolution ≠ status edit**: the resolve panel only offers the three
  matrix moves from `exception`, each forced through `applyTransition` /
  the Phase 5 cancel path — there is no way to write a status directly.
- **Ordering bug fixed pre-test**: assignment originally validated status
  AFTER upserting tasks; a refused assignment would have left orphan tasks
  in an agent's list. Hoisted the check above the transaction; regression
  test pins it.
- **Signed-URL TTL 300s**: long enough for a review, short enough that a
  leaked trail URL goes stale.

### Files created/modified

New: `packages/core/src/services/dispatch.ts` (+
`dispatch.integration.test.ts`),
`apps/admin/src/app/bookings/[bookingId]/dispatch-forms.tsx`,
`apps/admin/docs/ops-console.md`.
Modified: `packages/core/src/services/index.ts`,
`apps/admin/src/app/page.tsx` (real dashboard),
`apps/admin/src/app/bookings/page.tsx` (board),
`apps/admin/src/app/bookings/[bookingId]/page.tsx` (detail rebuild),
`apps/admin/src/app/bookings/actions.ts` (`assignAgent`,
`resolveException`), `PROJECT-STATUS.md` (#31, #32, timeline).

### New tests (11, integration)

- assign: `paid → agent_assigned`, both tasks scheduled to the slot window,
  visible ONLY in the assignee's scoped list, custody event carries the
  admin actor;
- reassign: tasks move (no duplicates), `booking.agent_reassigned`
  appended, status untouched;
- completed visit refuses reassignment;
- inactive agent / admin / customer / wrong-status assignments refused —
  and provably leave no orphan task rows;
- `listActiveAgents` returns only active agent-role staff;
- non-admin blocked by the same role gate the actions run;
- `resume_transit` and `force_complete`: correct matrix moves, compensating
  event with reason + admin actor, original exception event still present;
- `cancel_and_refund`: auth voided through the seam, slot seat released,
  both cancel + payment events appended;
- blank reason refused; resolution on a non-exception booking rejected by
  the matrix, neither refusal mutates the booking;
- dashboard/board: counts match real rows, at-risk exactly the unassigned
  paid booking, status filter narrows.

### Verification

| Command                                       | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint`                                   | PASS (6/6 tasks)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `pnpm typecheck`                              | PASS (6/6 tasks)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `pnpm test`                                   | PASS — core 245 (190 unit + 55 integration; core's test script runs both), web 43                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `pnpm --filter @koolee/core test:integration` | PASS — 55/55 (11 files)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `pnpm build`                                  | PASS (web, agent, admin)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Browser E2E (admin app)                       | PASS — signed in as seeded admin; overview showed real counts (1 window today, 1 unassigned, 0 exceptions); board showed both paid bookings flagged at-risk with working filters; detail page: assigned the seeded agent (badge → "Agent assigned", panel → "Currently: agent@koolee.local", trail appended `booking.agent_assigned` with the admin actor) → raised an exception via the override with a reason (badge → "Needs attention", resolve panel appeared) → resolved as "bags moving again" (status → in_transit, trail appended `booking.exception_resolved_resumed` with reason + `source: admin_exception_resolution`, panel disappeared, legal moves updated). 5-event trail rendered with actor roles, ids, timestamps, metadata |

---

# Run summary

**Branch:** `feat/overnight-run-1` (from `dev` @ `4d80bb7`). No git commands
were run at any point; TD commits and opens the PR manually.

## Phases

| Phase | What shipped                                                                                           | Gate  |
| ----- | ------------------------------------------------------------------------------------------------------ | ----- |
| 0     | Launch-checklist #25 wording fix (two independent test-OTP sources)                                    | green |
| 1     | #12 — verified customer session threaded through booking; placeholder customer deleted                 | green |
| 2     | #13 — staff auth: email/password, invite-only, `staff_members` + `requireStaffRole`; dev stubs deleted | green |
| 3     | #14 — ticket extraction: `TicketExtractor` seam (heuristic/Claude), private uploads, review quarantine | green |
| 4     | #27 — customer account area: profile, saved addresses (+`label`), booking detail, funnel one-tap       | green |
| 5     | #29 — payment lifecycle: webhook replay guard, capture at visit, refund/void on cancel                 | green |
| 6     | #30 — agent verification visit: guided flow, bag photos via storage RLS, capture-failure rail          | green |
| 7     | #31 — admin ops console: dispatch board, assignment, exception resolution, real dashboard              | green |
| —     | Interjections: #28 form preservation everywhere; #32 email-confirmation entry point                    | green |

## Test growth

- Integration (core, GoTrue-backed local stack): **22 → 55** (10 → 11 files).
- Unit: core 190, web 43 (all pre-existing suites still green).
- Migrations added: `0004`–`0009` (staff, uploads, address label, webhook
  events + capture ref, bag-photos bucket, SECURITY DEFINER staff check) —
  all additive, applied to the LOCAL stack only.

## Consolidated TODO list (everything deferred, in one place)

1. **QR/RFID seal scanning** (`TODO(agent-flow)`, Phase 6): manual seal-id
   entry ships; scanning needs the #18 seal-technology decision.
2. **Driver flow / pickup task UI** (Phase 6/7): pickup tasks are created
   and assigned but the agent app shows a placeholder card; `mark_awaiting_pickup`
   and `start_transit` currently happen via admin overrides.
3. **Real notification sends** (#15/#16): `NotificationDispatcher` logs to
   console; reminder SMS / ops-alert emails are seams awaiting Twilio/Resend.
4. **Exceptions page polish** (`/exceptions` in admin): lists exception
   bookings; resolution happens on the detail page. Could grow bulk tooling.
5. **Refund partials**: refunds are full-amount only by design (v1); partial
   refunds need product rules first.
6. **Slot capacity race**: `bookedCount` increments are transactional but
   there is no overbooking fence beyond `capacity` checks at read time —
   fine at current volume, revisit before marketing pushes.
7. **README `ANTHROPIC_API_KEY` row**: README env table lists the key; keep
   in sync if the extraction default changes.
8. **Storybook**: repo has none; UI work followed existing patterns. If
   Storybook is added later, the new `packages/ui` pieces
   (`usePreservedFormValues` consumers) deserve stories.

## Activation steps for TD (manual, in order)

1. **Review + commit + PR**: `git status` will show the full diff on
   `feat/overnight-run-1`. Commit message suggestion at the end of this file.
2. **Claude extraction (optional)**: set `ANTHROPIC_API_KEY` in
   `apps/web/.env.local` to switch ticket extraction from heuristic to
   Claude (`claude-haiku-4-5`). No code change needed.
3. **Stripe webhooks (optional, test mode)**: `stripe listen --forward-to
localhost:3000/api/webhooks/stripe` and set the printed
   `STRIPE_WEBHOOK_SECRET`; the fake provider path needs nothing.
4. **Hosted Supabase (when promoting)**: add
   `http://localhost:3001/auth/callback` + `:3002` equivalents to the
   hosted project's redirect allow-list (local `config.toml` already has
   them); apply migrations `0004`–`0009` to hosted via the direct URL —
   they were run ONLY locally per the run rules; re-check launch items
   #24/#25.
5. **Seeded dev staff creds**: `admin@koolee.local` / `koolee-admin-dev-1`,
   `agent@koolee.local` / `koolee-agent-dev-1` (local stack only; seed
   refuses non-local hosts).

## Suggested commit message

```
feat: overnight run 1 — sessions, staff auth, extraction, account area,
payments close-out, agent visit, admin ops console

- #12 booking flow uses the verified customer session end to end
- #13 staff auth (email/password, invite-only) via staff_members + requireStaffRole
- #14 ticket extraction seam: heuristic default, Claude behind ANTHROPIC_API_KEY
- #27 customer account area (profile, addresses, booking detail)
- #28 failed form submissions preserve input everywhere (usePreservedFormValues)
- #29 payment lifecycle: webhook idempotency, capture at visit, refund on cancel
- #30 agent verification visit with bag photos over staff storage RLS
- #31 admin ops console: dispatch board, assignment, exception resolution
- #32 email-change confirmation entry point on the profile page
- migrations 0004–0009 (additive); integration suite 22 → 55 tests
```

---

## Post-run addendum (2026-08-09 evening, interactive) — durable local data + full test roster

TD kept losing local accounts/data and asked for (a) a persistent local
setup and (b) a full roster of test accounts. Root cause of the losses:
dev servers and the integration suites share the one local database, the
suites truncate tables for isolation, and — the silent part — plain
`pnpm test` ALSO ran the integration files because `vitest.config.ts`
auto-loads `.env.test`. (A separate "Overnight Run 2" session's test runs
during the evening were the specific trigger that day.) The Docker volume
itself was proven durable: a full `supabase stop`/`start` cycle preserved
all counts.

**Changes:**

1. `pnpm test` (core) now excludes `*.integration.test.ts` — unit runs
   never touch the database.
2. `pnpm --filter @koolee/core test:integration` re-seeds automatically
   after the run (pass or fail) — the only DB-truncating command now
   restores the roster itself.
3. New `pnpm seed:local` (root + `packages/db/src/seed-local.ts`): pins
   both DB URLs to `127.0.0.1:54322` BEFORE anything reads env (so the
   hosted URL in `packages/db/.env` can never be a seed target by
   accident) and loads `.env.test` itself — no more manual sourcing.
4. Seed roster expanded (dummy names, local-only, hard-refuses non-local
   hosts): 2 admins (`admin`/`admin2@koolee.local`), 5 agents
   (`agent`–`agent5@koolee.local`), passwords `koolee-<role>-dev-<n>`;
   2 customers `+13322602830`/`+13322602831` (Casey Rivera / Morgan Lee),
   OTP `123456` via new `[auth.sms.test_otp]` entries in
   `supabase/config.toml` (valid-format numbers → usable in the web UI).
   Staff rows carry full names so admin dropdowns read like a real roster.

**Files:** `packages/db/src/seed.ts`, `packages/db/src/seed-local.ts` (new),
`packages/db/package.json`, `packages/core/package.json`, `package.json`,
`supabase/config.toml`, `apps/admin/docs/staff-auth.md`.

**Verified:** seed:local creates all 9 accounts idempotently; stop/start
cycle preserves data (63 slots / 7 staff / 9 users before and after); unit
run = 12 files, 215 tests, zero DB contact; integration run = 68/68 (incl.
run-2's 13 payment-intent tests) followed by automatic roster restore;
GoTrue password grant 200 for admin2/agent2/agent5; customer OTP
send+verify 200 for +13322602830 (browser check skipped — the Playwright
profile was held by the run-2 session; the API calls are the same ones the
login pages make).

**Follow-up (same evening):** a parallel session's direct `vitest run`
invocations bypassed the script-level re-seed and wiped the roster again.
Added a config-level safety net: `packages/core/vitest.global-setup.ts`, a
global teardown wired into `vitest.config.ts` that runs after EVERY core
vitest invocation (scripts, IDE extensions, parallel sessions alike),
probes for the seed's own markers (the dev admin account + a real slot
horizon — leftover per-test rows can't fool it), and re-seeds only when the
roster is actually gone. Local-host guard; unit runs pay one ~ms probe.
Verified: a direct `vitest run dispatch.integration.test.ts` truncated and
the teardown restored the full roster unprompted.
