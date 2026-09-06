# Run report 5 — Tier 3: booking agreements (versioned) + passport verification

> ⚠️ **Partly superseded.** The re-acceptance model described below — where
> publishing a new agreement version un-gates every in-flight booking and asks
> those customers to accept again — was reversed on 2026-08-29 in favour of
> **version pinning**: the version a booking accepts governs it for life.
> See [RUN-REPORT-6.md §6](RUN-REPORT-6.md) and
> [docs/features/agreements-and-passport.md](../features/agreements-and-passport.md).
> Everything else here (schema, passport verification, the visit gate) still
> stands. This report is left as written — it is the record of what was decided
> at the time.

**Branch:** `feat/agreements-and-passport` (cut from `origin/dev` @ `2094264`,
`--no-track`, `branch.merge` verified empty, `git status -sb` shows no upstream).

**Scope:** versioned booking agreements a customer must accept, and a manual ($0)
passport verification the assigned agent performs at the door. Both become a hard
gate on the verification visit.

**Explicitly NOT built** (per the slice brief): paid identity APIs (Stripe Identity /
Persona / Onfido), long-term or reusable agreements, e-signature vendors, driver-side
anything, and OCR/extraction of the passport image. Automated passport validity
checking exists as an interface + a no-op default and nothing more.

---

## Phase 1 — Schema (migration `0022_funny_the_fallen`) ✅

### Tables

| Table                    | Shape                                                                                                                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `agreement_versions`     | `version` (int, UNIQUE, monotonic), `title`, `body_md`, `effective_from` (timestamptz), `published_by` → `users`, `created_at`                                                                         |
| `agreement_acceptances`  | `booking_id`, `agreement_version_id`, `accepted_at`, `accepted_by_user_id`, `evidence` jsonb, `created_at`; UNIQUE `(booking_id, agreement_version_id)`                                                |
| `passport_verifications` | `booking_id` (UNIQUE), `status` enum, `photo_storage_path`, `uploaded_at`, `confirmed_at`, `confirmed_by_agent_id`, `validity_check_status` enum, `validity_check_provider`, `created_at`/`updated_at` |

Two new enums: `passport_verification_status`
(`pending` / `customer_uploaded` / `agent_confirmed` / `failed`) and
`passport_validity_check_status` (`not_checked` / `passed` / `failed`).

### The three decisions worth writing down

