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

| Phase                                               | Branch                        | PR  | State     |
| --------------------------------------------------- | ----------------------------- | --- | --------- |
| 1 · API layer (bearer routes in apps/agent)         | `feat/native-p1-api-layer`    | #44 | merged    |
| 2 · Location cadence + retention                    | (same branch as 1)            | #44 | merged    |
| 3 · Native shell: login, shift, background location | `feat/native-p3-shell`        | #45 | merged    |
| 4 · Native UI kit + every driver screen             | `feat/native-p4-screens`      | #47 | merged    |
| 5 · Push + realtime                                 | `feat/native-p5-push`         | —   | in review |
| 6 · Admin live driver map                           | `feat/native-p6-admin-map`    | —   | pending   |
| 7 · Distribution prep                               | `feat/native-p7-distribution` | —   | pending   |
| 8 · Web agent app onto the shared handlers          | `feat/native-p8-web-handlers` | #46 | merged    |

---

## Decisions (locked with TD before the run)

| #   | Decision         | Chosen                                                                                                      |
| --- | ---------------- | ----------------------------------------------------------------------------------------------------------- |
| 1   | Framework        | Expo + React Native, one codebase, iOS + Android only                                                       |
| 2   | Scope            | Everything a driver does moves native; web agent app stays as a fallback, maintenance only after parity     |
| 3   | Location         | Every 5 s while ON SHIFT (idle or on a job), never off the clock                                            |
| 4   | Retention        | Every fix updates `driver_positions`; roughly every 30th fix lands in `driver_position_pings`               |
| 5   | Freshness window | `POSITION_FRESH_MS` 90 s → 30 s; web pinger cadences drop to 10 s so web drivers do not read as stale       |
| 6   | Auth             | Email + password via Supabase, same accounts as web; `Authorization: Bearer <access token>` to the API      |
| 7   | API placement    | Bearer-token JSON route handlers inside apps/agent under `/api/v1/`, reusing @koolee/core                   |
| 8   | Invite           | Admin invite link keeps landing on the web set-password page; driver then signs into the app                |
| 9   | Push             | Expo push relay as a second channel beside web push                                                         |
| 10  | Distribution     | Personal phones; Apple Unlisted App Distribution + Play unlisted; invite-only via admin                     |
| 11  | Seals            | Camera barcode scan with manual fallback                                                                    |
| 12  | Offline          | Positions AND actions queue on device, replay in order on reconnect (idempotency keys server-side)          |
| 13  | Builds           | Separate dev and prod build profiles, no in-app environment switch                                          |
| 14  | Keep-awake       | Screen held awake while on shift and online; background location continues when locked or backgrounded      |
| 15  | UI               | Same look as the web agent app: NativeWind on the same theme tokens, same fonts, native twins of the UI kit |

---

## Phase 1 · API layer

- [x] 1.1 `packages/api-contract` — zod schemas + types shared by routes and the app (no db deps)
- [x] 1.2 Bearer-token session: `requireAgentSession(request)` accepts `Authorization: Bearer` alongside the cookie
- [x] 1.3 Request-bound Supabase client for storage verification under the agent's own token
- [x] 1.4 Idempotency: `api_idempotency_keys` table (migration), `Idempotency-Key` header on every mutating route
- [x] 1.5 Shared handler module (`src/api/handlers/*`) used by routes now and by server actions in phase 8
- [x] 1.6 Routes: me, shift (get/start/end), trucks, tasks (list/detail), the 12 visit + pickup steps, journey start-pickup, account avatar
- [x] 1.7 `driver-position` route accepts bearer auth
- [x] 1.8 Tests per route (vitest) + typecheck + lint green — apps/agent 292 tests / 32 files, core 622 unit + 55 integration touched, api-contract 7; tsc, eslint and repo-wide prettier clean
- [x] 1.9 PR opened and merged into the integration branch — #44, merge commit `01c71bd`

## Phase 2 · Location cadence + retention

- [x] 2.1 `POSITION_FRESH_MS` 90 s → 30 s and every dependent threshold revisited (position-health, ghost/stale copy)
- [x] 2.2 `recordDriverPosition` samples the pings table (one row per driver per ~150 s) while every fix updates the latest row
- [x] 2.3 Web pinger cadences → 10 s in every phase (a fallback surface has no reason to be slower than the freshness window allows)
- [x] 2.4 Tests updated + new tests for sampling

## Design notes locked during the run (survive context loss)

