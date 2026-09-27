# Run report 16 — Native driver app (Expo), phases 1–8

**Integration branch:** `feat/agent-native-app`, cut from `origin/dev` @ `5cc5dd9`
(`--no-track`, then pushed as its own remote branch so phase PRs can target it).
**Phase branches** are cut from the integration branch with `--no-track`, PR'd
INTO it, merged with a merge commit (never squash). Nothing reaches `dev` until
the whole thing is tested on the integration branch; that promotion PR is TD's.

**Mandate (TD, 2026-09-27):** run all eight phases end to end without checking
back. Only the Apple Developer and Google Play developer accounts are known to
be unavailable; everything that does not need them gets finished, and what does
goes on [`docs/features/native-driver-app/CHECKLIST.md`](../features/native-driver-app/CHECKLIST.md)
for TD to pick up.

**Databases touched: LOCAL ONLY.** Hosted is never contacted. Every migration's
SQL is recorded here and its hosted application is a checklist item.

**THIS DOCUMENT IS THE TRACKER.** Checkboxes are the source of truth for what is
done — not the conversation, and not memory.

---

## Status

| Phase                                              | Branch                        | PR  | State       |
| -------------------------------------------------- | ----------------------------- | --- | ----------- |
| 1 · API layer (bearer routes in apps/agent)        | `feat/native-p1-api-layer`    | —   | in progress |
| 2 · Location cadence + retention                   | (same branch as 1)            | —   | pending     |
| 3 · Native shell: login, shift, background location | `feat/native-p3-shell`        | —   | pending     |
| 4 · Native UI kit + every driver screen            | `feat/native-p4-screens`      | —   | pending     |
| 5 · Push + realtime                                | `feat/native-p5-push`         | —   | pending     |
| 6 · Admin live driver map                          | `feat/native-p6-admin-map`    | —   | pending     |
| 7 · Distribution prep                              | `feat/native-p7-distribution` | —   | pending     |
| 8 · Web agent app onto the shared handlers         | `feat/native-p8-web-handlers` | —   | pending     |

---

## Decisions (locked with TD before the run)

| #   | Decision                | Chosen                                                                                                       |
| --- | ----------------------- | ------------------------------------------------------------------------------------------------------------ |
| 1   | Framework               | Expo + React Native, one codebase, iOS + Android only                                                        |
| 2   | Scope                   | Everything a driver does moves native; web agent app stays as a fallback, maintenance only after parity      |
| 3   | Location                | Every 5 s while ON SHIFT (idle or on a job), never off the clock                                              |
| 4   | Retention               | Every fix updates `driver_positions`; roughly every 30th fix lands in `driver_position_pings`                 |
| 5   | Freshness window        | `POSITION_FRESH_MS` 90 s → 30 s; web pinger cadences drop to 10 s so web drivers do not read as stale         |
| 6   | Auth                    | Email + password via Supabase, same accounts as web; `Authorization: Bearer <access token>` to the API        |
| 7   | API placement           | Bearer-token JSON route handlers inside apps/agent under `/api/v1/`, reusing @koolee/core                     |
| 8   | Invite                  | Admin invite link keeps landing on the web set-password page; driver then signs into the app                 |
| 9   | Push                    | Expo push relay as a second channel beside web push                                                          |
| 10  | Distribution            | Personal phones; Apple Unlisted App Distribution + Play unlisted; invite-only via admin                       |
| 11  | Seals                   | Camera barcode scan with manual fallback                                                                     |
| 12  | Offline                 | Positions AND actions queue on device, replay in order on reconnect (idempotency keys server-side)            |
| 13  | Builds                  | Separate dev and prod build profiles, no in-app environment switch                                            |
| 14  | Keep-awake              | Screen held awake while on shift and online; background location continues when locked or backgrounded       |
| 15  | UI                      | Same look as the web agent app: NativeWind on the same theme tokens, same fonts, native twins of the UI kit   |

---

## Phase 1 · API layer

