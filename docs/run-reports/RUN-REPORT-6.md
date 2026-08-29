# Run report 6 — three parallel sessions, merged and validated

**Branch:** `feat/agreements-and-passport` (cut from `origin/dev` @ `2094264`,
`--no-track`). One commit exists (`b147a89`, the Tier-3 slice); **everything
described below beyond that commit is uncommitted and staged for TD.**

Three sessions worked this branch concurrently. This report covers all three,
the cross-session validation pass, and every bug that pass found.

| #   | Session               | Scope                                                                |
| --- | --------------------- | -------------------------------------------------------------------- |
| A   | Ticket extraction     | Claude adapter rewrite, deterministic segment selection, debug panel |
| B   | Design & brand        | Fonts in all three apps, `Card`/`Button` consolidation, icon sets    |
| C   | Agreements & passport | Tier-3 slice (`b147a89`) + the admin rich-text editor                |

Depth on C's schema, core services and visit gate is in
[RUN-REPORT-5.md](RUN-REPORT-5.md); it is not repeated here.

---

## 0. The concurrency incident, and what it cost

Mid-session I found ~44 files changing with mtimes seconds old, including files
I had never opened and two of my own. I **stopped rather than commit or
revert** — a `git checkout --` would have destroyed another session's live
work, and a commit would have mixed three workstreams into one changeset.

Two failures visible at that moment were **not** defects:

- `bookings/[bookingId]/page.tsx` unparseable — Session B's `<Card asChild>`
  refactor, caught mid-write;
- `Spinner is declared but never read` in my workbench — Session B replacing
  admin's seven `{pending ? <Spinner/> : …}` sites with `<Button loading>`,
  which is exactly what they reported doing.

Both resolved themselves when B finished. **Cost: one stopped turn.** The
lesson worth keeping is that a shared checkout makes "is this broken or is it
someone else mid-write?" unanswerable from the tree alone — mtimes and process
list were what settled it.

---

## 1. Session A — ticket extraction

### What it does

The model no longer chooses which leg matters. It transcribes every segment
through a forced `record_itinerary` tool call, and `select-segment.ts` picks
deterministically: one serviced departure → take it; several → earliest
unflown; two upcoming → low confidence plus the other leg offered as a swap;
none → name the origin we cannot serve. Scope is derived from the destination
country. `TICKET_EXTRACTION_DEBUG=1` returns the full diagnostics blob.

### Verified live, against the real Claude API

Uploaded the real `29909945_ticket.pdf` (the one that used to fail):

```
AI144 · EWR → DEL · 2017-12-12T13:15 · international · Karun Rathi
```

Previously AI101 / DEL / the January return leg. The debug panel renders in
full — model, latency, token usage, every segment with the model's own
`notes` (including that it read `19:25 Hrs` as a duration), the chosen index
and reason, and a working **Copy JSON**. That was one of two pieces Session A
could not verify; **it works.**

The **leg swap** was the other. It was unreachable with that fixture — the
alternative leg departs DEL, which we do not serve, so offering it would offer
something unbookable (correct behaviour). I generated a two-serviced-origin
ticket (`koolee-all/multi-serviced-legs-test.pdf`, kept as a fixture) and drove
the full round trip:

```
JFK/AI191/international → EWR/AI256/international → back to JFK/AI191
```

### Two bugs found and fixed

**A1 — the review form kept stale values after an upload or a swap.**
Every field on the flight step is an _uncontrolled_ input seeded by
`defaultValue`, which React applies only on mount. After a ticket upload the
page re-renders in place (`router.refresh()`), so the mounted inputs kept their
previous values while the prose around them updated from the new prefill. The
result was a form contradicting its own summary line: `AI144` and "Times are
EWR local" above a dropdown still reading **JFK**, an empty departure time, and
**Domestic** on an international ticket. A reload fixed it — the signature of
stale mounted state.

This is also why the swap could not be verified: it has the same shape.

_Fix:_ a `formSeedKey` on `CoverageStepForm` derived from the values the form is
seeded from, so it remounts exactly when those change.
→ `apps/web/src/app/book/flight/page.tsx`