**Phase 3 — the app.** Expo SDK 57 = React Native 0.86.3 / React 19.2.3 (not 0.87; `npx expo install --fix` pins). Scaffold `pnpm create expo-app apps/driver --template default` (Expo Router + TS), pnpm isolated linker is supported (SDK 54+), Metro auto-configures the monorepo. `index.js` custom entry: import the location task module (`TaskManager.defineTask` at module scope), Sentry init, then `expo-router/entry` LAST. `expo-build-properties` `ios.enableSceneSupport: true` (Xcode 27 on this Mac; EAS uses 26.6). NativeWind 4.2.7 + Tailwind 3.4 (v5 is an RC); tokens come from `packages/ui/styles/theme.css` through `apps/driver/scripts/theme-tokens.mjs` → committed `tailwind.tokens.js` (HSL channels → RGB triplets, brand hex scales, radius). Fonts via `@expo-google-fonts/sora` + `@expo-google-fonts/inter`. Supabase auth storage = the official LargeSecureStore (AES key in SecureStore, ciphertext in AsyncStorage) + `startAutoRefresh` on AppState. Hosted Turnstile: `signInWithPassword` needs `captchaToken`, so the login screen hosts a WebView on `<agent origin>/turnstile` (a tiny page in apps/agent that renders the widget and posts the token back); locally captcha is off and the field is skipped. Background location: `Location.startLocationUpdatesAsync(task, { accuracy: High, timeInterval: 5000 (Android), distanceInterval: 0, deferredUpdatesInterval: 5000, showsBackgroundLocationIndicator: true, pausesUpdatesAutomatically: false, activityType: AutomotiveNavigation, foregroundService: {…, killServiceOnDestroy: false} })`, started from the Start-shift screen (Android 12+/14+ cannot start a location FGS from the background). Two-step permissions (foreground then background; Android 11+ opens Settings). expo-location has NO significant-change API — the iOS relaunch mitigation is `startGeofencingAsync` with one region around the last fix (re-armed on each fix); Android relies on the FGS. Battery optimisation: `expo-battery.isBatteryOptimizationEnabledAsync` + `expo-intent-launcher` `IGNORE_BATTERY_OPTIMIZATION_SETTINGS` (the settings page, never the direct-request intent — Play policy). Keep-awake: `useKeepAwake` while on shift and online. Queue: expo-sqlite WAL, positions + actions tables, replay in order, `Idempotency-Key` per action. Expo Go is out: development builds only (`eas build --profile development`, iOS simulator variant needs no Apple account, Android APK needs no Play account). `eas.json` pins node 24.15.0 / pnpm 11.18.0. `@sentry/react-native` 8.28 must sit in `expo.install.exclude`.

**Phase 4 — kit + screens.** `packages/ui-native` (NativeWind components with the same names/props/classes as `packages/ui`: Card family, Button, Badge, Input, Label, Select (native picker sheet), Popover (bottom sheet), Avatar, PageHeader, EmptyState, PageSkeleton, ContentColumn, FormMessage, CustodyTimeline, StageDot, SegmentedControl, BookingRef). Screens = the 8 web pages one-for-one; `lib/job.ts` ports as-is (pure). Time formatters: port the pure airport-tz formatters (date-fns + @date-fns/tz) into a small `packages/time` package shared by core and the app so times render in the booking's airport zone, never the device zone. Photos: downscale on device (expo-image-manipulator, 1600 px / ~700 KB JPEG), upload straight to Storage under the user's JWT (`passportPhotoPath`/`bagPhotoPath` from the contract), then POST the path. Seal scan: `CameraView` with `barcodeScannerSettings` (qr, code128, ean13, …) + manual `Input` fallback.

**Phase 5 — push + realtime.** New table `driver_push_tokens` (0038): `id`, `user_id → users cascade`, `token text UNIQUE` (Expo push token), `platform ios|android`, `device_label`, `app varchar(16) = "driver"`, `created_at`, `last_seen_at`, `disabled_at`. `POST /api/v1/push/register` (upsert on token, moves to the caller like web push), `DELETE /api/v1/push/register`. Core: `ExpoPushSender` (expo-server-sdk) behind a new subpath `@koolee/core/expo-push` (Node-only, like web-push); `pushToUsers` fans out to BOTH web-push targets and Expo tokens; `DeviceNotRegistered` receipts disable the token. Server needs `EXPO_ACCESS_TOKEN` (CHECKLIST E1) only for enhanced security; sends work without it. Realtime in the app: same `booking_signals` filtered subscription per assigned booking id (`can_watch_booking` already admits assignees), poll when nothing is assigned; tasks list refetch on signal.