- [ ] 1.1 `packages/api-contract` — zod schemas + types shared by routes and the app (no db deps)
- [ ] 1.2 Bearer-token session: `requireAgentSession(request)` accepts `Authorization: Bearer` alongside the cookie
- [ ] 1.3 Request-bound Supabase client for storage verification under the agent's own token
- [ ] 1.4 Idempotency: `api_idempotency_keys` table (migration), `Idempotency-Key` header on every mutating route
- [ ] 1.5 Shared handler module (`src/api/handlers/*`) used by routes now and by server actions in phase 8
- [ ] 1.6 Routes: me, shift (get/start/end), trucks, tasks (list/detail), the 12 visit + pickup steps, journey start-pickup, account avatar
- [ ] 1.7 `driver-position` route accepts bearer auth
- [ ] 1.8 Tests per route (vitest) + typecheck + lint green
- [ ] 1.9 PR opened and merged into the integration branch

## Phase 2 · Location cadence + retention

- [ ] 2.1 `POSITION_FRESH_MS` 90 s → 30 s and every dependent threshold revisited (position-health, ghost/stale copy)
- [ ] 2.2 `recordDriverPosition` samples the pings table (one row per driver per ~150 s) while every fix updates the latest row
- [ ] 2.3 Web pinger cadences → 10 s (en_route / on_shift), carrying unchanged or 10 s (decide from code)
- [ ] 2.4 Tests updated + new tests for sampling

## Phase 3 · Native shell

- [ ] 3.1 `apps/driver` Expo SDK 57 app in the monorepo (expo-router, NativeWind, TypeScript, Sentry, eas.json dev/prod profiles)
- [ ] 3.2 Email + password sign-in against Supabase, token in secure storage, silent refresh, role gate via `/api/v1/me`
- [ ] 3.3 Shift bar with truck picker (start/end)
- [ ] 3.4 Background location every 5 s: expo-location + task-manager, iOS Always + background mode, Android foreground service, keep-awake, battery-optimisation prompt, significant-change relaunch
- [ ] 3.5 On-device SQLite queue for positions, batched sends, ordered replay on reconnect
- [ ] 3.6 Tasks list (home) screen
- [ ] 3.7 Runs on the iOS simulator and the Android emulator; screenshots in the report
- [ ] 3.8 `eas init` + one cloud Android build to prove the pipeline

## Phase 4 · Native UI kit + screens

- [ ] 4.1 `packages/ui-native`: Card family, Button, Badge, Input, Label, Select, Popover, Avatar, PageHeader, EmptyState, PageSkeleton, ContentColumn, FormMessage — same names/props, same tokens
- [ ] 4.2 Screens ported one-for-one: tasks list, task detail, visit flow (camera passport capture), pickup flow (camera seal scan + manual), account, offline state, login, reset
- [ ] 4.3 Offline ACTION queue with idempotent replay
- [ ] 4.4 Every screen verified on both simulators

## Phase 5 · Push + realtime

- [ ] 5.1 Expo push token registration route + storage (migration)
- [ ] 5.2 Expo push sender as a second channel in core notifications
- [ ] 5.3 Realtime subscriptions in the app (task assignment / booking signals), filtered per driver

## Phase 6 · Admin live driver map

- [ ] 6.1 Live map on the admin shifts page over `driver_positions` realtime, stale state from position-health

## Phase 7 · Distribution prep

- [ ] 7.1 app.json: bundle ids, permission strings, background modes, privacy manifest, icons, splash
- [ ] 7.2 eas.json production profiles; Android production build proven (no Google account needed)
- [ ] 7.3 Apple location-justification copy + Unlisted distribution request text drafted
- [ ] 7.4 CHECKLIST.md complete with every account-dependent step

## Phase 8 · Web agent app onto the shared handlers

- [ ] 8.1 Server actions delegate to the same handler module as the routes (one code path)

---

## Migrations in this run

| #    | Purpose | SQL recorded | Applied locally | Hosted |
| ---- | ------- | ------------ | --------------- | ------ |
| —    | —       | —            | —               | —      |

---

## Log

- 2026-09-27 — Integration branch and phase-1 branch cut. Understand workflow (7 readers) launched.
