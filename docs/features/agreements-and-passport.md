# Booking agreements + passport verification

> **The identity gate: what a customer must agree to, and what an agent must
> confirm, before Koolee takes custody of a bag.** Related:
> [agent-visit.md](agent-visit.md) · [../MIGRATIONS.md](../MIGRATIONS.md) ·
> [../../PROJECT-STATUS.md](../../PROJECT-STATUS.md)

---

## 1. What replaced what

The verification visit used to clear identity with a checkbox: the agent tapped
"ID matches the ticket" and a `visit.identity_verified` custody event was
written. That is evidence of a tap.

It is now a **two-part gate**, and neither part is something the agent can
assert on their own:

| Half                                                         | Who satisfies it | Where            |
| ------------------------------------------------------------ | ---------------- | ---------------- |
| The customer has accepted the **current** agreement version  | the customer     | their trip page  |
| The **assigned** agent has confirmed the traveler's passport | that agent       | the visit screen |

`recordIdentityVerified` is **gone from core**, not deprecated. Two ways to
satisfy identity means the weaker one is the one used at 6am on a doorstep. The
`VISIT_EVENT_TYPES.identityVerified` constant survives because it is the only
record of every visit performed before this slice, and the timelines still
render it — nothing reads it to decide anything.

**There is no override.** An agent who cannot clear the gate files an exception
(`reportVisitException`), which raises the booking, alerts ops by email, and
leaves a trail. An override button's only use would be to bypass the control
this exists to be.

---

## 2. Agreements: current is derived, never stored

```
current version = max(version)  WHERE effective_from <= now()
```