**Phase 6 — admin live map.** Migration (0039): `driver_positions` + `driver_shifts` REPLICA IDENTITY FULL, added to `supabase_realtime`, SECURITY DEFINER `public.is_active_admin(uid)` (staff_members role=admin, active), SELECT policies on both tables for `authenticated` where `is_active_admin(auth.uid())`, and `GRANT SELECT` on both TO authenticated (a policy without the grant is silently dead — 0031 precedent). Admin needs a browser Supabase client (cookie `sb-koolee-admin-auth`) — none exists today. Map: `LiveMap` from `@koolee/ui` (MapLibre + OpenFreeMap) on `/shifts`, one pin per open shift, variant live/stale from `positionHealthOf` (gap 2 min), realtime on `driver_positions` with a per-driver `staff_user_id=eq.<id>` filter per open shift (never unfiltered) + 15 s poll; `scripts/copy-maplibre-worker.mjs apps/admin` added to admin's dev/build scripts.

## Phase 3 · Native shell

- [x] 3.1 `apps/driver` Expo SDK 57 app in the monorepo (expo-router, NativeWind, TypeScript, Sentry, eas.json dev/prod profiles)
- [x] 3.2 Email + password sign-in against Supabase, token in secure storage, silent refresh, role gate via `/api/v1/me`
- [x] 3.3 Shift bar with truck picker (start/end)
- [x] 3.4 Background location every 5 s: expo-location + task-manager, iOS Always + background mode, Android foreground service, keep-awake, battery-optimisation prompt, significant-change relaunch
- [x] 3.5 On-device SQLite queue for positions, batched sends, ordered replay on reconnect
- [x] 3.6 Tasks list (home) screen
- [x] 3.7 Runs on the iOS simulator and the Android emulator (sign-in, Today, the OS location prompts, Live tracking, foreground + background position batches on both)
- [x] 3.8 `eas init` (project `@koolee-cloud/koolee-driver`) + cloud development builds for Android (APK) and the iOS simulator both finished — EAS generated the Android keystore itself

## Phase 4 · Native UI kit + screens

- [x] 4.1 Native UI kit — in `apps/driver/src/components/ui` rather than a `packages/ui-native` package (it has one consumer). The web kit's names, props and token classes; the mapping table is the kit's README. Popover and PageHeader were not ported on purpose (the shift pill became a card; screens set their own title).
- [x] 4.2 Screens one-for-one: Today, Schedule (To do / History), Account (photo, location, offline), the task screen with the visit flow (arrive → agreement + passport photo and confirm → seal each bag: photo, camera scan or typed seal, weight → complete) and the pickup flow (set off → check each seal: scan or type → load → deliver or hand over), the stopped and overdue states, flag-a-problem on both, login with "Forgot your password?" opening the web reset page (decision 8). Times render in the airport zone through twins of core's formatters, held to core's output by `time-parity.test.ts` — not the planned `packages/time`: core does not ship to a phone and the twins are a dozen lines.
- [x] 4.3 Offline ACTION queue with idempotent replay: `runStep` mints the key before the first attempt, queues the step when there is no signal (and a photo step keeps its local file, uploaded at replay), `useReplay` sends the queue oldest-first with the same key when the signal or the app comes back.
- [x] 4.4 Verified on both simulators with the Maestro flows in `apps/driver/e2e/maestro`: the three tabs, a visit opened from the schedule, a stopped visit, an overdue pickup, a pickup set-off (a real custody event), a seal that cannot match (the refusal verbatim, `409`, nothing loaded), the problem form; on Android, "I've arrived" tapped with the network off showed "Saved — will send when you have signal.", reached nobody, and landed (`200`) when the network came back — the visit then read "Arrived — visit started".

## Phase 5 · Push + realtime