**A2 — swapping legs asserted "Domestic" on a flight to Paris.**
`useTicketAlternativeLeg` deliberately cleared `scope`, reasoning that carrying
the other leg's value would assert something unread. Sound in principle, wrong
in effect: the form's fallback _is_ domestic, so clearing it asserted domestic
rather than "unknown" — the same silent-fallback failure Session A had just
fixed for the JFK airport default. Domestic vs international selects a
different bag-drop cutoff (45 vs 60 minutes), so this is an operational error.

The data was already there: the model reads `destinationCountry` per segment.

_Fix:_ each alternative carries its own scope, derived by the same `deriveScope`
helper the chosen leg uses, and the swap carries it in both directions.
→ `booking-draft-schema.ts`, `ticket-upload-handler.ts`, `book/actions.ts`,
plus a regression test.

---

## 2. Session B — design & brand

The real defect was not styling: only `web` called `next/font`, so **admin and
agent rendered every heading and all body text in `system-ui`**. A missing font
mount fails silently, which is why it went unnoticed. Admin also had no favicon.

Consolidation: `brandFontClassName` at `@koolee/ui/fonts` (a subpath, because
`next/font` only resolves in a Next build and Storybook builds this package
with Vite); `Card` absorbed 21 hand-rolled recipes and gained `asChild`;
admin's `Spinner` ternaries became `<Button loading>`; both `selectClassName`
copies deleted in favour of `Select` — the copies used `text-sm` where `Select`
uses `text-base md:text-sm`, so admin's selects zoomed on focus in iOS Safari
and web's did not.

### Verified in the browser

All three apps now serve an **identical** body class and computed fonts:

```
sora_9c318d45…variable inter_340cec82…variable font-sans min-h-dvh
body → Inter    headings → Sora
```

All nine icon files return 200 (`icon.svg`, `favicon.ico`, `apple-icon.png` ×
three apps). **No bugs found.** The claim holds exactly as written.

---

## 3. Session C — agreements & passport

`b147a89` is the Tier-3 slice: versioned agreements with a derived-current
model, append-only acceptances, manual passport verification that stores
nothing about the document, and a two-part visit gate with no override. Full
detail in [RUN-REPORT-5.md](RUN-REPORT-5.md).

### Added after that commit — the admin editor

| Item                                  | Detail                                                                                                                                                                              |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Rich text editor**                  | Tiptap 3.30.5, seven packages, MIT. Constrained toolbar: H2/H3, bold, italic, strike, bullet/ordered lists, quote, divider, undo/redo, plus Typography, CharacterCount, Placeholder |
| **One AST, two consumers**            | `packages/ui/src/lib/agreement-markdown.ts`. The editor and the customer-facing renderer are both built from `Block[]` rather than kept in step by discipline                       |
| **`packages/ui` gained a test setup** | 26 tests, incl. 22 round-trip/parity tests                                                                                                                                          |
| **80/20 workbench**                   | Editor left (966px), month-grouped history right (242px) — measured                                                                                                                 |
| **Edit scheduled / Amend published**  | Three explicit modes, not one form with flags                                                                                                                                       |
| **`DateTimeField` reused**            | The customer funnel's control replaces the raw `datetime-local`                                                                                                                     |
| **Migration 0024**                    | A version freezes the moment it takes effect                                                                                                                                        |
| **Reuse rule**                        | PROJECT-STATUS §7 + CODEBASE-MAP                                                                                                                                                    |

**`tiptap-markdown` was dropped from the plan.** It supports far more than our
node set, so its parser would happily accept markdown the renderer cannot show
— reintroducing exactly the divergence the AST exists to prevent. Hand-rolling
the conversion for a fixed, tiny node set is smaller, has no third-party
pre-1.0 dependency in a legal-document path, and makes parity **structural**.
One test asserts that node types the renderer cannot show (tables, images, code
blocks) are _dropped_, not half-rendered.

**Scheduling is the draft mechanism.** A version dated in the future is not
current, so `acceptAgreement` cannot have pointed at it, so it provably has no
acceptances and is safe to edit. That removed the need for a draft table
entirely — TD's own framing solved it.

### Verified in the browser

