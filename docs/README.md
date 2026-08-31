# Koolee — Master Documentation Index

> **The one page to navigate everything.** Baseline: `dev` @ `5db21a4`.
>
> Three ways in, pick whichever matches how you're thinking right now:
>
> 1. **[By request](#1--by-request-i-want-to)** — "I want to do X." Task first.
> 2. **[By section](#3--by-section-full-outline)** — the full outline of every doc, deep-linked.
> 3. **[By concept](#4--by-concept-az)** — you have a word and need where it's explained.

---

## Reading paths

**Brand new to the codebase** → [learning track](learning/) Ch.1 → [ARCHITECTURE §1–2](ARCHITECTURE.md#1-the-shape) → the [feature doc](features/) for whatever you're touching.

**Need to ship something today** → [SCRIPTS §2 local dev](SCRIPTS.md#2-local-development-from-cold) → [ARCHITECTURE §2 where a feature lands](ARCHITECTURE.md#2-the-two-boundaries-that-matter) → the relevant [feature doc](features/).

**Something is broken** → [ENVIRONMENT §8 diagnosing](ENVIRONMENT.md#8-diagnosing-env-problems) → [MIGRATIONS §10 recovery](MIGRATIONS.md#10-recovery-playbook).

**Deciding what to build next** → [PROJECT-STATUS](../PROJECT-STATUS.md) → the 🧭 decision hooks scattered through [features/](features/) → [jobs §7 what's genuinely not done](features/jobs-and-notifications.md#7-what-is-genuinely-not-done).

**Taking Koolee live** → [LAUNCH-CHECKLIST.md](LAUNCH-CHECKLIST.md) — the tracking instrument — then the [runbooks](runbooks/): [prod-bringup](runbooks/prod-bringup.md), [stripe-live-flip](runbooks/stripe-live-flip.md), [cutover-rehearsal](runbooks/cutover-rehearsal.md).

---

## 1 — By request ("I want to…")

### Set up & run

| I want to…                            | Go to                                                                            |
| ------------------------------------- | -------------------------------------------------------------------------------- |
| Get the app running on a cold machine | [SCRIPTS §2.1 one-command path](SCRIPTS.md#21--the-one-command-path-preferred)   |
| Know what's currently running         | [SCRIPTS §1 quick reference](SCRIPTS.md#1-quick-reference) (`pnpm local:status`) |
| Set up env files from scratch         | [ENVIRONMENT §7](ENVIRONMENT.md#7-setting-up-from-scratch)                       |
| Understand which port is what         | [SCRIPTS §6 ports](SCRIPTS.md#6-ports)                                           |
| Run background jobs locally           | [Jobs §4](features/jobs-and-notifications.md#4-running-jobs-locally)             |
| Test Stripe webhooks locally          | [Payments §6.2](features/payments.md#62--local-testing)                          |

### Understand the system

| I want to…                               | Go to                                                                                                               |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Learn the codebase properly, in order    | [Learning track](learning/)                                                                                         |
| Get the shape in five minutes            | [ARCHITECTURE §1 the shape](ARCHITECTURE.md#1-the-shape)                                                            |
| Know the rules I must not break          | [ARCHITECTURE §8 invariants](ARCHITECTURE.md#8-cross-cutting-invariants)                                            |
| Find where a file lives                  | [ARCHITECTURE §7 folder tour](ARCHITECTURE.md#7-folder-tour)                                                        |
| Understand the booking lifecycle         | [Learning §1.5](learning/01-product-and-nouns.md#15--the-lifecycle-ten-statuses-one-authority)                      |
| Know what every table is for             | [Learning §1.2 the nouns](learning/01-product-and-nouns.md#12--the-nouns-and-the-tables-they-live-in)               |
| See which external services we depend on | [ARCHITECTURE §6](ARCHITECTURE.md#6-external-services)                                                              |
| Know what's stubbed vs real              | [Jobs §7](features/jobs-and-notifications.md#7-what-is-genuinely-not-done) · [PROJECT-STATUS](../PROJECT-STATUS.md) |

### Build a feature

| I want to…                                      | Go to                                                                                                                                                                |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Know **where** my change belongs                | [ARCHITECTURE §2 boundaries](ARCHITECTURE.md#2-the-two-boundaries-that-matter)                                                                                       |
| Add a booking status or transition              | [Learning §1.5](learning/01-product-and-nouns.md#15--the-lifecycle-ten-statuses-one-authority) · [MIGRATIONS §2](MIGRATIONS.md#2-when-you-need-a-migration)          |
| Change the funnel steps                         | [Funnel §2](features/booking-funnel.md#2-the-funnel-four-steps)                                                                                                      |
| Change pricing                                  | [Funnel §5](features/booking-funnel.md#5-pricing)                                                                                                                    |
| Change pickup-window rules                      | [Funnel §4](features/booking-funnel.md#4-pickup-windows--computed-never-stocked)                                                                                     |
| Add an integration with an external service     | [ARCHITECTURE §3.1 the seam pattern](ARCHITECTURE.md#31--the-seam-pattern)                                                                                           |
| Add a storage bucket, or change an upload limit | [Storage & avatars §1](features/storage-and-avatars.md#1-buckets-are-declared-not-created) — edit `BUCKETS`, then write the migration; a test fails if they disagree |
| Add an authorization check                      | [MIGRATIONS §6](MIGRATIONS.md#6-the-authorization-model--read-before-adding-an-rls-policy) — **not** an RLS policy                                                   |
| Add a background job                            | [Jobs §1 where jobs live](features/jobs-and-notifications.md#1-where-jobs-live)                                                                                      |
| Send a customer notification                    | [Jobs §5 the notification seam](features/jobs-and-notifications.md#5-the-notification-seam)                                                                          |
| Work on a shared component                      | [SCRIPTS §5](SCRIPTS.md#5-per-package-scripts) (Storybook) · [../packages/ui/DESIGN.md](../packages/ui/DESIGN.md)                                                    |
| Write customer-facing copy                      | [Learning §1.1 the claim](learning/01-product-and-nouns.md#11--the-claim-and-why-it-is-a-hard-boundary) · [../brand/BRAND.md](../brand/BRAND.md)                     |
| Render a date or time correctly                 | [TIME.md](TIME.md)                                                                                                                                                   |

### Database

| I want to…                       | Go to                                                                                                                                                    |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Know if I even need a migration  | [MIGRATIONS §2](MIGRATIONS.md#2-when-you-need-a-migration)                                                                                               |
| Write and apply one              | [MIGRATIONS §4 the workflow](MIGRATIONS.md#4-the-workflow)                                                                                               |
| Write a trigger / RLS / function | [MIGRATIONS §4 custom migrations](MIGRATIONS.md#custom-migrations)                                                                                       |
| Check whether prod is in sync    | [MIGRATIONS §5 drift report](MIGRATIONS.md#5-pnpm-dbstatus--the-drift-report)                                                                            |
| Understand a schema decision     | [MIGRATIONS §7 conventions](MIGRATIONS.md#7-schema-conventions-worth-knowing-before-you-generate) · [../packages/db/README.md](../packages/db/README.md) |
| Deploy a migration safely        | [MIGRATIONS §9](MIGRATIONS.md#9-deploying-a-migration)                                                                                                   |
| Stand up production from nothing | [runbooks/prod-bringup.md](runbooks/prod-bringup.md)                                                                                                     |
| Check an environment's variables | `pnpm env:verify` — [scripts/env-manifest.json](../scripts/env-manifest.json) is the checklist                                                            |
| Fix a migration mess             | [MIGRATIONS §10 recovery playbook](MIGRATIONS.md#10-recovery-playbook)                                                                                   |

### Debug

| Symptom                                        | Go to                                                                                                                          |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| App boots but a feature is silently missing    | [ENVIRONMENT §1 the contract](ENVIRONMENT.md#1-the-contract--read-this-first) · [§8](ENVIRONMENT.md#8-diagnosing-env-problems) |
| Production refuses to boot with a list of vars | [ENVIRONMENT §4 boot gates](ENVIRONMENT.md#4-fail-closed-boot-gates) — **working as intended**                                 |
| `prepared statement "s1" does not exist`       | [MIGRATIONS §3 two-connection rule](MIGRATIONS.md#3-the-two-connection-rule)                                                   |
| Migration hit the wrong database               | [ENVIRONMENT §6](ENVIRONMENT.md#6--the-sharpest-edge-packagesdbenv-points-at-hosted)                                           |
| A migration is never applied, with no error    | [MIGRATIONS §5 STRANDED](MIGRATIONS.md#5-pnpm-dbstatus--the-drift-report)                                                      |
| Env var set but not visible in the browser     | [ENVIRONMENT §8](ENVIRONMENT.md#8-diagnosing-env-problems)                                                                     |
| Local database in an unknown state             | [SCRIPTS §3](SCRIPTS.md#3-scriptstest-envsh--the-local-stack) (`pnpm local:reset`)                                             |
| Bags showing the wrong number                  | [Learning §1.4 `bags.ordinal`](learning/01-product-and-nouns.md#14--why-bagsordinal-exists)                                    |
| Money never arrives despite completed bookings | [Payments §8](features/payments.md#8-production-checklist) — the capture cron                                                  |
| Tests wiped my dev data                        | [SCRIPTS §3.2 marker table](SCRIPTS.md#32--the-marker-table-makes-it-enforceable) · [§4](SCRIPTS.md#4-testing-tiers)           |

### Ship

| I want to…                     | Go to                                                                                                                             |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| Deploy                         | [ARCHITECTURE §9](ARCHITECTURE.md#9-deployment)                                                                                   |
| Know what's left before launch | [../apps/web/docs/pre-launch-security.md](../apps/web/docs/pre-launch-security.md) · [../PROJECT-STATUS.md](../PROJECT-STATUS.md) |
| Configure production env       | [ENVIRONMENT §3 matrix](ENVIRONMENT.md#3-the-full-matrix) · [§4 gates](ENVIRONMENT.md#4-fail-closed-boot-gates)                   |
| Set up Stripe in production    | [Payments §8](features/payments.md#8-production-checklist)                                                                        |

---

## 2 — By document

| Doc                                | Answers                                                                         | Size        |
| ---------------------------------- | ------------------------------------------------------------------------------- | ----------- |
| [learning/](learning/)                     | **Teaching track.** Nine numbered chapters, bottom-up, written to be re-entered | Ch.1 of 9   |
| [ARCHITECTURE.md](ARCHITECTURE.md)         | What is the system shape? Where does my change belong?                          | 9 sections  |
| [features/](features/)                     | How does capability X work, end to end?                                         | 15 docs     |
| [ENVIRONMENT.md](ENVIRONMENT.md)           | What is this env var? Why did the app boot but the feature is missing?          | 8 sections  |
| [MIGRATIONS.md](MIGRATIONS.md)             | Do I need a migration? How do I apply one safely?                               | 10 sections |
| [SCRIPTS.md](SCRIPTS.md)                   | What command do I run?                                                          | 8 sections  |
| [TIME.md](TIME.md)                         | Instants, timezones, DST                                                        | 4 rules     |
| [CODEBASE-MAP.md](CODEBASE-MAP.md)         | The dense 13-chapter narrative reference                                        | 13 chapters |
| [LAUNCH-CHECKLIST.md](LAUNCH-CHECKLIST.md) | **The tracking instrument for going live.** What is done, what blocks a launch  | live        |
| [runbooks/](runbooks/)                     | The procedures themselves: prod bring-up, the Stripe live flip, the rehearsal   | 3 runbooks  |

### App- and package-level docs

These sit next to the code they describe, and each goes deeper than the
feature doc that links to it.

| Doc                                                                          | Covers                                                             |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| [apps/web/docs/setup-auth.md](../apps/web/docs/setup-auth.md)                 | Which auth credential lives where, CAPTCHA, OTP-send safety        |
| [apps/web/docs/payments-lifecycle.md](../apps/web/docs/payments-lifecycle.md) | Webhook → capture at pickup → refund on cancellation               |
| [apps/web/docs/ticket-extraction.md](../apps/web/docs/ticket-extraction.md)   | Upload → review form → confirm, and the quarantined prefill rule   |
| [apps/web/docs/pre-launch-security.md](../apps/web/docs/pre-launch-security.md) | The hardening items, which are closed and which are still open   |
| [apps/agent/docs/verification-visit.md](../apps/agent/docs/verification-visit.md) | The visit flow, screen by screen                               |
| [apps/admin/docs/ops-console.md](../apps/admin/docs/ops-console.md)           | The console's IA, every page, and the rails they run on            |
| [apps/admin/docs/staff-auth.md](../apps/admin/docs/staff-auth.md)             | Invite-only staff sign-in for the agent and admin apps             |
| [packages/db/README.md](../packages/db/README.md)                             | The two connections, the schema layout, the seed scripts           |
| [packages/ui/DESIGN.md](../packages/ui/DESIGN.md)                             | The design contract — layering, tokens, when a pattern is promoted |
| [packages/core/docs/local-test-env.md](../packages/core/docs/local-test-env.md) | One command up, one command down                                 |

**Elsewhere:** [../README.md](../README.md) (entry point) · [../PROJECT-STATUS.md](../PROJECT-STATUS.md) (**what shipped / what's next**) · [run-reports/](run-reports/) (build logs, validation + migration notes — **historical, not maintained**) · [launch/](launch/) — [agreement-v2-draft.md](launch/agreement-v2-draft.md) (the body ops pastes at `/agreements`; **awaiting legal review**) and `env-sample-production.env` · [../brand/BRAND.md](../brand/BRAND.md)

---

## 3 — By section (full outline)

### [Architecture](ARCHITECTURE.md)

- [1. The shape](ARCHITECTURE.md#1-the-shape)
- [2. The two boundaries that matter](ARCHITECTURE.md#2-the-two-boundaries-that-matter)
  - [2.1 — Apps may not import `@koolee/db`](ARCHITECTURE.md#21--apps-may-not-import-kooleedb)
  - [2.2 — `packages/core` reads no environment and imports no framework](ARCHITECTURE.md#22--packagescore-reads-no-environment-and-imports-no-framework)
- [3. `packages/core` — the domain](ARCHITECTURE.md#3-packagescore--the-domain)
  - [3.1 — The seam pattern](ARCHITECTURE.md#31--the-seam-pattern)
- [4. `packages/db` — data access](ARCHITECTURE.md#4-packagesdb--data-access)
  - [4.1 — Authorization is in core, not the database](ARCHITECTURE.md#41--authorization-is-in-core-not-the-database)
  - [4.2 — `custody_events` is append-only](ARCHITECTURE.md#42--custody_events-is-append-only)
- [5. Request flow](ARCHITECTURE.md#5-request-flow)
  - [5.1 — The pinned webhook route](ARCHITECTURE.md#51--the-pinned-webhook-route)
- [6. External services](ARCHITECTURE.md#6-external-services)
- [7. Folder tour](ARCHITECTURE.md#7-folder-tour)
- [8. Cross-cutting invariants](ARCHITECTURE.md#8-cross-cutting-invariants)
- [9. Deployment](ARCHITECTURE.md#9-deployment)

### [Environment & Credentials](ENVIRONMENT.md)

- [1. The contract — read this first](ENVIRONMENT.md#1-the-contract--read-this-first)
- [2. Where env files actually live](ENVIRONMENT.md#2-where-env-files-actually-live)
- [3. The full matrix](ENVIRONMENT.md#3-the-full-matrix)
- [4. Fail-closed boot gates](ENVIRONMENT.md#4-fail-closed-boot-gates)
  - [4.1 — `OTP_LOG_HMAC_KEY`, validated at import](ENVIRONMENT.md#41--otp_log_hmac_key-validated-at-import)
  - [4.2 — `assertProductionSecurityConfig()` — apps/web](ENVIRONMENT.md#42--assertproductionsecurityconfig--appsweb)
  - [4.3 — `assertProductionBootConfig()` — agent & admin](ENVIRONMENT.md#43--assertproductionbootconfig--agent--admin)
  - [4.4 — Why builds still pass](ENVIRONMENT.md#44--why-builds-still-pass)
- [5. Secrets that must NOT be in app env](ENVIRONMENT.md#5-secrets-that-must-not-be-in-app-env)
- [6. ⚠️ The sharpest edge: `packages/db/.env` points at HOSTED](ENVIRONMENT.md#6--the-sharpest-edge-packagesdbenv-points-at-hosted)
- [7. Setting up from scratch](ENVIRONMENT.md#7-setting-up-from-scratch)
- [8. Diagnosing env problems](ENVIRONMENT.md#8-diagnosing-env-problems)

### [Migrations](MIGRATIONS.md)

- [1. The model in one paragraph](MIGRATIONS.md#1-the-model-in-one-paragraph)
- [2. When you need a migration](MIGRATIONS.md#2-when-you-need-a-migration)
- [3. The two-connection rule](MIGRATIONS.md#3-the-two-connection-rule)
- [4. The workflow](MIGRATIONS.md#4-the-workflow)
  - [Custom migrations](MIGRATIONS.md#custom-migrations)
- [5. `pnpm db:status` — the drift report](MIGRATIONS.md#5-pnpm-dbstatus--the-drift-report)
  - [Why it compares hashes, not counts](MIGRATIONS.md#why-it-compares-hashes-not-counts)
- [6. The authorization model — read before adding an RLS policy](MIGRATIONS.md#6-the-authorization-model--read-before-adding-an-rls-policy)
- [7. Schema conventions worth knowing before you generate](MIGRATIONS.md#7-schema-conventions-worth-knowing-before-you-generate)
- [8. Migration history](MIGRATIONS.md#8-migration-history)
- [9. Deploying a migration](MIGRATIONS.md#9-deploying-a-migration)
- [10. Recovery playbook](MIGRATIONS.md#10-recovery-playbook)

### [Scripts & Commands](SCRIPTS.md)

- [1. Quick reference](SCRIPTS.md#1-quick-reference)
  - [Everyday](SCRIPTS.md#everyday)
  - [Database](SCRIPTS.md#database)
  - [Test environment](SCRIPTS.md#test-environment)
  - [Other](SCRIPTS.md#other)
- [2. Local development from cold](SCRIPTS.md#2-local-development-from-cold)
  - [2.1 — The one-command path (preferred)](SCRIPTS.md#21--the-one-command-path-preferred)
  - [2.2 — The equivalent long-hand](SCRIPTS.md#22--the-equivalent-long-hand)
- [3. `scripts/test-env.sh` — the local stack](SCRIPTS.md#3-scriptstest-envsh--the-local-stack)
  - [3.1 — Two databases, one container](SCRIPTS.md#31--two-databases-one-container)
  - [3.2 — The marker table makes it enforceable](SCRIPTS.md#32--the-marker-table-makes-it-enforceable)
  - [3.3 — The local-host assertion](SCRIPTS.md#33--the-local-host-assertion)
- [4. Testing tiers](SCRIPTS.md#4-testing-tiers)
- [5. Per-package scripts](SCRIPTS.md#5-per-package-scripts)
- [6. Ports](SCRIPTS.md#6-ports)
- [7. Choosing a command](SCRIPTS.md#7-choosing-a-command)

### [Time & Timezones](TIME.md)

- [1. Store absolute instants. Always.](TIME.md#1-store-absolute-instants-always)
- [2. Display in the **booking's** zone — never the viewer's, never the server's.](TIME.md#2-display-in-the-bookings-zone--never-the-viewers-never-the-servers)
  - [How to render](TIME.md#how-to-render)
  - [Times that belong to no booking](TIME.md#times-that-belong-to-no-booking)
- [3. Bucket days at the airport, sort by instant.](TIME.md#3-bucket-days-at-the-airport-sort-by-instant)
- [4. DST: two nights a year, and we sell windows on both.](TIME.md#4-dst-two-nights-a-year-and-we-sell-windows-on-both)
- [The two zone columns on `bookings`](TIME.md#the-two-zone-columns-on-bookings)
- [The one deliberate exception: the ops console](TIME.md#the-one-deliberate-exception-the-ops-console)
- [Enforcement](TIME.md#enforcement)

### [Feature — Booking funnel](features/booking-funnel.md)

- [1. The marketing site](features/booking-funnel.md#1-the-marketing-site)
- [2. The funnel: four steps](features/booking-funnel.md#2-the-funnel-four-steps)
  - [2.1 — Retired routes still resolve](features/booking-funnel.md#21--retired-routes-still-resolve)
  - [2.2 — The unlock model](features/booking-funnel.md#22--the-unlock-model)
- [3. Coverage](features/booking-funnel.md#3-coverage)
- [4. Pickup windows — computed, never stocked](features/booking-funnel.md#4-pickup-windows--computed-never-stocked)
  - [4.1 — Cutoffs](features/booking-funnel.md#41--cutoffs)
  - [4.2 — Timezone policy](features/booking-funnel.md#42--timezone-policy)
- [5. Pricing](features/booking-funnel.md#5-pricing)
  - [5.1 — The lead-time multiplier is the dynamic-pricing seam](features/booking-funnel.md#51--the-lead-time-multiplier-is-the-dynamic-pricing-seam)
  - [5.2 — Discounts are stubs](features/booking-funnel.md#52--discounts-are-stubs)
- [6. Drafts](features/booking-funnel.md#6-drafts)
- [7. Creating the booking](features/booking-funnel.md#7-creating-the-booking)
  - [7.1 — `bookedFromTz`](features/booking-funnel.md#71--bookedfromtz)
- [8. After payment](features/booking-funnel.md#8-after-payment)
- [9. Ticket upload (partial)](features/booking-funnel.md#9-ticket-upload-partial)

### [Feature — Auth](features/auth.md)

- [1. Who owns what](features/auth.md#1-who-owns-what)
- [2. Customer auth](features/auth.md#2-customer-auth)
  - [2.1 — The funnel is anonymous-first](features/auth.md#21--the-funnel-is-anonymous-first)
  - [2.2 — The upgrade](features/auth.md#22--the-upgrade)
  - [2.3 — The upgrade send guard ⚠️](features/auth.md#23--the-upgrade-send-guard-)
  - [2.4 — PII: destinations are hashed, never stored](features/auth.md#24--pii-destinations-are-hashed-never-stored)
  - [2.5 — `AUTH_SCHEMA_AVAILABLE`](features/auth.md#25--auth_schema_available)
  - [2.6 — Signing in: two channels, one code screen](features/auth.md#26--signing-in-two-channels-one-code-screen)
  - [2.7 — Customer routes](features/auth.md#27--customer-routes)
- [3. Staff auth](features/auth.md#3-staff-auth)
  - [3.1 — The agent app holds no service-role key](features/auth.md#31--the-agent-app-holds-no-service-role-key)
  - [3.2 — Authorization is assignment](features/auth.md#32--authorization-is-assignment)
- [4. Fail-closed production gate](features/auth.md#4-fail-closed-production-gate)
- [5. Testing](features/auth.md#5-testing)

### [Feature — Payments](features/payments.md)

- [1. The one-paragraph model](features/payments.md#1-the-one-paragraph-model)
- [2. The seam](features/payments.md#2-the-seam)
- [3. Creating the intent](features/payments.md#3-creating-the-intent)
  - [3.1 — Idempotency: one intent per draft](features/payments.md#31--idempotency-one-intent-per-draft)
  - [3.2 — The amount-changed contract](features/payments.md#32--the-amount-changed-contract)
- [4. Capture — deferred, and off-device](features/payments.md#4-capture--deferred-and-off-device)
  - [4.1 — Why a sweep, not "capture when the agent taps done"](features/payments.md#41--why-a-sweep-not-capture-when-the-agent-taps-done)
  - [4.2 — Capture failure is an exception, not a log line](features/payments.md#42--capture-failure-is-an-exception-not-a-log-line)
- [5. Refunds and cancellation](features/payments.md#5-refunds-and-cancellation)
- [6. Webhooks](features/payments.md#6-webhooks)
  - [6.1 — Replay guard](features/payments.md#61--replay-guard)
  - [6.2 — Local testing](features/payments.md#62--local-testing)
- [7. Payment statuses](features/payments.md#7-payment-statuses)
- [8. Production checklist](features/payments.md#8-production-checklist)

### [Feature — Storage & avatars](features/storage-and-avatars.md)

- [1. Buckets are declared, not created](features/storage-and-avatars.md#1-buckets-are-declared-not-created)
- [2. Who may read and write](features/storage-and-avatars.md#2-who-may-read-and-write)
- [3. Profile pictures, end to end](features/storage-and-avatars.md#3-profile-pictures-end-to-end)
- [4. Applying this to a hosted environment](features/storage-and-avatars.md#4-applying-this-to-a-hosted-environment)

### [Feature — Agent visit](features/agent-visit.md)

- [1. Routes](features/agent-visit.md#1-routes)
- [2. The hard rails](features/agent-visit.md#2-the-hard-rails)
- [3. The visit flow](features/agent-visit.md#3-the-visit-flow)
  - [3.1 — Bags](features/agent-visit.md#31--bags)
- [4. Photo evidence](features/agent-visit.md#4-photo-evidence)
- [5. Custody events are the product](features/agent-visit.md#5-custody-events-are-the-product)
- [6. Assignment](features/agent-visit.md#6-assignment)
- [7. Why two task tables](features/agent-visit.md#7-why-two-task-tables)
- [8. Env](features/agent-visit.md#8-env)

### [Feature — Ops console](features/ops-console.md)

- [1. The pages](features/ops-console.md#1-the-pages)
- [2. Manual actions never edit history](features/ops-console.md#2-manual-actions-never-edit-history)
- [3. Blackouts matter more than they look](features/ops-console.md#3-blackouts-matter-more-than-they-look)
- [4. The board reads the booking, not a join](features/ops-console.md#4-the-board-reads-the-booking-not-a-join)
- [5. Assignment](features/ops-console.md#5-assignment)
- [6. Staff management](features/ops-console.md#6-staff-management)
- [7. Env](features/ops-console.md#7-env)
- [8. What ops cannot do](features/ops-console.md#8-what-ops-cannot-do)

### [Feature — Jobs & notifications](features/jobs-and-notifications.md)

- [1. Where jobs live](features/jobs-and-notifications.md#1-where-jobs-live)
- [2. The jobs](features/jobs-and-notifications.md#2-the-jobs)
  - [2.1 — Pickup reminder](features/jobs-and-notifications.md#21--pickup-reminder)
  - [2.2 — Cutoff-risk monitor](features/jobs-and-notifications.md#22--cutoff-risk-monitor)
  - [2.3 — Agent no-show check](features/jobs-and-notifications.md#23--agent-no-show-check)
  - [2.4 — Payment capture sweep](features/jobs-and-notifications.md#24--payment-capture-sweep)
  - [2.5 — Abandoned-draft + anonymous-user GC](features/jobs-and-notifications.md#25--abandoned-draft--anonymous-user-gc)
- [3. Manual trigger routes](features/jobs-and-notifications.md#3-manual-trigger-routes)
- [4. Running jobs locally](features/jobs-and-notifications.md#4-running-jobs-locally)
- [5. The notification seam](features/jobs-and-notifications.md#5-the-notification-seam)
  - [5.1 — This is NOT auth OTP delivery](features/jobs-and-notifications.md#51--this-is-not-auth-otp-delivery)
  - [5.2 — Why the stub exists now](features/jobs-and-notifications.md#52--why-the-stub-exists-now)
- [6. Email](features/jobs-and-notifications.md#6-email)
- [7. What is genuinely not done](features/jobs-and-notifications.md#7-what-is-genuinely-not-done)

### Also in [features/](features/) — not outlined here

| Doc                                                                                    | Covers                                                                                            |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| [realtime-signals.md](features/realtime-signals.md)                                     | The doorbell table, its one RLS policy, `useBookingSignal`, and why a payload is never rendered   |
| [agreements-and-passport.md](features/agreements-and-passport.md)                       | Versioned booking agreements, manual passport verification, the visit identity gate               |
| [notifications.md](features/notifications.md)                                           | The living notification matrix — in-app, email, push, and the parked SMS column                   |

**Hosted-setup docs** are point-in-time ops runbooks: what a slice needed done
by hand on the hosted project, in order, once. Kept as the record of what was
applied — read them when reconstructing an environment, not as current design.

- [f1-hosted-setup.md](features/f1-hosted-setup.md) — `ANTHROPIC_API_KEY` as a production requirement, Turnstile hostnames, turbo-cache cleanup. **No migrations**
- [f2-hosted-setup.md](features/f2-hosted-setup.md) — two migrations, one dashboard check, no new env vars
- [f3-hosted-setup.md](features/f3-hosted-setup.md) — migration `0032`, the VAPID keys, the enable-and-verify walkthrough
- [agreements-and-passport-hosted-setup.md](features/agreements-and-passport-hosted-setup.md) — the agreements/passport tables and storage policies
- [driver-and-pickup-hosted-setup.md](features/driver-and-pickup-hosted-setup.md) — trucks, shifts, `can_drive`, driver selection, the pickup run

### [Learning Ch.1 — Product & nouns](learning/01-product-and-nouns.md)

- [1.1 — The claim, and why it is a hard boundary](learning/01-product-and-nouns.md#11--the-claim-and-why-it-is-a-hard-boundary)
- [1.2 — The nouns and the tables they live in](learning/01-product-and-nouns.md#12--the-nouns-and-the-tables-they-live-in)
- [1.3 — Windows are not inventory](learning/01-product-and-nouns.md#13--windows-are-not-inventory)
- [1.4 — Why `bags.ordinal` exists](learning/01-product-and-nouns.md#14--why-bagsordinal-exists)
- [1.5 — The lifecycle: ten statuses, one authority](learning/01-product-and-nouns.md#15--the-lifecycle-ten-statuses-one-authority)
- [1.6 — Three rules of the state machine](learning/01-product-and-nouns.md#16--three-rules-of-the-state-machine)
- [1.7 — Three apps = three phases of the lifecycle](learning/01-product-and-nouns.md#17--three-apps--three-phases-of-the-lifecycle)
- [1.8 — `paid` means authorized, not collected](learning/01-product-and-nouns.md#18--paid-means-authorized-not-collected)
- [Where to go next](learning/01-product-and-nouns.md#where-to-go-next)

---

## 4 — By concept (A–Z)

| Concept                               | Explained in                                                                                                                                                                    |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Anonymous drafts / upgrade            | [Auth §2.1–2.3](features/auth.md#2-customer-auth)                                                                                                                               |
| Append-only custody                   | [ARCHITECTURE §4.2](ARCHITECTURE.md#42--custody_events-is-append-only) · [Agent §5](features/agent-visit.md#5-custody-events-are-the-product)                                   |
| `AUTH_SCHEMA_AVAILABLE`               | [Auth §2.5](features/auth.md#25--auth_schema_available) · [ENVIRONMENT §3](ENVIRONMENT.md#3-the-full-matrix)                                                                    |
| Auto-assignment                       | [Ops §5](features/ops-console.md#5-assignment) · [Agent §6](features/agent-visit.md#6-assignment)                                                                               |
| `bags.ordinal`                        | [Learning §1.4](learning/01-product-and-nouns.md#14--why-bagsordinal-exists)                                                                                                    |
| Blackouts (`slot_blocks`)             | [Ops §3](features/ops-console.md#3-blackouts-matter-more-than-they-look)                                                                                                        |
| Boot gates (fail-closed)              | [ENVIRONMENT §4](ENVIRONMENT.md#4-fail-closed-boot-gates)                                                                                                                       |
| CAPTCHA / Turnstile                   | [Auth §1](features/auth.md#1-who-owns-what) · [ENVIRONMENT §5](ENVIRONMENT.md#5-secrets-that-must-not-be-in-app-env)                                                            |
| Capture (deferred)                    | [Payments §4](features/payments.md#4-capture--deferred-and-off-device)                                                                                                          |
| Copy rules                            | [Learning §1.1](learning/01-product-and-nouns.md#11--the-claim-and-why-it-is-a-hard-boundary)                                                                                   |
| Coverage (NYC ZIPs)                   | [Funnel §3](features/booking-funnel.md#3-coverage)                                                                                                                              |
| Custody timeline (dots, states)       | [CODEBASE-MAP Ch.11](CODEBASE-MAP.md#chapter-11--ui-package--brand) · [DESIGN.md](../packages/ui/DESIGN.md)                                                                     |
| Cutoffs (airline)                     | [Funnel §4.1](features/booking-funnel.md#41--cutoffs)                                                                                                                           |
| Drift report (`db:status`)            | [MIGRATIONS §5](MIGRATIONS.md#5-pnpm-dbstatus--the-drift-report)                                                                                                                |
| DST                                   | [Funnel §4.2](features/booking-funnel.md#42--timezone-policy) · [TIME.md](TIME.md)                                                                                              |
| Exceptions (resolutions)              | [Ops §2](features/ops-console.md#2-manual-actions-never-edit-history)                                                                                                           |
| Idempotency (payment intent)          | [Payments §3.1](features/payments.md#31--idempotency-one-intent-per-draft)                                                                                                      |
| Inngest                               | [Jobs §1–4](features/jobs-and-notifications.md#1-where-jobs-live)                                                                                                               |
| Lead-time multiplier                  | [Funnel §5.1](features/booking-funnel.md#51--the-lead-time-multiplier-is-the-dynamic-pricing-seam)                                                                              |
| Marker table (test DB)                | [SCRIPTS §3.2](SCRIPTS.md#32--the-marker-table-makes-it-enforceable)                                                                                                            |
| OTP throttle                          | [Auth §2.3–2.4](features/auth.md#23--the-upgrade-send-guard-)                                                                                                                   |
| `OTP_LOG_HMAC_KEY`                    | [ENVIRONMENT §4.1](ENVIRONMENT.md#41--otp_log_hmac_key-validated-at-import)                                                                                                     |
| Pooled vs direct connection           | [MIGRATIONS §3](MIGRATIONS.md#3-the-two-connection-rule)                                                                                                                        |
| Profile pictures / avatars            | [Storage & avatars §3](features/storage-and-avatars.md#3-profile-pictures-end-to-end)                                                                                           |
| Pricing engine                        | [Funnel §5](features/booking-funnel.md#5-pricing)                                                                                                                               |
| RLS (what it is/isn't for)            | [MIGRATIONS §6](MIGRATIONS.md#6-the-authorization-model--read-before-adding-an-rls-policy) · [ARCHITECTURE §4.1](ARCHITECTURE.md#41--authorization-is-in-core-not-the-database) |
| Seal ID                               | [Learning §1.2](learning/01-product-and-nouns.md#12--the-nouns-and-the-tables-they-live-in) · [Agent §3.1](features/agent-visit.md#31--bags)                                    |
| Seam pattern (fake/real/factory)      | [ARCHITECTURE §3.1](ARCHITECTURE.md#31--the-seam-pattern)                                                                                                                       |
| Service-role key (why agent has none) | [Auth §3.1](features/auth.md#31--the-agent-app-holds-no-service-role-key) · [Agent §4](features/agent-visit.md#4-photo-evidence)                                                |
| State machine                         | [Learning §1.5–1.6](learning/01-product-and-nouns.md#15--the-lifecycle-ten-statuses-one-authority)                                                                              |
| Signed URLs (evidence photos)         | [Agent §4.2](features/agent-visit.md#42--viewing-evidence) · [Ops console — evidence photos](../apps/admin/docs/ops-console.md#evidence-photos)                                 |
| Storage buckets (all four)            | [Storage & avatars §1](features/storage-and-avatars.md#1-buckets-are-declared-not-created) · [Agent §4](features/agent-visit.md#4-photo-evidence)                               |
| Storage RLS (who reads/writes what)   | [Storage & avatars §2](features/storage-and-avatars.md#2-who-may-read-and-write)                                                                                                |
| STRANDED migrations                   | [MIGRATIONS §5](MIGRATIONS.md#5-pnpm-dbstatus--the-drift-report)                                                                                                                |
| Task list (what a row shows)          | [Agent §6](features/agent-visit.md#6-assignment) · [CODEBASE-MAP Ch.9](CODEBASE-MAP.md#chapter-9--agent-pwa)                                                                    |
| Task tables (why two)                 | [Agent §7](features/agent-visit.md#7-why-two-task-tables)                                                                                                                       |
| Testing tiers                         | [SCRIPTS §4](SCRIPTS.md#4-testing-tiers)                                                                                                                                        |
| Virtual windows                       | [Funnel §4](features/booking-funnel.md#4-pickup-windows--computed-never-stocked) · [Learning §1.3](learning/01-product-and-nouns.md#13--windows-are-not-inventory)              |
| Webhooks (Stripe)                     | [Payments §6](features/payments.md#6-webhooks) · [ARCHITECTURE §5.1](ARCHITECTURE.md#51--the-pinned-webhook-route)                                                              |

---

## Conventions

- 🧭 **decision hook** — knowing this changes what you'd choose to build next
- ⚠️ **sharp edge** — has bitten, or will
- Every doc states the commit it was verified at. If that commit is behind `origin/dev`, re-verify before trusting a detail.

## Where docs go

- Repo-wide → `docs/` · App-specific → `apps/<app>/docs/` · Package-specific → `packages/<pkg>/docs/`
- **Nothing new accumulates at the repo root.**

## The five things to know before changing anything

1. **The state machine is the only authority on booking transitions.** Postgres guarantees only the set of values.
2. **`custody_events` is append-only.** Corrections append a compensating event.
3. **Apps may not import `@koolee/db`.** Everything goes through a `@koolee/core` service.
4. **Authorization is in core, not RLS.** Server paths bypass RLS entirely.
5. **`packages/db/.env` points at the hosted project.** Read the `Target host:` line before confirming any migration.