- [x] 5.1 Expo push token registration: `driver_push_tokens` (0038 — unique on the token, so a phone that changes hands moves to whoever signs in; a dead token is disabled, not deleted), `POST`/`DELETE /api/v1/push/register`, and `POST /api/v1/push/test` for the Account tab's "did you see it?" check (refuses `not_configured` / `no_subscription` like the web's, and when the relay says no it says WHY: `setup` for missing APNs/FCM credentials, `device`, `relay`). The app registers from Account → Notifications only (the OS prompt is one-shot, as on the web), re-registers silently on every signed-in launch, and unregisters on sign-out while the session still works.
- [x] 5.2 Expo push as a second channel in core: `ExpoRelayPushSender` behind `@koolee/core/expo-push` (Node-only, like web push), `ConsoleExpoPushSender` by default, gated by the same `NEXT_PUBLIC_PUSH_NOTIFICATIONS_ENABLED`; `pushToUsers` fans out to web subscriptions AND Expo tokens, each isolated from the other's failures; `DeviceNotRegistered` tickets and receipts disable the token; refusals are logged once per code. The location nudge now counts an Expo send as a nudge. Every job push already carries a `pickup-task:<id>` / `verification-task:<id>` tag, so a tap opens the right task with no payload change.
- [x] 5.3 Realtime in the app: a native twin of `useBookingSignal` (filtered per booking — never unfiltered — debounced, refetch on connect and on return to the foreground), watched from the tab layout for the whole list ("New job assigned to you.") and on the task screen for its booking ("Identity confirmed — you can seal the bags now.", "This pickup is yours — the customer picked you."). It skips changes the driver made themselves: their own 5 s pings touch the signal of every booking they carry, and without the skip the list and the open task refetched every five seconds.

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

| #    | Purpose                                                          | SQL recorded | Applied locally                   | Hosted          |
| ---- | ---------------------------------------------------------------- | ------------ | --------------------------------- | --------------- |
| 0037 | `api_idempotency_keys` — replay-safe mutating routes for the app | below        | dev + `koolee_test` (test:env:up) | ⏳ CHECKLIST F1 |
| 0038 | `driver_push_tokens` — the native app's Expo push tokens         | below        | dev + `koolee_test`               | ⏳ CHECKLIST F1 |

### 0037 · `api_idempotency_keys`

Pure `CREATE TABLE`, no lock on an existing table beyond the FK to `users`,
no scan, one `DROP TABLE` to reverse. RLS enabled explicitly (no policy, no
grant — server-only). Generated by drizzle-kit from
`packages/db/src/schema/api.ts`; the RLS statement is a hand-written custom
addition per MIGRATIONS.md §4.

```sql
CREATE TABLE "api_idempotency_keys" (
	"user_id" uuid NOT NULL,
	"key" varchar(128) NOT NULL,
	"route" text NOT NULL,
	"request_hash" text NOT NULL,
	"status" integer,
	"response_body" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "api_idempotency_keys_user_id_key_pk" PRIMARY KEY("user_id","key")
);
ALTER TABLE "api_idempotency_keys" ADD CONSTRAINT "api_idempotency_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
CREATE INDEX "api_idempotency_keys_created_at_idx" ON "api_idempotency_keys" USING btree ("created_at");
ALTER TABLE "public"."api_idempotency_keys" ENABLE ROW LEVEL SECURITY;
```

### 0038 · `driver_push_tokens`

Pure `CREATE TABLE` with two indexes on the new, empty table — no lock on
anything that has rows, no scan, one `DROP TABLE` to reverse. RLS on
explicitly, no policy, no grant (server-only: registered through the bearer
route, read by the fan-out). Generated by drizzle-kit from
`packages/db/src/schema/push.ts`; the RLS statement is a hand-written custom
addition.

```sql
CREATE TABLE "driver_push_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token" text NOT NULL,
	"platform" varchar(16) NOT NULL,
	"device_label" varchar(120),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disabled_at" timestamp with time zone
);
ALTER TABLE "driver_push_tokens" ADD CONSTRAINT "driver_push_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
CREATE UNIQUE INDEX "driver_push_tokens_token_key" ON "driver_push_tokens" USING btree ("token");
CREATE INDEX "driver_push_tokens_user_idx" ON "driver_push_tokens" USING btree ("user_id");
ALTER TABLE "public"."driver_push_tokens" ENABLE ROW LEVEL SECURITY;
```

---

## Log