**1. No `is_active` on `agreement_versions`.** Current = `max(version)` where
`effective_from <= now()`. That is a derivation and it stays one. A boolean beside it
is a second source of truth for the same question and the two drift the first time
anything writes one without the other — which is the pricing-rule leakage (#41/#51)
exactly. Here it is not "enforced", it is impossible: there is no column to get wrong.

**2. `agreement_acceptances` is append-only at the database.** Same mechanism as
`custody_events` (0001): a `BEFORE UPDATE` / `BEFORE DELETE` row trigger plus a
`BEFORE TRUNCATE` statement trigger, all raising `restrict_violation`. It holds against
psql and against a service-role client, not just against a convention. A separate
function from custody's, because the message is the point — the way forward here is
"publish a new version and record a new acceptance", which is different advice.

**3. `passport_verifications` stores nothing about the passport.** No number, no name,
no DOB, no nationality, no MRZ, nothing extracted by any means. A storage path and
three statuses. The table has to be worthless to an attacker who can read it: a
passport number in a column is an identity-theft primitive with an indefinite shelf
life, whereas a private-bucket path has a signed URL, a live session and a 5-minute TTL
in front of it. If a validity checker ever ships, it writes back a STATUS, never the
fields it read to produce one.

### Custom SQL appended below the generated DDL

- the append-only trigger set above;
- `ENABLE ROW LEVEL SECURITY` on all three tables. 0016 promises RLS on every `public`
  table and `db:status` asserts it; where the `ensure_rls` event trigger exists it has
  already done this by the time we reach the statement (idempotent no-op), and where it
  does not — any project whose `postgres` lacks superuser, i.e. the normal Supabase
  case — nothing would have. No policies: these tables are reached only through core on
  the direct connection, so the empty-policy deny is the correct posture and a policy
  would imply a client path that does not exist;
- the PRIVATE `passport-photos` bucket + `passport_photos_staff_insert` /
  `passport_photos_staff_read` storage policies.

**Bucket-pattern deviation, stated on purpose.** The brief said to mirror
`ticket-uploads` (lazy `ensureBucket` from a route holding the service key). It is
mirrored on **`bag-photos` (0008)** instead, because the writer profile matches that one
and not tickets: the AGENT app uploads to this bucket for an at-the-door capture, and
that app deliberately holds no service-role key, so its uploads run as the signed-in
agent over the anon key and storage RLS is the only authorization mechanism available.
The ticket-uploads pattern cannot gate the agent at all. The customer's pre-upload path
does go through the web app's service-role client and bypasses these policies; it is
gated in core by booking ownership. Consequence for hosted: the bucket arrives with the
migration rather than as a separate dashboard step — the manual step is applying 0022,
which was already TD's manual step per PROJECT-STATUS §3.1.

The bucket block is guarded on `to_regclass('storage.buckets')` so a plain Postgres
(docker-compose, CI) still migrates cleanly. 0008 predates that guard.

### Seed

One canonical `agreement_versions` row: v1, `effective_from` = Unix epoch (so the
derivation resolves it immediately — a seed-only shortcut;
`publishAgreementVersion` refuses a retroactive date). Placeholder launch copy under
the standing copy rules: "delivered to your airline's bag drop", an explicit "we do not
check you in", no numbers we cannot stand behind, and a closing line telling the
operator to replace it with legally reviewed text at `/agreements`.

Idempotent on `version`, NOT on the body — a re-run refreshes v1 in place rather than
publishing a v2. Inserting a new version per seed would silently un-accept every
booking in the local database, because the gate is version-specific by design.

### Files

| File                                            | Change                                                                     |
| ----------------------------------------------- | -------------------------------------------------------------------------- |
| `packages/db/src/schema/agreements.ts`          | new                                                                        |
| `packages/db/src/schema/passport.ts`            | new                                                                        |
| `packages/db/src/schema/index.ts`               | register both                                                              |
| `packages/db/src/schema/relations.ts`           | booking → acceptances / passport verification; the three new relation sets |
| `packages/db/drizzle/0022_funny_the_fallen.sql` | generated DDL + the custom block                                           |
| `packages/db/drizzle/meta/*`                    | snapshot + journal (idx 22)                                                |
| `packages/db/src/seed.ts`                       | `seedAgreementV1`                                                          |

### Verified

- `pnpm db:migrate` against LOCAL only (`Target host: 127.0.0.1`). Hosted is untouched
  and remains TD's manual step.
- `pnpm db:status` → `Applied: 23 of 23 (matched by content hash) — In sync`.
- Direct catalog checks: `passport-photos` present with `public = f`; `relrowsecurity`
  true on all three tables; the three append-only triggers present on
  `agreement_acceptances`.
- `pnpm seed:local` run twice → still exactly one `agreement_versions` row at v1.
- `turbo typecheck` 6/6, `turbo lint` 6/6.

---

## Phase 2 — Core: the agreement service ✅

`packages/core/src/services/agreements.ts`.

| Function                                                 | What it does                                                                                                              |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `getCurrentAgreementVersion(db, now)`                    | one query: `effective_from <= now`, `order by version desc limit 1`                                                       |
| `acceptAgreement(config, {bookingId, userId, evidence})` | ownership + status check, inserts against the CURRENT version, idempotent on the unique key, appends `agreement.accepted` |
| `bookingHasCurrentAcceptance(db, bookingId, now)`        | the gate predicate                                                                                                        |
| `getBookingAgreementState(db, bookingId, now)`           | what a UI needs in two queries, incl. `supersededAcceptance`                                                              |
| `publishAgreementVersion(config, {...})`                 | version = max+1 in one transaction, refuses a retroactive `effective_from`                                                |
| `listAgreementVersions` / `getAgreementVersionById`      | admin reads                                                                                                               |
| `countBookingsNeedingReacceptance(db)`                   | the number the publish confirmation shows                                                                                 |

**Ordering by `version`, not `effective_from`.** Two versions may legitimately
share an effective date, and "whichever the planner returned first" is not an answer
we can defend to a customer. `version` is monotonic and UNIQUE, so it is the only
tiebreak that cannot be ambiguous.

**The client never names a version.** `acceptAgreement` resolves the current one
server-side. A page that rendered v1 and submits after v2 goes live cannot satisfy the
gate by naming v1 — which is the whole security value of a versioned agreement.

**A no-op re-accept appends no custody event.** The trail records what happened, and on
the second submit nothing happened. The row is returned with `created: false` so the UI
can still say "accepted".

**The gate fails CLOSED when nothing is published.** An empty `agreement_versions`
quietly satisfying the gate would mean a database that lost its agreement rows silently
stops requiring agreements — the worst possible way to discover that.

**A small clock-skew tolerance (60s) on `effective_from`,** to absorb the difference
between the form's rendered "now" and the server's. It is not permission to backdate.

Also: `ConflictError`'s field union gained `"passport"` (exported as `ConflictField`),
so passport conflicts are not mislabelled as address ones.

### Tests — `agreements.integration.test.ts`, 17/17

Derivation with a scheduled-but-not-live version present; the boundary tested at
`effective_from − 1ms` and at the instant itself (inclusive); idempotent accept
(one row, one custody event); evidence omits absent keys rather than inventing them;
404 on someone else's booking; refusal past `verified_sealed`; refusal with nothing
published; accept resolves the current version when a stale one exists; the gate
flipping false on publish and true again on re-accept with BOTH acceptances retained;
publish max+1 and from-empty; retroactive refusal; future `effective_from` not yet
current; empty title/body; the re-acceptance count; and the append-only trigger
verified by SQLSTATE `23001` on the cause chain plus the row still being intact.

---

## Phase 3 — Core: passport service + the visit gate ✅

`packages/core/src/services/passport.ts` and a new seam at
`packages/core/src/passport/`.

| Function                                                         | What it does                                                                                       |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `recordCustomerUpload(config, {bookingId, userId, storagePath})` | ownership check, `pending`/`customer_uploaded` → `customer_uploaded`, `passport.customer_uploaded` |
| `recordAgentCapture(config, session, {taskId, storagePath})`     | assignment check, same transition, `passport.agent_captured`                                       |
| `confirmPassport(config, session, {taskId,…})`                   | assignment check, → `agent_confirmed`, `passport.agent_confirmed`                                  |
| `getPassportVerification` / `bookingPassportConfirmed`           | reads                                                                                              |

**Why the seam moved out of `services/`.** `PassportValidityChecker` +
`NotCheckedValidityChecker` + `createPassportValidityChecker` live in
`packages/core/src/passport/` beside `payments/`, `notifications/`, `extraction/` and
`events/`. `config.ts` has to name the default, and `config.ts` sits BELOW services in
this package's layering — the same reason `Notifier` is not in `services/`. Wired as
`CoreConfig.passportValidityChecker`, defaulting to the no-op. Core still reads no env.

**The stub returns `not_checked`, never `passed`.** A stub that passed would write a
lie into the database — a row claiming a check happened. The manual agent confirmation
is the control that actually holds; an honest absence is the correct value.

**Confirmation is idempotent and does not re-stamp.** A second confirm returns the
existing row rather than overwriting `confirmed_by_agent_id` / `confirmed_at`, which
would quietly rewrite who vouched for this traveler and when.

### The visit gate — `agent-visit.ts`

`VisitContext` gained `identityGate: VisitIdentityGate` (`agreement`, `passport`,
`passportConfirmed`, ordered `blockers`, `passed`), computed in `getVisitContext`
alongside everything else — a gate the UI has to fetch separately is a gate that can be
rendered as passed before the answer arrives.

- `recordIdentityVerified` is **removed**, not deprecated. It wrote
  `visit.identity_verified` when the agent tapped "ID matches the ticket" — evidence of
  a tap. Two ways to satisfy identity means the weaker one is the one used at 6am.
  `confirmVisitIdentity` replaces it and delegates to `confirmPassport`.
- `VISIT_EVENT_TYPES.identityVerified` **stays as a constant**: it is the only record of
  every visit performed before this slice, and the timeline still renders it. Nothing
  reads it to decide anything.
- `recordBagSealed` calls `assertIdentityGate` FIRST; `completeVerificationVisit` checks
  it too (belt and braces — a zero-bag booking would slip past "every bag sealed
  implies the gate passed"). Enforcement is in core because a server action stays
  reachable as a POST whatever the UI renders.
- **No override.** A blocked agent files an exception, which raises the booking and
  emails ops (B2's seam). An override button's only use is to bypass the control this
  slice exists to add, and it would be pressed by someone who just wants to finish.
- `getVisitContext` gained an injectable `now` (defaults to real now for the render
  path, which holds `db` not a `CoreConfig`); every config-holding function passes
  `config.clock.now()` so a fixed clock governs the gate in tests.

### Custody event names added

`agreement.accepted` · `passport.customer_uploaded` · `passport.agent_captured` ·
`passport.agent_confirmed`

### Tests

- `passport.integration.test.ts` — **11/11**: row created on first upload; replacement
  while unconfirmed with `replacedStoragePath` in the trail; replacement refused after
  confirmation; 404 on someone else's booking with no row created; the agent capture's
  distinct event name and path-not-URL in `photo_url`; confirm from `pending` with
  `hadPhoto: false`; confirm from `customer_uploaded` keeping the customer's photo;
  idempotent confirm (one event, original agent retained); assignment enforced on both
  agent paths; **a catalog assertion that `passport_verifications` carries no
  `passport_number` / `date_of_birth` / `mrz` / … column** — asserted against
  `information_schema`, not the TS type, because the catalog is what actually exists;
  and the default checker's verdict.
- `agent-visit.integration.test.ts` — **13/13**, updated: fixtures seed a v1 agreement
  and accept it, `recordIdentityVerified` → `confirmVisitIdentity`, event assertions
  now on `passport.agent_confirmed`. Four new gate tests: blocked on the agreement half;
  blocked on the passport half and unblocked by confirmation (including the check that
  `customer_uploaded` is NOT enough); publishing v2 re-closing the gate mid-flight and
  re-accept re-opening it; and the pre-upload → confirm path with per-actor attribution.
- `test-utils/preserve-existing-rows.ts` gained the three new tables so the
  shared-database suites clean up after themselves.

### Gates after Phase 3

`turbo typecheck` 6/6 · `turbo lint` 6/6 · unit tiers 4/4 (core 289, web 62, admin 19,
agent 6) · core integration **128 passed, 3 skipped** (was 96/3 — 32 new).

One Phase-5 change pulled forward to keep the gates green: the agent app's
`verifyIdentityAction` → `confirmPassportAction`, a rename over the new core function.
The passport UI itself is Phase 5.

---

## Phase 4 — Customer web app ✅

### The trip page's "Action needed" section

Two cards above the pickup details, and the **asymmetry between them is the
design**: the agreement is a gate, so it leads and says so; the passport is a
convenience, so its badge reads `optional` and its copy says the agent checks at the
door either way. Anything that made the passport card look like a second requirement
would tell people who cannot photograph a passport on a phone that they cannot travel
with us — which is false.

- **Agreement card** — version + effective date, a "Read the agreement" disclosure
  rendering `body_md`, and one accept CTA. Accepted state shows the version and the
  acceptance timestamp. When a newer version publishes, the card returns to
  needs-action with _"Our agreement was updated — please review version N and accept
  again"_, which is materially different from "you have not accepted" to someone who
  remembers accepting (that is what `supersededAcceptance` is for).
  Nothing published → the card renders nothing rather than a button that cannot work;
  the gate fails closed in core and ops sees the blocked visit, which is the right
  place for that alarm.
- **Passport card** — status, the photo (short-TTL signed URL) when there is one, and
  an add/replace control while `pending`/`customer_uploaded`. Carries the sentence
  _"we keep the photo and nothing else — we never record your passport number, name,
  or date of birth"_, because a customer being asked to photograph a passport is owed
  the actual data commitment, not a padlock icon.

Both cards disappear once the booking is past the visit (`preVisit` mirrors
`AGREEMENT_ACCEPTABLE_STATUSES`).

### Photo downscale — shared, not duplicated

`apps/agent/src/lib/photo.ts` moved to **`packages/ui/src/lib/photo.ts`**, exported as
`@koolee/ui/lib/photo` (a subpath beside the existing `./lib/utils`, so it stays out of
the component barrel — it touches no React). Two apps now capture photos on a phone and
the 413 it prevents is identical in both; the agent import was updated, nothing was
copied.

### `Markdown` — a deliberately small renderer

`packages/ui/src/components/markdown.tsx`. `##`/`###`, `---`, `-` lists, paragraphs,
`**bold**`/`_italic_`. **No dependency and no `dangerouslySetInnerHTML`** — it emits
React elements only, so the worst a malformed agreement can do is look wrong. Every
general-purpose renderer's escape hatch is raw HTML and the safe way to use one is to
turn that off, at which point what remains is about this. Links are omitted on purpose:
an agreement that can point elsewhere is an agreement whose terms live somewhere we do
not version.

### Upload path

`POST /api/passport-photos` — a route, not a Server Action, matching
`/api/ticket-uploads`. Server Actions cap the body at 1 MB; the browser downscales
first, but a browser that CANNOT downscale hands back the original 5 MB capture, which
would 413 before any of our code ran and produce an error the customer can do nothing
with. The route accepts it and refuses with a sentence.

Order is store-then-record: a `passport_verifications` row pointing at an object that
failed to upload is a broken image for the customer and a photo the agent expects to
find and cannot. Authorization is core's — `recordCustomerUpload` 404s on anyone
else's booking.

`apps/web/src/lib/passport-photos.ts` signs reads at a **120-second TTL**, deliberately
shorter than bag photos' 300s: a signed URL is a bearer credential for the object and
this object is somebody's passport. The page server-renders on every request, so
nothing is gained by letting the link outlive the view. `upsert: false` with a fresh
uuid per object — a replacement is a NEW object, never an overwrite of the one the
custody trail already points at.

### Emails and the reminder SMS

Confirmation and reminder emails (text AND html) now name the agreement and point at
the trip page; the confirmation adds the optional passport pre-upload, explicitly
marked optional. The reminder SMS and the trip page's "have ready" line moved from
"photo ID" to "passport" — the gate is a passport check now, and telling someone to
have a driving licence ready would set them up to fail at their own door.

Copy rules held throughout: bags are "delivered to your airline's bag drop", and no
message claims we check anyone in.

### Files

`apps/web/src/app/api/passport-photos/route.ts` (new) ·
`apps/web/src/app/trips/[bookingId]/actions.ts` (new) ·
`apps/web/src/components/trip-action-needed.tsx` (new) ·
`apps/web/src/lib/passport-photos.ts` (new) ·
`apps/web/src/app/trips/[bookingId]/page.tsx` ·
`packages/ui/src/components/markdown.tsx` (new) ·
`packages/ui/src/lib/photo.ts` (moved from apps/agent) ·
`packages/ui/src/index.ts` · `packages/ui/package.json` ·
`apps/agent/src/app/tasks/[taskId]/visit-flow.tsx` (import) ·
`packages/core/src/notifications/emails.ts` · `packages/core/src/jobs/functions.ts`

### Gates after Phase 4

`turbo typecheck` 6/6 · `turbo lint` 6/6 · unit tiers 4/4 (core **291** — two new
email-copy tests, web 62, admin 19, agent 6) · prod builds **3/3**.

---

## Phase 5 — Agent app ✅

The visit's step 2 is now the gate, rendered as two panels:

- **Booking agreement** — accepted vN + the acceptance timestamp (in the
  BOOKING's zone), or `not accepted` with _"Ask the customer to open their trip
  page and accept the agreement. You can't do this for them"_ and a **Check
  again** button. No agent-side override, and none is offered.
  A third state exists for `supersededAcceptance` ("our agreement changed since
  they accepted") and a fourth for nothing published ("call ops").
- **Passport** — the photo at a signed URL when there is one, with _"Compare it
  to the document in the traveler's hand — a photo on file is not a check"_; an
  optional capture/replace form; and the confirm action.

Capture and confirm are deliberately **separate actions**: capture is evidence,
confirmation is a judgement, and uploading must not open the gate on its own.

The sealing steps and the Complete step render only when `identityPassed`. That
is convenience — core refuses `recordBagSealed` and `completeVerificationVisit`
regardless, which is the guarantee.

New/changed: `capturePassportAction` + `confirmPassportAction` (replacing
`verifyIdentityAction`), `apps/agent/src/lib/passport-photos.ts` (upload +
signed URL as the signed-in agent over the anon key — this app holds no service
key), the page's view model, and `VisitView` gaining `identityPassed`,
`agreement`, `passport`.

**Also fixed here (pre-existing, one line each):** both photo-upload forms
dispatched their `useActionState` action _after_ an `await`, which leaves the
transition React opened for `<form action>` — a console error, and `pending`
never flipping. Both now re-enter via `React.startTransition`. `BagStep` had
this before this slice; leaving the two adjacent paths inconsistent would have
been worse than the drive-by.

### Playwright — DEFERRED, with the reason

The brief asked for three Playwright smokes. **There is no Playwright harness
in this repo** — no config, no dependency, no fixtures, no CI wiring. (The
end-to-end pass PROJECT-STATUS mentions was driven interactively, not from a
checked-in suite.) Standing one up is a substantial piece of new infrastructure
and a new dependency, which is TD's call, not a line item inside this slice.

What was done instead: **all three scenarios exist as core integration tests**
(they are the four gate tests in Phase 3), and **all three were driven manually
in a real browser** against the local stack — see "Browser verification" below.
Building the harness is the right follow-up and should be its own slice.

---

## Phase 6 — Admin app ✅

**`/agreements`** (added to the nav): every version newest-first, badged
`current` / `scheduled` / `superseded` — derived, never a toggle, because there
is nothing to toggle. Body readable behind a disclosure. The publish form takes
title, Markdown (with a live preview), and an optional effective-from.

The confirmation is a checkbox **naming a number** — "I understand that N
in-flight bookings will be asked to accept this version again, and that an
agent cannot collect bags until each customer has" — not a generic "are you
sure". Publishing's cost is invisible unless it is spelled out. The count is
recomputed server-side; the checkbox is the acknowledgement, not the check.

Admin-ness is enforced in the action (`requireAdminSession`), not in core:
`publishAgreementVersion` takes a `publishedBy` id and does not know what a
session is. `datetime-local` is parsed as **UTC** and the field says so —
interpreting it in the server's zone would mean the same keystrokes produce a
different instant on a laptop and on a UTC production box.

**Booking detail** gained an _Identity gate_ card: agreement state (version +
when, or outstanding, or superseded, or "no agreement is published") and
passport status. **No passport photo is rendered in admin, deliberately** — ops
has no reason to look at a customer's passport; the check is the agent's, at the
door, against the person, and every surface that can display it is a surface
that can leak it. The path is in the custody trail if an investigation needs it.

No audit framework was built (the brief said not to). Publishing is attributable
via `agreement_versions.published_by`; acceptance via the custody event.

Zone note: an agreement version belongs to no booking, so docs/TIME.md's "the
booking's zone" has nothing to point at. It renders in **UTC through the
sanctioned formatter** (which appends the abbreviation, so nothing is
unlabelled), matching the publish form's UTC input. The repo's ESLint
timezone-policy rule caught a raw `Intl.DateTimeFormat` here and was right to.

---

## Browser verification (local stack, all three apps)

Driven through the real UIs against `pnpm dev` + local Supabase, on two
purpose-made bookings:

| Scenario                                           | Result                                                                                                                   |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Visit blocked with the agreement unaccepted        | Gate shut, seal steps not rendered, agreement panel says the customer must accept                                        |
| Passport confirmed but agreement still outstanding | Gate still shut — one half is not enough                                                                                 |
| Customer accepts on the trip page                  | `agreement.accepted` written with REAL evidence (`userAgent` + `ip`), acceptance visible to the agent within one refresh |
| Gate opens                                         | Seal steps + Complete appear; a bag sealed successfully afterwards                                                       |
| Customer pre-upload                                | Object in the private bucket, `customer_uploaded`, photo renders back through a signed URL                               |
| Agent at-the-door capture over a pre-upload        | `passport.agent_captured` with `replacedStoragePath` naming the customer's original; **both** objects retained           |
| Full visit with a pre-uploaded passport            | arrive → confirm → seal, custody trail correct end to end                                                                |
| Admin `/agreements` and booking-detail gate card   | Render correctly, count shown, no photo in admin                                                                         |

Final custody trail on the pre-upload booking, in order:
`booking.created` · `booking.payment_authorized` · `booking.agent_assigned` ·
`passport.customer_uploaded` · `visit.arrived` · `passport.agent_captured` ·
`agreement.accepted` · `passport.agent_confirmed` · `bag.sealed` — each with
the right actor.

### The bug the browser found (and the tests could not)

The agent app logged **`failed to sign URL: permission denied for table
staff_members`** and rendered no passport photo. Migration 0022 had copied
0008's _original_ storage-policy form — an inline
`EXISTS (SELECT 1 FROM public.staff_members …)` — which is evaluated as the
`authenticated` role, and that role has no privilege on the roster table.
Migration **0009 had already fixed exactly this** for `bag-photos` with the
SECURITY DEFINER `public.is_active_staff`. Both the read and the agent's upload
were broken.

**Migration 0023** fixes it, mirroring 0009. A corrective migration rather than
an edit to 0022, because 0022 is already applied and recorded by content hash:
editing it changes the hash while its `folderMillis` sits at the watermark, so
the edited file would report pending and then be **skipped forever**
(PROJECT-STATUS §3.1, STRANDED). Squash the pair before merge if preferred.

**Why no test caught it:** the integration tier exercises core against a
_direct_ connection, where storage RLS is never consulted at all. The only
things that touch these policies are the agent app's anon-key upload and its
signed-URL read — both browser paths. Worth remembering when the Playwright
harness is built: this class of bug is exactly what it is for.

Two smaller things the browser also surfaced, both fixed:

- the customer's custody timeline rendered raw event names
  (`visit.arrived`, and my new `passport.*` rows next to labelled ones) —
  labels added for all of them, including the three pre-existing ones;
- the seed's epoch `effective_from` rendered to a customer as _"in effect from
  Wed 31 Dec, 7:00 PM EST"_, which reads like a bug. Now a fixed, readable
  `2026-01-01T00:00:00Z`.

---

## Phase 7 — Docs + close-out ✅

| Doc                                                     | Change                                                                                                                                                                                                                                                       |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `docs/features/agreements-and-passport.md`              | new — the full feature reference                                                                                                                                                                                                                             |
| `docs/features/agreements-and-passport-hosted-setup.md` | new — hosted migration command, bucket verification SQL, first-version seeding, smoke test                                                                                                                                                                   |
| `docs/features/README.md`                               | index row                                                                                                                                                                                                                                                    |
| `docs/features/agent-visit.md`                          | the identity step's table row + a ⚠️ note that `recordIdentityVerified` is gone                                                                                                                                                                              |
| `docs/CODEBASE-MAP.md`                                  | three new nouns, two new schema modules, three new invariants; **and a stale claim corrected** — it still said `packages/db/.env` points at HOSTED (flipped to LOCAL on 2026-08-22), plus a pointer that migration state comes from `db:status`, never prose |
| `PROJECT-STATUS.md`                                     | rows 63–66, a snapshot bullet, four new §7 standing constraints, last-updated/branch                                                                                                                                                                         |

**New environment variables: NONE.** Stated explicitly in the hosted doc,
because "no new env" is a claim worth being able to check. The validity-checker
seam is injected with a `{ kind: "none" }` literal and has no credential; the
bucket uses keys the apps already hold; the agreement body is data in a table.

### Custody event names added

`agreement.accepted` · `passport.customer_uploaded` · `passport.agent_captured` ·
`passport.agent_confirmed`

### Deferred, with reasons

| Item                                                    | Why                                                                                                                                                                                                                       |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Playwright smokes                                       | No harness exists in the repo; standing one up is new infrastructure + a new dependency, and TD's call. All three scenarios are covered by integration tests and were driven manually in a browser.                       |
| Deleting superseded passport photo objects              | A delete triggered by an ordinary customer retry is an irreversible write. The trail names the superseded path (`replacedStoragePath`). A retention sweep needs a retention policy decided first.                         |
| A writer for `passport_verifications.status = 'failed'` | The agent's route for "this passport is wrong" is the existing visit exception (`customer_id_mismatch`), which raises the booking and emails ops — a stronger action than a status flip, and already built.               |
| Squashing 0022 + 0023                                   | Left as two migrations rather than editing an applied file (§3.1 stranding). TD may squash before merge.                                                                                                                  |
| A `Markdown` component test                             | `packages/ui` has no vitest setup; adding one is out of this slice. The renderer emits React elements only — it cannot inject markup — and it is exercised through the trip page, the admin list and the publish preview. |

---

## Final gate

| Check                                 | Result                                                     |
| ------------------------------------- | ---------------------------------------------------------- |
| `turbo typecheck`                     | **6/6**                                                    |
| `turbo lint`                          | **6/6**                                                    |
| `prettier --check`                    | clean                                                      |
| Unit tiers                            | **4/4** — core 291, web 62, admin 19, agent 6              |
| Core integration (`koolee_test` only) | **128 passed, 3 skipped** (baseline was 96/3 — **32 new**) |
| Prod builds                           | **3/3**                                                    |
| `pnpm db:status` (LOCAL)              | `Applied: 24 of 24 (matched by content hash) — In sync`    |
| Hosted                                | **untouched** — 0022 + 0023 are TD's manual step           |

### Files changed, by phase

**1 — schema:** `packages/db/src/schema/{agreements,passport,index,relations}.ts` ·
`packages/db/drizzle/0022_funny_the_fallen.sql` + `meta/*` · `packages/db/src/seed.ts`

**2 — agreements core:** `packages/core/src/services/agreements.ts` (new) ·
`agreements.integration.test.ts` (new) · `errors.ts` (`ConflictField` +
`"passport"`) · `services/index.ts` · `index.ts`

**3 — passport core + gate:** `packages/core/src/services/passport.ts` (new) ·
`passport.integration.test.ts` (new) · `packages/core/src/passport/{checker,factory,index}.ts` (new) ·
`config.ts` · `services/agent-visit.ts` · `agent-visit.integration.test.ts` ·
`test-utils/preserve-existing-rows.ts`

**4 — web:** `app/api/passport-photos/route.ts` (new) ·
`app/trips/[bookingId]/actions.ts` (new) · `components/trip-action-needed.tsx` (new) ·
`lib/passport-photos.ts` (new) · `app/trips/[bookingId]/page.tsx` ·
`components/custody-timeline.tsx` · `packages/ui/src/components/markdown.tsx` (new) ·
`packages/ui/src/lib/photo.ts` (moved from apps/agent) · `packages/ui/{index.ts,package.json}` ·
`packages/core/src/notifications/emails.ts` + `emails.test.ts` · `packages/core/src/jobs/functions.ts`

**5 — agent:** `app/tasks/[taskId]/{actions.ts,page.tsx,visit-flow.tsx}` ·
`lib/passport-photos.ts` (new)

**6 — admin:** `app/agreements/{page.tsx,actions.ts,publish-form.tsx}` (new) ·
`app/bookings/[bookingId]/page.tsx` · `app/layout.tsx` · `lib/custody-copy.ts`

**Post-verification:** `packages/db/drizzle/0023_passport_photos_staff_check.sql` (new)

**7 — docs:** as tabled above, plus this report.
