# Koolee documentation

> Baseline: `dev` @ `5973047`. Every doc states the commit it was verified at.

## Start here

**New to the codebase?** Read the [learning track](learning/) — nine numbered
chapters, bottom-up, written to be re-entered. Every section has a stable number
so you can ask about `3.4` months later.

**Need to do something specific?** Use the table below.

## Reference

| Doc                                | Answers                                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------------------------ |
| [ARCHITECTURE.md](ARCHITECTURE.md) | What is the system shape? Where does my change belong? What are the boundaries?            |
| [ENVIRONMENT.md](ENVIRONMENT.md)   | What is this env var? Which app needs it? Why did the app boot but the feature is missing? |
| [MIGRATIONS.md](MIGRATIONS.md)     | Do I need a migration? How do I apply one safely? Why is prod out of sync?                 |
| [SCRIPTS.md](SCRIPTS.md)           | What command do I run? What does this script actually do?                                  |
| [TIME.md](TIME.md)                 | How does this codebase reason about instants, timezones, and DST?                          |
| [CODEBASE-MAP.md](CODEBASE-MAP.md) | The dense 13-chapter narrative reference                                                   |

## Features — end-to-end

| Doc                                                                      | Covers                                                                   |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| [features/booking-funnel.md](features/booking-funnel.md)                 | Marketing, the 4-step funnel, drafts, coverage, virtual windows, pricing |
| [features/auth.md](features/auth.md)                                     | Customer OTP, the upgrade guard, staff invite-only sign-in               |
| [features/payments.md](features/payments.md)                             | Intents, authorization, deferred capture, refunds, webhooks              |
| [features/agent-visit.md](features/agent-visit.md)                       | Field PWA: arrival, identity check, bag sealing, custody events          |
| [features/ops-console.md](features/ops-console.md)                       | Dispatch, exceptions, blackouts, staff, zones                            |
| [features/jobs-and-notifications.md](features/jobs-and-notifications.md) | Inngest jobs, cron routes, the notification seam                         |

## Elsewhere in the repo

| Doc                                                                                | Scope                                                                  |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| [../README.md](../README.md)                                                       | Entry point: quickstart and the rules                                  |
| [../PROJECT-STATUS.md](../PROJECT-STATUS.md)                                       | **What shipped, what's in flight, what's next**                        |
| [../MIGRATION-NOTES.md](../MIGRATION-NOTES.md)                                     | Historical record of the 10-phase dependency migration                 |
| [../brand/BRAND.md](../brand/BRAND.md)                                             | Tag-K brand system                                                     |
| [../packages/db/README.md](../packages/db/README.md)                               | Connection model, RLS stance, schema notes                             |
| [../packages/ui/DESIGN.md](../packages/ui/DESIGN.md)                               | UI kit conventions                                                     |
| [../packages/core/docs/local-test-env.md](../packages/core/docs/local-test-env.md) | The local Supabase test stack                                          |
| [../apps/web/docs/](../apps/web/docs/)                                             | setup-auth, pre-launch-security, payments-lifecycle, ticket-extraction |
| [../apps/admin/docs/](../apps/admin/docs/)                                         | ops-console, staff-auth                                                |
| [../apps/agent/docs/](../apps/agent/docs/)                                         | verification-visit                                                     |

## Where docs go

- App-specific → `apps/<app>/docs/`
- Package-specific → `packages/<pkg>/docs/`
- Repo-wide → `docs/`
- **Nothing new accumulates at the repo root.**

## The five things to know before changing anything

1. **The state machine is the only authority on booking transitions.** Postgres
   guarantees only the set of values.
2. **`custody_events` is append-only.** Corrections append a compensating event.
3. **Apps may not import `@koolee/db`.** Everything goes through a
   `@koolee/core` service.
4. **Authorization is in core, not RLS.** Server paths bypass RLS entirely.
5. **`packages/db/.env` points at the hosted project.** Read the `Target host:`
   line before confirming any migration.
