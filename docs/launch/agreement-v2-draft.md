# Booking agreement v2 — the prepared draft

**What this file is.** The body ops pastes into the admin console at
`/agreements` to publish version 2. It is NOT the agreement: nothing in this
repository is. The agreement is the row in `agreement_versions`, and a booking
is governed by the version it accepted.

**What it is for.** The seeded v1 says so in its own last line — *"Placeholder
terms for launch. Replace this version at the admin console's agreements page
with the legally reviewed text before taking real bookings."* This draft
carries v1's substance forward and fixes the one thing the Tier 5 pre-flight
found wrong with it (§3.4): the product PINS a version per booking, and nothing
in the customer-facing text said so, while the marketing Terms page said the
opposite.

**Still required before it is published: legal review.** That is a checklist
item, not a code change ([docs/LAUNCH-CHECKLIST.md](../LAUNCH-CHECKLIST.md)).
This draft is a starting point for counsel, not a substitute for one.

---

## How to publish it

1. Admin console → **Agreements**.
2. Paste the body below into the editor. It uses only what the agreement AST
   allows — headings, paragraphs, bold, italic, one level of bullets, a rule.
   No links: an agreement whose terms live behind a link is an agreement whose
   terms are not versioned.
3. Leave **effective from** blank for "immediately", or set a future date.
   A future date is editable until it takes effect; a version in force is
   frozen at the database (migration 0024), because `agreement_acceptances`
   references it by id and editing it would rewrite what past acceptors agreed
   to.
4. Publishing asks for no confirmation, and does not need to: under version
   pinning it applies to bookings made from its effective date onward, and any
   booking that has already accepted keeps the version it accepted. **No
   customer is re-asked.**

A publish may not be backdated (refused past a small clock skew). Backdating
would rewrite which terms a booking sold an hour ago was sold under.

---

## The body

```markdown
## What you are booking

Koolee collects your bags from your door and delivers them to your airline's
bag drop. We do not check you in, issue boarding passes, or act on your behalf
with the airline. You remain responsible for your own check-in and for arriving
at the airport for your flight.

## Identity

The traveler named on the booking must be present at pickup, and our agent
verifies the traveler's passport before taking custody of any bag. If we cannot
verify identity, the agent cannot collect the bags and we will contact you to
sort it out.

## Your bags

Pack your bags as you would for the airport, and follow your airline's rules on
what may travel in checked luggage. Do not give us anything you are not
permitted to check, anything prohibited by law, or anything you would not
entrust to an airline's baggage system.

We photograph and seal each bag in front of you with a serialized tamper-evident
seal, and we record every hand-off. That record is yours to see on your trip
page.

## Money

Your card is authorized when you book and charged once your bags have been
collected and sealed. Cancellation terms are shown when you cancel.

## Which version of this agreement applies to your booking

**The version you accept when you book governs that booking, for its whole
life.** If we publish a newer version afterwards, it does not change the
booking you have already made and we will not ask you to accept it again.
Newer versions apply to new bookings.

You accept once per booking, before your agent's visit. The version you
accepted, and when, is recorded against your booking.

## If something goes wrong

Tell us as soon as you can. Our custody record — the seals, the photos, and the
timestamps — is what we investigate against, and it is what we will share with
you.
```

---

## What changed from v1, and why

| Change | Why |
| --- | --- |
| **New section: "Which version of this agreement applies to your booking"** | The product pins a version per booking and nothing in the customer-facing text said so. The rule is in the code (`UNIQUE (booking_id)` on `agreement_acceptances`, migration 0025) and in `PROJECT-STATUS §7`; a customer had no way to know it. |
| The closing placeholder paragraph is **gone** | It was v1 telling ops to replace it. Keeping it in v2 would be a live agreement describing itself as a placeholder. |

**What deliberately did NOT change:** every other section is v1's text
verbatim. This draft exists to close one specific gap the pre-flight found,
and rewriting the substance at the same time would make it impossible for
counsel to see what is new.

## The re-acceptance question, settled

The pre-flight looked for a "§9.3 re-accept clause" and **it does not exist** —
not in the agreement body, not in `PROJECT-STATUS`. What DOES contradict the
pinning model is the public marketing Terms page, which said *"continued use
after changes take effect constitutes acceptance."* That is a re-acceptance
rule, and the booking agreement's rule is the opposite. Tier 5 adds the
precedence line to that page rather than changing this one, because the
product's behaviour is the pinning model and has been since migration 0025:

> Never reintroduce a "has this booking accepted the CURRENT version" gate —
> that model blocked pickups over a wording change, and re-asking at a doorstep
> with the bags packed is consent under duress, which is not consent worth
> having.
> — `PROJECT-STATUS.md §7`
