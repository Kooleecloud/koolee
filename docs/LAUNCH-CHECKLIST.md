# Launch checklist

> **This document replaces tier numbering as the tracking instrument.** Tiers
> described what to build next, and there is nothing left to build before
> opening — what remains is configuration, verification, real data, and three
> things blocked on other people. A tier number cannot say that. This can.
>
> **Baseline:** `feat/tier5-launch-readiness`. Seeded from
> [REPORT-tier5-preflight.md](run-reports/REPORT-tier5-preflight.md) §5, which
> catalogued 49 items with a citation for each; items Tier 5 closed are marked
> **done** with what proves it.
>
> **Owner** is `TD` (a human, by hand), `code` (in the repository), or `CI`
> (automatic on merge). **Nothing here is owned by two people.**
>
> The procedures live in [runbooks/](runbooks/):
> [prod-bringup](runbooks/prod-bringup.md) ·
> [stripe-live-flip](runbooks/stripe-live-flip.md) ·
> [cutover-rehearsal](runbooks/cutover-rehearsal.md).

---

## 0. TD's own list, in order

Everything below is in the tables that follow, with reasons. This is the
sequence.

### At merge

- [ ] **Close B1** — the oldest open item. `DIRECT_DATABASE_URL='<staging direct>' pnpm db:status`
      → expect **33 of 33 (matched by content hash)**. Tier 5 added **no
      migration**, so the count is unchanged from the pre-flight. Hosted
      carries one orphan journal row on purpose; leave it.
- [ ] Review the diff, merge to `dev`. CI migrates staging and fails red on
      hash drift.
- [ ] After the deploy: `pnpm env:verify` against the dev scope, and the
      three Sentry test errors (§4).

### Google Cloud

- [ ] Create the key. **Restrict it**: API restriction = **Routes API + Places
      API (New)** only; application restriction = **server** (IP or none) —
      never an HTTP referrer, which would mean shipping it to a browser.
- [ ] Set billing alerts. Places is billed per session and Routes per element;
      both are cheap and neither is free.
- [ ] Vercel → `apps/web` → `GOOGLE_MAPS_SERVER_KEY`, **both scopes**, marked
      sensitive. Two rows, not one: it is metered, and dev traffic should not
      spend production's quota.
- [ ] Confirm on the deployed funnel: type three characters into the address
      field and watch suggestions appear. Absent ⇒ ETAs are haversine and the
      field is a plain input. Neither is a failure; both are worth knowing.
- **Not on this key, and not a task:** the trip page's MAP. Rendering is
      MapLibre over OpenFreeMap — no key, no account, no quota to watch.
      Google's Maps JS is a separate SKU that would need a second,
      referrer-restricted key in the browser bundle. See
      [ARCHITECTURE.md §6](ARCHITECTURE.md).

### Sentry (mostly done — verify)

- [ ] **Three projects**, one per app. One shared DSN merges preview errors
      into the production project.
