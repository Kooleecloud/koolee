# Runbook — the cutover rehearsal

**What this is.** One scripted pass through the whole product, on production
infrastructure, with a test card, before a real customer ever books. It is the
only thing that exercises the parts no test can: a real Supabase project, a
real Inngest sync, real email delivery, real push, a real browser, and three
apps that have to agree with each other.

**This file DEFINES the pass. It does not run it.** Execution is TD's, after
merge, and it is a checklist item in
[docs/LAUNCH-CHECKLIST.md](../LAUNCH-CHECKLIST.md).

**Before you start:** [prod-bringup.md](prod-bringup.md) finished, §K2 flipped
to `live`, Stripe still in TEST mode (that is the point of the test card), and
`pnpm env:verify --live` clean.

**You will need:** two browsers or two profiles (one customer, one staff), a
phone if push is enabled, and the Stripe test card `4242 4242 4242 4242` with
any future expiry and any CVC.

---

## How to read this

Every step has an **expected evidence** line. If the evidence is not there, the
step failed even if the screen looked right — most of what this rehearsal
catches is something that silently did not happen.

Write the booking's `KOO-XXXXX` down at step 6. It is the search key for
everything afterwards: the console, the logs, and all three Sentry projects.

---

## 1. The public site

| #   | Do                                                                                              | Expected evidence                                                                                                                              |
| --- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1 | Open the production origin.                                                                     | The marketing site, not the coming-soon page.                                                                                                  |
| 1.2 | Price a trip on `/pricing`: 3 bags, JFK, 24h+.                                                  | A total that matches what `/pricing` in the ADMIN console says the active rule is. This is the check that the public page reads the live rule. |
| 1.3 | Submit a waitlist signup for an out-of-area ZIP (e.g. `07030` if Hudson County is not covered). | A confirmation, and a row in `waitlist_signups`.                                                                                               |

## 2. The funnel

| #   | Do                                                                                          | Expected evidence                                                                                                                                                                                                                                               |
| --- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.1 | Start a booking. Upload a real e-ticket PDF.                                                | The flight step is prefilled. **Check the Vercel runtime log for `[ticket-upload] extraction {…"extractor":"claude"…}`** — `"heuristic"` means `ANTHROPIC_API_KEY` is not reaching the running server, and the prefill is confidently wrong rather than absent. |
| 2.2 | Continue to the address step. Type the first few characters of a real street address.       | Suggestions appear. **If they do not, `GOOGLE_MAPS_SERVER_KEY` is absent** — not a failure, but note it: ETAs will be haversine.                                                                                                                                |
| 2.3 | Pick a suggestion.                                                                          | City, state and ZIP fill themselves.                                                                                                                                                                                                                            |
| 2.4 | If the filled ZIP differs from the one you were quoted for, take the "Update quote" branch. | The pickup window is cleared and you are sent back to pick one. That is correct — the window's lead-time price was derived from the old location.                                                                                                               |
| 2.5 | Pick a pickup window.                                                                       | Prices differ across windows if the lead-time curve is non-flat.                                                                                                                                                                                                |
| 2.6 | Verify by **email** (phone OTP is blocked on Twilio).                                       | The code arrives from the verified sending domain, not Resend's sandbox sender. A LINK instead of a code means the Supabase template is missing `{{ .Token }}`.                                                                                                 |
| 2.7 | Pay with `4242 4242 4242 4242`.                                                             | The Payment Element renders (not "misconfigured").                                                                                                                                                                                                              |

**Evidence after 2.7, all four:**

- the trip page shows the booking as paid;
- a confirmation email arrives — **exactly one**;
- Stripe (test mode) → Events shows `payment_intent.amount_capturable_updated`
  delivered **200**;
- Inngest → Runs shows `booking-confirmation-email` and
  `booking-pickup-reminder` both succeeded.

## 3. Dispatch

| #   | Do                                                                                                                             | Expected evidence                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| 3.1 | Admin console → Bookings. Find the booking.                                                                                    | It is there, in the right pickup window, in the booking's own timezone.                             |
| 3.2 | If the window is inside the assignment horizon, an agent is already assigned by the `*/5` sweep. Otherwise assign one by hand. | `booking.agent_assigned` in the custody trail, and the agent gets an email (and a push if enabled). |

## 4. The visit