There is **no `is_active` column** and there will not be one. A flag beside a
derivable fact is a second source of truth for the same question, and the two
drift the first time anything writes one without the other — which is the
pricing-rule leakage (#41/#51) restated. Here it is not "enforced", it is
impossible: there is no column to get wrong.

Consequences that look like bugs and are not:

- **Publishing v2 un-gates every booking that only accepted v1.** Those
  customers are asked again. An agreement the customer never saw is not one
  they agreed to. The trip page says _"our agreement was updated"_ rather than
  _"you have not accepted"_, which is a different sentence to someone who
  remembers accepting (`supersededAcceptance`).
- **A retroactive `effective_from` is refused.** Backdating would flip
  in-flight bookings to "not accepted" retroactively — possibly while an agent
  is standing at a door. A 60-second tolerance exists only to absorb clock
  skew, not to permit backdating.
- **Nothing published ⇒ the gate is CLOSED.** An empty `agreement_versions`
  satisfying the gate would mean a database that lost its agreement rows
  silently stops requiring agreements.

`agreement_acceptances` is **append-only at the database** (trigger, migration 0022) for the same reason `custody_events` is: it is evidence that a named
person agreed to specific terms at a specific instant. There is no correcting
an acceptance — a change of terms is a new version and a new acceptance.

The client **never names a version**: `acceptAgreement` resolves the current
one server-side, so a page left open across a publish cannot satisfy the gate
with stale terms.

---

## 3. Passport: manual, free, and ignorant of the document

`passport_verifications` holds a **storage path and three statuses**. It never
holds a passport number, name, date of birth, nationality, or MRZ, and nothing
extracts them. That is a hard rule, not a scope cut: the table has to be
worthless to anyone who can read it. A passport number in a column is an
identity-theft primitive with an indefinite shelf life; a private-bucket path
has a signed URL, a live session and a short TTL in front of it.

A `passport_verifications.status` walk:

```
pending ──(customer pre-uploads)──▶ customer_uploaded ──(agent confirms)──▶ agent_confirmed
   └──────────────────(agent confirms at the door)───────────────────────────────▶
```

- **Pre-uploading is optional.** The agent verifies at the door either way, so
  `confirmPassport` works from `pending` as well as from `customer_uploaded`.
  The customer-facing card says so and is badged `optional` — anything that made
  it look like a second requirement would tell people who cannot photograph a
  passport on a phone that they cannot travel with us.
- **A photo is not a check.** `customer_uploaded` does not open the gate; only
  `agent_confirmed` does. The whole point of the manual model is a human
  comparing the document to the person in front of them.
- **Who took the photo is recorded.** `passport.customer_uploaded` vs
  `passport.agent_captured` are separate custody events on purpose — a trail
  that conflates them cannot answer "who took this photo" months later.
- **Replacing never overwrites.** A replacement is a new storage object; the
  superseded path is named in the custody event (`replacedStoragePath`). The
  old object is deliberately not deleted (see §7).

**Automated validity checking is a seam and nothing more.**
`PassportValidityChecker` (in `packages/core/src/passport/`) takes a storage
path and returns a _status_ — never extracted fields — so no future vendor can
quietly turn this table into a store of passport data. The only implementation,
`NotCheckedValidityChecker`, returns `not_checked`. It deliberately does not
return `passed`: a stub that passed would write a lie into the database.

---

## 4. Custody events added

| Event                        | Actor    | When                                                                                                  |
| ---------------------------- | -------- | ----------------------------------------------------------------------------------------------------- |
| `agreement.accepted`         | customer | acceptance of the current version (once per version; a re-accept of the same version appends nothing) |
| `passport.customer_uploaded` | customer | pre-upload, including each replacement                                                                |
| `passport.agent_captured`    | agent    | at-the-door capture, including each replacement                                                       |
| `passport.agent_confirmed`   | agent    | the confirmation itself; metadata carries `hadPhoto`                                                  |

---

## 5. Storage

Private bucket **`passport-photos`**, created with its policies in migration
0022 and corrected in 0023.

The bucket mirrors **`bag-photos`**, not `ticket-uploads`, because the writer
profile matches: the agent app uploads to it and holds no service-role key, so
its uploads run as the signed-in agent over the anon key and **storage RLS is
the only authorization mechanism available**. The customer's pre-upload goes
through the web app's service-role client, which bypasses those policies and is
gated in core by booking ownership instead.

Both policies call `public.is_active_staff(auth.uid())` (the SECURITY DEFINER
function from migration 0009), never an inline `EXISTS` on `staff_members` —
that subquery runs as `authenticated`, which has no privilege on the roster
table, and raises `permission denied for table staff_members`. 0022 shipped the
inline form; **0023 is the fix**, exactly as 0009 fixed 0008.

Reads are signed-URL only, at a **120-second TTL** — shorter than bag photos'
300s, because a signed URL is a bearer credential and this object is somebody's
passport. Every page that shows one is server-rendered per request anyway.

**The admin console deliberately does not render passport photos.** Ops has no
reason to look at a customer's passport; the check is the agent's, at the door,
against the person. Every surface that can display it is a surface that can
leak it. The storage path is in the custody trail if an investigation needs it.

---

## 6. Where the code lives

| Path                                                  | What                                                          |
| ----------------------------------------------------- | ------------------------------------------------------------- |
| `packages/db/src/schema/agreements.ts`, `passport.ts` | the three tables                                              |
| `packages/db/drizzle/0022_*.sql`, `0023_*.sql`        | DDL, the append-only trigger, RLS, the bucket + policies      |
| `packages/core/src/services/agreements.ts`            | derivation, accept, gate predicate, publish                   |
| `packages/core/src/services/passport.ts`              | uploads, confirmation, assignment checks                      |
| `packages/core/src/passport/`                         | the validity-check seam (interface, no-op default, factory)   |
| `packages/core/src/services/agent-visit.ts`           | `VisitIdentityGate`, `confirmVisitIdentity`, gate enforcement |
| `apps/web/src/components/trip-action-needed.tsx`      | the customer's two cards                                      |
| `apps/web/src/app/api/passport-photos/route.ts`       | the customer upload                                           |
| `apps/agent/src/app/tasks/[taskId]/visit-flow.tsx`    | the agent's identity step                                     |
| `apps/admin/src/app/agreements/`                      | version list + publish                                        |
| `packages/ui/src/components/markdown.tsx`             | the agreement body renderer                                   |

---

## 7. Deliberately not built

- **Deleting superseded photo objects.** A delete triggered by an ordinary
  customer retry is an irreversible write, and the custody trail already names
  the superseded path. A scheduled retention sweep is the right shape and needs
  a retention policy decided first.
- **A writer for `status = 'failed'`.** The agent's route for "this passport is
  wrong" is the existing visit exception (`customer_id_mismatch`), which raises
  the booking and alerts ops — a stronger action than a status flip.
- **Paid identity APIs, reusable agreements, e-signature vendors, OCR.** All
  out of scope for this slice; the checker interface is the only forward seam.