- [ ] Per app, per scope: `NEXT_PUBLIC_SENTRY_DSN` (that app's own, plain),
      `SENTRY_PROJECT` (that app's slug), shared `SENTRY_ORG`, shared
      `SENTRY_AUTH_TOKEN` (**sensitive**). You have already done this — re-check
      the names against [`scripts/env-manifest.json`](../scripts/env-manifest.json),
      because the DSN variable was **renamed** from `SENTRY_DSN` in Tier 5.
- [ ] After the first deploy, per app:
      `curl -X POST -H "x-cron-secret: $CRON_SECRET" https://<origin>/api/observability/test-error`.
      The reply names the environment and release to expect beside the event.
- [ ] Browser half, per app: devtools console → `!!window.__SENTRY__` → `true`.
- **Before any of that**, if you just want to know it works: put the DSN in
      `apps/<app>/.env.local`, restart the dev server, and
      `curl -X POST http://localhost:3000/api/observability/test-error` — no
      secret needed outside production, and `sent` tells you plainly whether
      anything left the process. Only source maps and `release` are deploy-only.
      See [prod-bringup.md](runbooks/prod-bringup.md).

### Production bring-up → [runbooks/prod-bringup.md](runbooks/prod-bringup.md)

- [ ] Prod Supabase project: CI migrations, 4 storage buckets verified
      `public = false`, `booking_signals` in the realtime publication **with
      the `authenticated` SELECT grant**, auth config (email OTP; SMS/phone
      OFF), redirect URLs.
- [ ] Vercel prod env pass:
      `vercel env ls production | pnpm env:verify --stdin --live` and fill every
      MISSING line. **Run it with `--live` BEFORE flipping the launch mode.**
- [ ] Turnstile: add the prod hostnames — apex, prod agent host, prod admin
      host, **each listed explicitly**.
- [ ] Inngest Cloud: prod app registered with the **prod signing key**;
      **16 functions and 4 crons** visible.
- [ ] DNS/domains: the prod domains already exist — confirm each app serves on
      its own.

### Launch data (the console, never the seed)

- [ ] **Airline cutoffs** → `/cutoffs`. The page says how many of 128 rows are
      still the seed's placeholder. Drive it to zero for every airline you
      sell. **This is the highest-consequence item on this page.**
- [ ] **Pricing** → `/pricing`. Publish the launch rule.
- [ ] **Agreement v2** → `/agreements`, after legal review. Body prepared at
      [launch/agreement-v2-draft.md](launch/agreement-v2-draft.md).
- [ ] **Coverage ZIPs** → `packages/db/src/coverage-zips.ts`, a PR and a
      deploy. Re-verify each area against the drive-time assumptions the cutoff
      maths relies on.
- [ ] **Fleet** → `/trucks`, and take both `DEV Truck …` fixtures out of
      service.
- [ ] **Staff** → `/staff`. The FIRST admin comes from `pnpm bootstrap:staff`;
      everyone else is invited from there.
- [ ] **`can_drive`** → `/shifts`. Defaults **false** — until it is granted
      there is no shift, no driver shortlist, and every sealed booking reads
      "needs a driver".
- [ ] **Zones** → `/zones`.

### Rehearsal and decisions

- [ ] Run [runbooks/cutover-rehearsal.md](runbooks/cutover-rehearsal.md) end to
      end on prod infrastructure with `4242 4242 4242 4242`.
- [ ] Legal review of agreement v2 **and** the marketing Terms page.
- [ ] Stripe business verification → then
      [runbooks/stripe-live-flip.md](runbooks/stripe-live-flip.md).
- [ ] Twilio / A2P → then phone OTP on, and the SMS channel is its own slice.
- [ ] Push, when you choose: flip the flag, set the four VAPID values in all
      three apps, and run the four-row delivery smoke test.

---

## 1. Launch-blocking

Koolee cannot take a real booking until every one of these is done.

| # | Item | Owner | Status |
| --- | --- | --- | --- |
| L1 | **Verify hosted migration state from a shell** — `db:status` against dev and prod. The last shell-verified state was 21/21 on 2026-08-23 and the repo is at 33. Prose is not proof; this file's ancestors have been wrong twice | TD | **open** — the oldest item on the list |
| L2 | **Verify the 128 airline cutoffs** against real airline policy | TD | **open** — but no longer needs SQL: `/cutoffs`, and the page counts what is left |
| L3 | **Re-verify each coverage area** against the drive-time assumptions the cutoff maths relies on | TD | open |
| L4 | **Publish a legally-reviewed agreement v2** | TD | draft prepared ([launch/agreement-v2-draft.md](launch/agreement-v2-draft.md)); needs counsel, then `/agreements` |
| L5 | **Stripe live mode** — live secret + publishable in the same deploy, a new live webhook endpoint, its `whsec_`, four subscriptions | TD | blocked on business verification; runbook written |
| L6 | **`CRON_SECRET` set and the capture cron verified running** | TD | **gated in code now** — a live prod boot without it refuses. Verification is rehearsal §5.5 |
| L7 | **Both test-OTP sources absent from production** — the `config.toml` block AND any dashboard-entered test phone. `13322602829` is valid-format and passes the app's own validation | TD | open — two independent sources, check both |
| L8 | **Own Twilio account + business verification** | TD | blocked-external |
| L9 | **Flip `NEXT_PUBLIC_LAUNCH_MODE` to `live`**, cache off. Arms five `apps/web` gates at once, plus Tier 5's four money gates | TD | open — run `pnpm env:verify --live` FIRST |
| L10 | **Supabase auth dashboard, all four**: custom SMTP, `{{ .Token }}` in three templates, OTP length 6, Site URL | TD | open — [prod-bringup §D](runbooks/prod-bringup.md) |
| L11 | **Prod Turnstile hostnames** — apex + prod agent host + prod admin host, each explicit | TD | open |
| L12 | **`NEXT_PUBLIC_TURNSTILE_SITE_KEY` on the admin and agent prod scopes.** Neither app gates on it, and its absence looks exactly like a wrong password | TD | open — `env:verify` reports it as `absent` for both |
| L13 | **Inngest: sync the PROD url into the PROD environment with the prod signing key.** The app id is hardcoded `"koolee"`, so a wrong sync repoints prod at dev | TD | open |
| L14 | **Bootstrap the first prod admin** with `pnpm bootstrap:staff` — the only door in | TD | open |
| L15 | **Enter the real fleet** at `/trucks` and take the DEV trucks out of service | TD | open |
| L16 | **Grant `can_drive`** at `/shifts` | TD | open |
| L17 | **Populate `agent_zones`** for prod staff | TD | open |
| L18 | **Confirm `booking_signals` is in `supabase_realtime` AND `authenticated` holds the SELECT grant.** A missing grant is silently dead realtime | TD | open |
| L19 | **Confirm every storage bucket has `public = false`** | TD | open |
| L20 | **Deployment Protection OFF for Preview**, or Inngest cannot sync and Stripe cannot deliver | TD | open |

### Closed by Tier 5

| Item | What closed it |
| --- | --- |
| **`pnpm seed` could silently destroy L2's work** — two docs recommended running it against hosted | `seed-guard.ts` refuses a non-local host; `SEED_ALLOW_HOSTED=1` for a brand-new project only; six docs corrected |
| **No admin path to the cutoff matrix** — SQL only | `/cutoffs`, with a required provenance field and a refusal to save the seed's own placeholder text back |
| **No admin path to pricing** — seed or SQL only | `/pricing`, publishing a new rule rather than editing the live one |
| **Nothing gated a prod boot on Stripe or `CRON_SECRET`** | Four gates in `apps/web/src/env.ts`, ten tests |
| **No way to check an environment before deploying** | `pnpm env:verify` + a checked-in manifest derived from the gates |
| **Every error path terminated at `console.*`** | Sentry in all three apps, `global-error.tsx` in all three, `SentryOpsAlerter`, terminal Inngest failures captured |
| **The funnel and the public page priced the same trip differently** | One `resolveQuoteDistanceKm`; the public page reads the live rule |
| **The Terms page contradicted the pinning model** | Section 7 is now the precedence rule |
| **No ordered production procedure existed** | Three runbooks |

---

## 2. Launch data — real values replacing placeholders

| # | Item | Owner | Status |
| --- | --- | --- | --- |
| D1 | **Airline cutoffs**, 128 rows | TD | `/cutoffs`. The page's own count is the progress bar |
| D2 | **Pricing rule** — base, per bag, per km, the lead curve, the family discount | TD | `/pricing`. The public page reads whatever is active |
| D3 | **`RESEND_FROM`** — defaults to Resend's sandbox sender; must be the verified domain | TD | open |
| D4 | **`OPS_ALERT_EMAIL`** — a real monitored inbox | TD | open; gated at boot when live |
| D5 | **`NEXT_PUBLIC_AGENT_APP_URL` / `NEXT_PUBLIC_ADMIN_APP_URL`** on `apps/web` — deep links on staff pushes | TD | open |
| D6 | **`ASSIGNMENT_HORIZON_HOURS` must MATCH** between web and admin, or the console's badges disagree with the sweep | TD | open; both listed in the manifest |
| D7 | **The agreement v2 body**, from legal | TD | draft prepared |
| D8 | **The marketing `/terms` sections** — still "Draft … not yet in force" | TD | open; section 7 rewritten, the rest awaits counsel |
| D9 | **Coverage ZIPs** — code, so a PR and a deploy | TD + code | open |

---

## 3. Post-launch — deliberate deferrals

Each was deferred with a recorded reason. None blocks opening.

| # | Item |
| --- | --- |
| P1 | **SMS** — parked on A2P. `NotificationDispatcher` is the seam; there is no code |
| P2 | **AeroAPI flight lookup** — stubbed |
| P3 | **`reserved_spaces` enforcement** — one subtraction in `listCandidateDrivers` plus a test. Editable, labelled "not yet enforced", read by nothing |
| ~~P4~~ | ~~**A map on the customer trip page**~~ — **shipped.** MapLibre over OpenFreeMap: no key, no account, no per-load billing. The reasoning that deferred it was half right — a distance answers "how long", and a moving pin answers "is anything happening". See RUN-REPORT-10 |
| P5 | **`cutoffRiskMonitor` measuring from the DRIVER's position** rather than the pickup address |
| P6 | **A driver-no-show check** — `agentNoShowCheck`'s twin, with the airline cutoff as its deadline |
| P7 | **Reassignment machinery** — the no-show check pages a human rather than trying the next agent |
| P8 | **Offline outbox for custody capture** |
| P9 | **Retention sweep** for orphaned avatar, bag and passport objects |
| P10 | **Notification history / per-moment preferences / escalation ladders** |
| P11 | **Rejected-bag / lost-bag exception flows** — manual overrides via `/exceptions` for now |
| P12 | **Seal technology decision** (RFID vs printed QR). `bags.seal_id` is opaque, so neither needs a migration |
| P13 | **React Native app** |
| P14 | **A Playwright harness** — the browser passes in Tier 5 and the UX pass were driven by hand through MCP; standing up a suite is its own slice |
| P20 | **A DOM test harness for `@koolee/ui`** — it runs `environment: "node"`, so no test can render a component. The UX pass shipped a date field whose blur handler overwrote correct input from a stale closure, with all seven of its unit tests passing throughout, because the pure function it wraps was never wrong. That class of bug needs a rendered component; a real browser found it, and nothing in CI would have |
| P15 | **`custody_events` SELECT grant** — its subscription has never worked and nothing subscribes |
| P16 | **`X-Robots-Tag: noindex`** on the preview host while it serves the live funnel publicly |
| P17 | **Route optimisation, position history, background GPS, customer-facing driver profiles** |
| P18 | **`ASSIGNMENT_HORIZON_HOURS` in `apps/agent`** — the app neither assigns nor renders at-risk state |
| P19 | **`admin_audit_log`** — who changed a price or a cutoff, and when. Both new surfaces are admin-session-gated and neither records the operator. Out of scope for Tier 5, and the first thing to add if more than one person is entering launch data |

---

## 4. Blocked on other people

| # | Item | Blocked on | What unblocks it |
| --- | --- | --- | --- |
| B1 | **Phone verification at scale** | Twilio business approval | An approved account + credentials in the Supabase dashboard. Email is a complete signup channel until then |
| B2 | **SMS notifications** | A2P 10DLC registration | Registration clears, then the SMS adapter is a slice |
| B3 | **The tab-closed push delivery matrix** | A manual pass in a real Chrome — Chrome-for-Testing subscribes to FCM *preprod* | A human with a real browser and a real device |
| B4 | **`notificationclick` focus-or-open** | The same manual pass — no protocol command clicks a notification | Same |
| B5 | **Whether `ANTHROPIC_API_KEY` reaches the running staging server** | One line in the Vercel runtime log: `[ticket-upload] extraction {…"extractor":"claude"…}` | Upload a ticket on staging and read the log. Rehearsal §2.1 |
| B6 | **Turnstile widget mode** (Managed vs Invisible) | A Cloudflare dashboard setting; the docs and the deployment disagree | Look at the widget, then fix whichever is wrong |
| B7 | **Legal review** of the agreement body and `/terms` | Counsel | — |
| B8 | **Stripe live mode** | Business verification | [stripe-live-flip.md](runbooks/stripe-live-flip.md) |

---

## 5. How to use this

**Before merging anything else into `dev`:** nothing here changes.

**Before the first production deploy:** work §0 top to bottom. It is ordered by
dependency, not by importance — Vercel cannot build without env, Inngest cannot
sync without a deployed URL, and the console cannot enter launch data without
an admin account.

**Before taking a real booking:** every row in §1 done, every row in §2 that is
not marked post-launch done, and the rehearsal run end to end.

**When something fails the rehearsal:** record it here against the matching
line rather than fixing it silently. This document is what says whether Koolee
can open.