| #   | Do                                                                                    | Expected evidence                                                                                                                                                          |
| --- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 4.1 | Agent app, signed in as the assigned agent. Open the task.                            | The address, a working map link, and the customer's name.                                                                                                                  |
| 4.2 | Accept the booking agreement as the CUSTOMER (trip page) and upload a passport photo. | Both gates clear on the agent's screen. There is **no override**; a blocked agent files an exception.                                                                      |
| 4.3 | Agent: arrive, verify identity, seal and photograph each bag.                         | One `bag.sealed` per bag with a photo, then `booking.verified_sealed`.                                                                                                     |
| 4.4 | While 4.3 is happening, watch the customer's trip page **in the other browser**.      | The timeline updates without a manual refresh. `document.querySelector('[data-live-signal]')` reads `live` (or `polling` — the fallback is not a failure, but note which). |

## 5. The driver

| #   | Do                                                                                      | Expected evidence                                                                                                                                                                                                                |
| --- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5.1 | A driver with `can_drive` opens a shift in a real truck.                                | The shift appears in the console.                                                                                                                                                                                                |
| 5.2 | Customer's trip page: the driver shortlist.                                             | Real drivers, an ETA on each, emptiest van first.                                                                                                                                                                                |
| 5.3 | Choose one.                                                                             | `pickup.driver_selected`, a driver-selected email, and the shortlist becomes the tracking card.                                                                                                                                  |
| 5.4 | Driver: set off, scan each seal at the door, deliver to the bag drop, confirm handover. | `pickup.travel_started`, one `pickup.seal_scanned` per bag, `booking.in_transit`, `booking.delivered_to_bagdrop`, `booking.completed` — in that order, and the progress strip moves with them.                                   |
| 5.5 | **Wait five minutes.**                                                                  | The `capture-due-bookings` cron captures the authorization. Stripe shows the charge as captured, not just authorized. **This is the step that catches a missing `CRON_SECRET`**, whose only symptom is money that never arrives. |

## 6. Every email

Tick each one as it lands. All of them come from the verified sending domain,
and all of them render in the BOOKING's timezone with its abbreviation:

- [ ] booking confirmation
- [ ] pickup reminder (2h before the window — set the window close if you need
      to see it)
- [ ] agent assigned
- [ ] bags sealed
- [ ] driver selected
- [ ] delivered to bag drop
- [ ] ops alert — raise a deliberate exception from the console and confirm
      `OPS_ALERT_EMAIL` receives it

## 7. Observability

| #   | Do                                                                                                                        | Expected evidence                                                                                                                         |
| --- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 7.1 | `curl -X POST -H "x-cron-secret: $CRON_SECRET" https://<origin>/api/observability/test-error` for each of the three apps. | Three events, in three DIFFERENT Sentry projects, each tagged with the right `environment` and the deployed commit as `release`.          |
| 7.2 | Devtools console on each app: `!!window.__SENTRY__`.                                                                      | `true`. The browser half is live.                                                                                                         |
| 7.3 | Search Sentry for the booking's `KOO-XXXXX`.                                                                              | If anything went wrong during this rehearsal, its errors are there, tagged. If nothing went wrong, no results — which is also the answer. |

## 8. Push (only if the flag is on)

| #   | Do                                                                                           | Expected evidence                                                                                                                                                                 |
| --- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 8.1 | Enable notifications in each app, on a real device, from a real tap. Permission is ONE-SHOT. | The subscription is stored.                                                                                                                                                       |
| 8.2 | With the tab CLOSED, trigger a moment that pushes.                                           | The notification is drawn. There is no API that reports this — **asking a human is the only verification that exists**, which is what the agent app's did-you-see-it step is for. |

## 9. Teardown

**Do not leave the rehearsal booking in production data.**

| #   | Do                                                                                            | Expected evidence                                                                                                                            |
| --- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 9.1 | Refund the booking from the admin console.                                                    | `booking.payment_refunded` in the trail; Stripe shows the refund.                                                                            |
| 9.2 | Cancel it.                                                                                    | Status `cancelled`.                                                                                                                          |
| 9.3 | Take the rehearsal truck out of service and close the rehearsal shift, if they were fixtures. | Neither appears on the board.                                                                                                                |
| 9.4 | Leave the custody trail alone.                                                                | `custody_events` is append-only by trigger. The record of the rehearsal is the record; a correction is a compensating event, never a delete. |

---

## What a failure means

Anything here that fails is a launch blocker until it is understood — not
because the rehearsal is precious, but because every one of these steps is a
thing that cannot be tested any other way. Record the failure against the
matching line in [docs/LAUNCH-CHECKLIST.md](../LAUNCH-CHECKLIST.md) rather than
fixing it silently: the checklist is what says whether Koolee can open.