- 2026-09-27 — Integration branch and phase-1 branch cut. Understand workflow (7 readers) launched.
- 2026-09-27 — Phase 1 foundations committed (`2474b20`): contract package, bearer session, route wrapper, idempotency (0037 applied locally), me/shift/trucks routes. Phase 2 landed in the same commit: freshness 30 s, gap 2 min, ping sampling 150 s, web cadence 10 s (core unit 622 pass, driver-selection + position-health integration 49 pass, api-idempotency integration 6 pass). Four agents are writing the tasks/visit/pickup/positions/account handlers, routes and tests; a refute-first review pass follows.
- 2026-09-27 — Expo research returned (saved to the session notes as `expo-recipe.md`): SDK 57 pins RN 0.86.3 (not 0.87); NativeWind 4.2.7 needs Tailwind 3.4 (token-conversion script from theme.css); expo-location has NO significant-change API (geofencing is the only iOS relaunch path) — decision 14's "significant-change relaunch" becomes a geofence around the last known position; Xcode 27 needs `expo-build-properties` `ios.enableSceneSupport`; Expo Go is out (dev builds only).
- 2026-09-27 — Routes landed via a 4-implementer + 4-reviewer workflow (refute-first). Reviewers fixed: whole DB rows leaking on the wire (pricing, agreement body, customer IP/UA) → server-side projection; shape-only route tests → wrapper-driven tests that prove schema binding and handler wiring; non-uuid task ids reaching Postgres as 500 → 404 guard; parity test missing CANCELLATION_ACTORS. I added the assignment check before the storage probe in `sealBag` (a stranger gets 404, never a 400 that reveals whether an object exists) and raised the agent vitest timeout for cold core imports. Full suite green; agent production build running.
- 2026-09-27 — Phase 3 on the iOS simulator (iPhone 18 Pro, iOS 27, Xcode 27): `apps/driver` builds with xcodebuild after `expo prebuild`, loads from Metro through the dev client, signs in the seeded agent against the LOCAL Supabase + the agent dev server on :3011, renders Today with the shift card and real jobs (Sora/Inter, brand tokens via the theme script). The location flow through the real system prompts ("Allow While Using App" → "Change to Always Allow") started the background task; with simulated positions the server logged `POST /api/v1/positions 200` three times in the foreground and FOUR MORE with the app on the home screen — the blocker this project exists for, closed on iOS. Toolchain lessons recorded in memory (Metro without CI=1, xcodebuild instead of `expo run:ios`, Maestro for taps, `react-native-css-interop` as a direct dependency under pnpm isolation).
- 2026-09-27 — Phase 3 on Android (Pixel 7 API 35 emulator, JDK 17, command-line SDK, no Android Studio): Gradle built the debug APK (fetching NDK r27 + CMake on its own), the app signed in against the local stack through the emulator's `10.0.2.2` host alias (dev builds rewrite `localhost` to it — `adb reverse` was silently dropped on every Maestro reconnect and the resulting ECONNREFUSED had been reading as "wrong password"), the system flow "While using the app" → Settings → "Allow all the time" ended in Location: Live with the foreground service up (`isForeground=true`, notification channel `koolee-driver-location`), five position batches reached the server in the foreground and ELEVEN more with the app on the home screen. EAS: `@koolee-cloud/koolee-driver` linked; development builds for Android (APK) and iOS simulator finished in the cloud.
- 2026-09-27 — Phase 4 on both simulators. Bugs the devices found that no unit test could: `crypto.randomUUID` does not exist on Hermes, so every step died before its request with "check your connection" (`newId()` now builds a v4 uuid from `getRandomValues`); the tab bar's fixed height ignored the home-indicator inset on both platforms; signed photo URLs pointed at the server's `127.0.0.1`, so every avatar on the Android emulator fell back to initials; a malformed task id reached Postgres and came back 500 (now 404); and — the one that would have cost real positions — two location batches landing together interleaved in expo-sqlite's non-exclusive `withTransactionAsync`, the second's ROLLBACK undid the first's transaction and the task failed with "cannot rollback - no transaction is active" (appends are now single INSERT statements, `busy_timeout` for the headless task's second connection). Offline replay proven end to end on Android. A parity test now holds the app's time formatters to core's across five zones and the DST transitions.
- 2026-09-27 — Phase 5 on both simulators, against the local agent server with push switched on. iOS: Account → Notifications → "Turn on notifications" → the OS prompt → a real Expo token → `POST /api/v1/push/register 201` → the test push reached Expo's relay, which refused it `InvalidCredentials — Could not find APNs credentials for cloud.koolee.driver`, and the card said exactly that (Koolee's side, nothing to change on the phone) instead of sending the driver to Settings — the whole pipeline proven up to Apple, which needs CHECKLIST A3. A push simulated with `xcrun simctl push` (the server's own `pickup-task:<id>` tag) opened the pickup from Notification Center. Sign-out sent `DELETE /api/v1/push/register`; signing back in re-registered silently. Android: the prompt, then no token until Firebase exists ("Unable to get Firebase Messaging instance" → CHECKLIST C), and the card says that too. Realtime `SUBSCRIBED` on both platforms for the list and for the open task, with the driver's own ping signals skipped. Found on the way: signing out re-rendered the Account tab with the session already gone and `useMe` threw a render error — fixed in this branch. Observed, not changed: the WEB agent app has the same own-ping refresh (`router.refresh()` on every one of the driver's own pings for a carried booking); worth the same skip when the web gets its next change.