- Toolbar → markdown, every construct, typed into the live editor:
  `## h2`, `**bold**`, `*italic*`, `~~strike~~`, `- bullets`, `1. ordered`,
  `> quote`, `---`
- Amend loads v1's document; Edit loads v2 with **Save changes** and no
  acknowledgement checkbox (correct — editing a scheduled version asks nothing
  of anybody); title + effective date persisted to the database
- Customer trip page renders real `H2`/`P`/`HR` elements; accept works; the
  timeline records it
- Agent gate: **blocked** with passport confirmed but agreement unaccepted →
  seal and complete steps hidden; **opens** the moment the customer accepts
- Passport upload: private-bucket object, signed URL, correct state

### Bugs found and fixed in C

**C1 — migration 0023.** 0022 copied `bag-photos`' _original_ storage-policy
form (inline `EXISTS` on `staff_members`, evaluated as `authenticated`, which
has no privilege on that table). Migration 0009 had already fixed this exact
bug for bag photos. Caught in a browser, because the integration tier runs on
the direct connection where storage RLS is never consulted.

**C2 — the seed stopped being idempotent.** The freeze trigger rejected the
seed's `onConflictDoUpdate` on a now-frozen v1. Caught by the test suite's
teardown re-seed. Now `onConflictDoNothing` — insert once, never rewrite, which
is the correct semantics anyway.

**C3 — `React.startTransition`** around both photo-upload dispatches: awaiting
the downscale leaves the transition React opened for `<form action>`, so
`pending` never flipped. Pre-existing in `BagStep`; fixed both.

**C4 — seed effective date.** `2026-01-01T00:00:00Z` rendered to a customer as
"in effect from Wed 31 Dec, 7:00 PM EST" — correct (booking's zone) but reads
like an off-by-one on a version labelled v1. Now `05:00Z`, midnight in New York.

---

## 4. Cross-app sweep

18 pages across all three apps: **all 200, no crashes, no console errors**
(discounting React DevTools' transparent marker logs).

`/` `/pricing` `/how-it-works` `/waitlist` `/trips` `/trips/[id]`
`/dashboard/addresses` `/book/flight` · `/tasks` `/tasks/[id]` · `/`
`/bookings` `/bookings/[id]` `/blocks` `/zones` `/staff` `/exceptions`
`/agreements`

---

## 5. Final gate

| Check                                 | Result                                                                   |
| ------------------------------------- | ------------------------------------------------------------------------ |
| `turbo typecheck`                     | **6/6**                                                                  |
| `turbo lint`                          | **6/6**                                                                  |
| Unit tests                            | **5/5 packages, 438 tests** — core 315, web 72, ui 26, admin 19, agent 6 |
| Core integration (`koolee_test` only) | **133 passed, 3 skipped**                                                |
| Prod builds                           | **3/3**                                                                  |
| `pnpm db:status` (LOCAL)              | `Applied: 25 of 25 (matched by content hash) — In sync`                  |
| Hosted                                | **untouched** — 0022/0023/0024 are TD's manual step                      |

---

## 6. Version pinning — built

The re-acceptance model is gone. The rule now, enforced in code and schema:

> Every booking needs one acceptance, before the visit. That acceptance PINS
> the version, and that version governs the booking for its whole life. A new
> version never disturbs a booking already in flight. A new booking accepts
> whatever is current at that moment.

**Why it replaced re-acceptance.** A booking is a contract for one shipment,
formed at acceptance, and carriage/shipping/insurance all bind the terms in
force at purchase. The decisive point is that re-acceptance does not achieve
what it appears to: consent tapped at a doorstep with an agent waiting and the
bags packed is consent under duress. The old model was also internally
inconsistent — it blocked a pickup tomorrow morning over a wording change while
leaving a booking already in transit alone, which is not a principle but an
artifact of where the gate sat.

Per **booking**, not per customer: a repeat customer accepts again next time,
one tap at formation. Pinning a customer to their first version would leave
people shipping under years-old terms.

### What changed

| Layer                                  | Change                                                                                                                                                                                                                                                                             |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Migration 0025**                     | `UNIQUE (booking_id)` on `agreement_acceptances`, replacing `UNIQUE (booking_id, agreement_version_id)`. It **refuses to migrate** if duplicates exist rather than deleting them — they are append-only evidence, and which acceptance governs is a human decision, not a script's |
| **`bookingHasCurrentAcceptance`**      | → `bookingHasAcceptedAgreement(db, bookingId)`. One existence check, no version comparison                                                                                                                                                                                         |
| **`getBookingAgreementState`**         | Returns `acceptedVersion` — the pinned document — and only falls back to `currentVersion` when nothing is accepted. `supersededAcceptance` deleted                                                                                                                                 |
| **`acceptAgreement`**                  | Returns the existing acceptance if the booking already has one, so a stray second call can never re-pin it. Conflict target is `booking_id`                                                                                                                                        |
| **`countBookingsNeedingReacceptance`** | Deleted — nothing needs re-acceptance                                                                                                                                                                                                                                              |
| **Admin publish**                      | The acknowledgement checkbox is gone. In its place, a statement of fact: publishing applies to bookings made from the effective date onward and disturbs nobody mid-trip                                                                                                           |
| **Customer + agent + ops**             | All three show the PINNED version, not the newest                                                                                                                                                                                                                                  |

The database constraint is what actually holds: `acceptAgreement` reads then
inserts, so without it two concurrent submits could pin one booking to two
versions.

### Proven in the browser, with a live publish

Published **v4 effective immediately** against a booking already pinned to v1 —
precisely the case that used to re-close the gate mid-visit:

- **Agent:** gate still open, seal and complete steps visible, showing
  "Version 1 · accepted"
- **Customer:** "You accepted version 1 … a later update won't change them or
  ask you again"
- **Ops:** "v1 · … · pinned"
- **A booking with no acceptance** correctly offered **Version 4** and pinned to
  it on accept

Database after: three bookings pinned to v1, v1 and v4 respectively; maximum
acceptances per booking = 1.

Core integration went 133 → **135** (the pinning tests replace the re-accept
ones and add the concurrent-insert refusal).

### Two render loops found and fixed on the way

**L1 — `RichTextEditor` looped on every keystroke.** Tiptap's `useEditor`
returns a fresh `editor` reference per transaction, so my adopt-external-value
effect re-ran constantly; it compared a re-serialization against `value`, and
any normalisation difference (`_italic_` → `*italic*`) never converged, so
`setContent` fired, which is itself a transaction. 200 console errors per edit.
Now it compares against a ref holding what the editor last **emitted**, so an
echo of our own typing is recognised in one comparison.

**L2 — the admin workbench looped after a successful publish.** `onDone` was a
fresh closure per render and `setMode({ kind: "new" })` allocated a new object
every call, so React could never bail out and the effect's dependency changed
on every render. Now `resetToNew` is `useCallback`'d and returns the _same_
object when the mode is already blank — that second half is what actually stops
it.

Both verified at **zero console errors** through a full type-and-publish cycle.

---

## 7. Open items — decisions, not defects

1. **`TICKET_EXTRACTION_DEBUG` must never be set on production Vercel.** The
   payload is a developer tool containing a customer's itinerary.
2. **`pnpm format` rewrites ~126 unrelated files** — `HEAD` is not
   prettier-clean. Both Session B and I hit this and reverted the churn. Worth
   one dedicated formatting commit.
3. **`brand/`** needs `git add brand/` if the logo source should be in the repo.
4. **Squashing 0022+0023** is TD's call — left as two because editing an
   applied migration strands it (§3.1).
5. **Deferred with reasons:** moving acceptance into the booking funnel
   (`agreement_acceptances.booking_id` is a FK, so there is no booking to bind
   to until payment — it needs its own slice), Playwright harness (none exists; all scenarios
   covered by integration tests + this manual pass), nested lists in agreements,
   tables in the editor, deleting superseded passport objects, `DragHandle`.

---

## 8. Not committed

Only `b147a89` is committed. The working tree carries all three sessions'
remaining work. I have not staged or committed anything from Sessions A or B —
that is TD's to sequence, and I would not commit another session's work on its
behalf.
