# Native driver app — TD's checklist

> Everything on this page needs a human: an account, a payment, a phone in a
> hand, or a browser login that the build cannot do. Work top to bottom; each
> item says what to hand back so the next step can be run.
>
> Status of the code side lives in
> [`docs/run-reports/RUN-REPORT-16.md`](../../run-reports/RUN-REPORT-16.md).

**The code is done.** All eight phases are merged into `feat/agent-native-app` and verified on the iOS simulator and the Android emulator. Nothing is promoted to `dev` yet; that PR is yours.

**Suggested order**, fastest unblock first:

1. **T1–T5**: migrations on the hosted dev database, your PR from `feat/agent-native-app` into `dev`, the preview environment, then the first Android tester APK. You need no store account for this.
2. **C1–C3**: Android push.
3. **H1, D4**: Sentry.
4. **A1 → A7**: Apple, so iPhones get the app through TestFlight (T6). Send the Unlisted request (A4) the day A1 clears; it is the slowest step.
5. **B1 → B5**: Google Play. Enrol as an **Organisation** (B1).
6. At the production release: **F1–F2** (production database) and **E1–E2** (push env).

## T. Tester builds — on `dev`

Tester builds talk to `dev.agent.koolee.cloud`. The app calls `/api/v1` and opens `/turnstile` on the agent app, and today both exist only on `feat/agent-native-app`: `dev.agent.koolee.cloud/api/v1/me` answers 404. So the integration branch reaches `dev` first, and its migrations reach the hosted dev database before that.

- [ ] T1. Apply 0037–0039 to the **hosted dev** database **before** the merge. You run it:
  1. `pnpm db:status` against the dev direct URL; expect 0036 as the last one applied.
  2. `pnpm db:migrate`.

  It is safe while today's `dev` code keeps running, and the new code needs the tables the moment it deploys. 0037 and 0038 are new, server-only tables. 0039 adds admin-only read policies, grants and Realtime publication on `driver_positions` / `driver_shifts`: RLS has been on for both since 0029, and nothing on `dev` reads them from a browser. REPLICA IDENTITY FULL takes a brief exclusive lock on those two small tables. All SQL, and how to reverse it, is in RUN-REPORT-16. Afterwards, do F2's Replication check on the dev project.

- [ ] T2. Merge `feat/agent-native-app` into `dev` through a PR, which is yours to click. It merges without conflicts (the branch is ahead of `dev` and nothing behind). Vercel then redeploys `dev.koolee.cloud`, `dev.agent.koolee.cloud` and `dev.admin.koolee.cloud`. On `dev` this changes:
  - the web agent app now runs on the same handlers as the native API, and a failed sign-in check answers "try again" instead of signing the driver out;
  - web drivers report their position every 10 s;
  - the admin console gets the live map on `/shifts`;
  - there is a second push channel for the native app, and a new hourly cleanup job.
- [ ] T3. Check the deploy: `curl -s -o /dev/null -w '%{http_code}' https://dev.agent.koolee.cloud/api/v1/me` must print `401`, not `404`, and `/turnstile` must print `200`. Signed in as an admin with a driver on shift, `/shifts` on `dev.admin.koolee.cloud` should show the map.
- [ ] T4. Fill the EAS `preview` environment: D2, with `https://dev.agent.koolee.cloud` as the API. Hand back "done".
- [ ] T5. Build: `cd apps/driver && npx eas-cli build --platform android --profile preview`. The build page gives an install link and a QR code: that link is what testers get. A build whose environment is empty, or points at a laptop, fails on the build server with a list of what is missing, instead of shipping an app that can't sign in. Sign-in shows `preview · dev.agent.koolee.cloud` under the form, so a screenshot says which backend a build uses.
- [ ] T6. Getting it to people.
  - **Android, as soon as T5 is done:** send the link. Each tester opens it on the phone, allows their browser to install unknown apps, and taps "Install anyway" if Play Protect warns about an unknown developer. A newer build installs over the old one, because EAS keeps the same signing key.
  - **iPhone** needs A1–A2; there is no way onto someone else's iPhone without the Apple Developer Program. Once you have it, `npx eas-cli build --platform ios --profile beta --auto-submit` sends a build to TestFlight. Add testers as App Store Connect users (Internal testing: up to 100 people, no review, builds arrive in minutes), or use an External group with a public link (up to 10,000 people; the first build of each version waits for a short Beta App Review). TestFlight builds expire after 90 days.
  - **Before the Apple account exists:**
    - iPhone testers can use the web agent app at `dev.agent.koolee.cloud` on the same accounts, but it cannot share location from a locked phone.
    - Anyone with a Mac and Xcode can run the iOS simulator build: `--profile preview-simulator`. That is UI only: no real GPS, camera or push.
- [ ] T7. After the first T5 build, JavaScript-only fixes reach every tester without a new install: `pnpm --filter @koolee/driver update:preview --message "<what changed>"`. Testers get it on the next launch after that. Use the script rather than a bare `eas update`, because it sets two things that matter:
  - `--environment preview`, without which EAS refuses to publish on this SDK;
  - `EXPO_NO_DOTENV=1`, so your `.env.local` (localhost) can never fill a value the EAS environment lacks and reach testers' phones. A native change (a new module or permission, anything in `app.json`) still needs a new build, and the runtime-version fingerprint keeps an update away from builds it would break.

## A. Apple Developer account (blocks iPhone builds, iOS push, App Store)

- [ ] A1. Enrol at developer.apple.com (Organisation enrolment needs a D-U-N-S number; Individual is faster). ~1–3 days.
- [ ] A2. Once approved, run `npx eas-cli credentials --platform ios` in `apps/driver` and sign in with the Apple ID when prompted. EAS creates the distribution certificate and provisioning profiles. Hand back: "done".
- [ ] A3. Create an APNs key: Certificates, Identifiers & Profiles → Keys → + → enable Apple Push Notifications service → download the `.p8`. Upload it with `npx eas-cli credentials --platform ios` → Push Notifications. Hand back: "done".
- [ ] A4. Request Unlisted App Distribution: https://developer.apple.com/contact/request/unlisted-app/ — paste the answers from [STORE-COPY.md §2.1](STORE-COPY.md#21-unlisted-app-distribution-request). It takes days, so do it as soon as A1 clears.
- [ ] A5. In App Store Connect, create the app record (bundle id `cloud.koolee.driver`, name "Koolee Driver"). Then fill in:
  - App Privacy from [§2.3](STORE-COPY.md#23-app-privacy-app-store-connect--app-privacy);
  - App Review Information from [§2.2](STORE-COPY.md#22-app-review-notes-app-store-connect--app-review-information) (create the reviewer account it describes);
  - the listing from §1, with screenshots per §4.
- [ ] A6. Before the first submission, add a staff section to the privacy policy at `koolee.cloud/privacy`. Both stores check that it covers what this app collects, and today it describes customers only. There is a draft to review in [STORE-COPY.md §5](STORE-COPY.md#5-privacy-policy--staff-section-draft-for-review). It is legal copy, so it is not live anywhere yet.
- [ ] A7. First iPhone build, after A2, A3 and D2 (production values): `cd apps/driver && npx eas-cli build --platform ios --profile production`, then `npx eas-cli submit --platform ios --latest`. The build goes to App Store Connect; once A4 is approved, release it as Unlisted.

## B. Google Play developer account (blocks Play listing and Play-signed builds)

- [ ] B1. Register at play.google.com/console ($25 one-time) **as an Organisation, not a personal account**. Personal accounts created after 13 Nov 2023 must run a closed test with at least 12 testers for 14 days in a row before they can publish to production; Organisation accounts are exempt. An Organisation account needs a D-U-N-S number, the same one Apple's Organisation enrolment (A1) asks for, so get it once for both. Identity verification can take days. Until then, the T5 link is the Android route.
- [ ] B2. Create the app (package `cloud.koolee.driver`, "Koolee Driver", free, app not game). Play has no "Unlisted" setting for a public account. Ship on the **Internal testing** track: up to 100 drivers by email, with no review wait after the first release. Move to Closed testing past 100. The trade-offs are in [STORE-COPY.md §3.1](STORE-COPY.md#31-how-it-ships).
- [ ] B3. App content → the declarations. Paste the answers from [STORE-COPY.md §3.2–3.5](STORE-COPY.md#32-location-permissions-declaration-app-content--sensitive-permissions--location): location permission, foreground service (type Location), data safety, app access (reviewer account), ads, target audience, content rating. The background-location and foreground-service declarations both need a **short video**: 30 s, unlisted on YouTube. §3.2 says what it must show.
- [ ] B4. First release. Play requires the very first bundle of a new app to be uploaded by hand. A production Android build has already been proven on EAS (RUN-REPORT-16, phase 7), but it was built before D2's production values existed, so it can't sign anyone in. After D2, rebuild with `cd apps/driver && npx eas-cli build --platform android --profile production`, download the `.aab` from the build page, and upload it to Internal testing → Create release. B5 then makes every later release `npx eas-cli submit --platform android --latest`.
- [ ] B5. Service account for `eas submit`: Play Console → Setup → API access → create a service account with "Release manager", download its JSON key, then run `npx eas-cli submit --platform android --profile production` once with `--key <json>` so EAS stores it. Hand back: "done".

## C. Firebase (Android push only, free, no Play account needed)

- [ ] C1. console.firebase.google.com → Add project "koolee-driver" → add an Android app with package `cloud.koolee.driver`.
- [ ] C2. Project settings → Service accounts → Generate new private key (JSON). Upload it: `npx eas-cli credentials --platform android` → Google Service Account → FCM V1. Hand back: "done".
- [ ] C3. Project settings → General → your Android app → download `google-services.json`. Hand it back (or put it at `apps/driver/google-services.json`); the build then needs `"googleServicesFile": "./google-services.json"` under `expo.android` in `app.json` and a fresh dev build. Until this exists an Android phone cannot get a push token at all — the app's Notifications card says "Notifications need one more setup step on Koolee's side", which is this step.

## D. Expo / EAS (already logged in as owner of `koolee-cloud`)

- [ ] D1. Delete the stray project `@tdadlani/koolee-driver` (https://expo.dev/accounts/tdadlani/projects/koolee-driver): the first non-interactive `eas init` picked the personal account before `owner` was set. The real project is `@koolee-cloud/koolee-driver` (id `1bcbeffe-3a97-43bd-89a4-f9b785456f7f`), already linked in `apps/driver/app.json`.
- [ ] D2. Set the build-time environment for each EAS environment. The values are the hosted ones already in Vercel's **Preview** scope for the agent app; `EXPO_PUBLIC_*` values are public by design:

  ```bash
  cd apps/driver
  for ENV in development preview; do
    npx eas-cli env:create $ENV --name EXPO_PUBLIC_API_URL --value https://dev.agent.koolee.cloud --visibility plaintext --non-interactive
    npx eas-cli env:create $ENV --name EXPO_PUBLIC_SUPABASE_URL --value https://jpvlzoikcivxepgyrkho.supabase.co --visibility plaintext --non-interactive
    npx eas-cli env:create $ENV --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value <dev anon key> --visibility sensitive --non-interactive
    npx eas-cli env:create $ENV --name EXPO_PUBLIC_TURNSTILE_SITE_KEY --value <the agent app's site key> --visibility plaintext --non-interactive
    npx eas-cli env:create $ENV --name EXPO_PUBLIC_CHANNEL --value $ENV --visibility plaintext --non-interactive
  done
  # production: same five names with the production agent origin, the prod Supabase project (dblfbpxorleurqdlkylz) and its anon key
  ```

  If `env:create` is not a command in your eas-cli version, the dashboard (Project → Environment variables) does the same. Hand back: "done".

- [x] D3. Android keystore — not needed: EAS generated one during the run's first non-interactive cloud build (build `509aa8bb`, finished). Nothing to do.
- [ ] D4. Once the Sentry project exists (H1), add `SENTRY_AUTH_TOKEN` as an EAS secret: `npx eas-cli env:create production --name SENTRY_AUTH_TOKEN --value <token> --visibility secret` (and for `preview` too). In the same change, **delete `"env": { "SENTRY_DISABLE_AUTO_UPLOAD": "true" }` from `apps/driver/eas.json`** (build → base) so release builds upload source maps. Until the token exists, that line is what keeps release builds from failing: the first production build failed at `SentryUpload` with "Auth token is required".

## E. Vercel env for web, agent and admin (Preview and Production scopes)

- [ ] E1. Optional: `EXPO_ACCESS_TOKEN` — create at expo.dev → Account settings → Access tokens, set it (secret) on **koolee-web** (the Inngest functions that push job alerts run there), **koolee-agent** (the Account tab's test push) and **koolee-admin**, then turn on "Enhanced push security" in the EAS project settings so only Koolee can push to the app. Expo delivers without it. Hand back: "set".
- [ ] E2. Push is off unless `NEXT_PUBLIC_PUSH_NOTIFICATIONS_ENABLED=true` on those same three projects (it also gates web push, so it may already be on). With it off, the app's "Send a test notification" answers "notifications aren't set up on this environment yet".

## F. Hosted database

- [ ] F1. Apply the run's migrations to the **production** database when the integration branch is promoted (the dev database gets them earlier, in T1) (`pnpm db:status` first, then `pnpm db:migrate` with the direct URL): 0037 `api_idempotency_keys`, 0038 `driver_push_tokens`, 0039 admin driver Realtime (apply it outside a busy shift — it takes a brief exclusive lock on the two driver tables). The SQL for each is in RUN-REPORT-16.
- [ ] F2. After F1: Supabase dashboard → Database → Replication → the `supabase_realtime` publication must list `driver_positions` and `driver_shifts` (0039 adds them; confirm rather than assume). Then open `/shifts` in the admin console with a driver on shift: the map's hidden `data-fleet-map` attribute should read `live`; `polling` means a part of 0039 is missing (ADMIN-MAP.md §2).

## G. Phones for phase-3 field testing

- [ ] G1. Real phones.
  - **Android, now:** install the preview build's APK from its EAS build page link (order step 1). No Play account is needed.
  - **iPhone:** needs A1–A2 first. Then `npx eas-cli device:create` registers the phone. An internal-distribution build for it needs a profile with `ios.simulator: false`; add one when you get there, or go straight to A7.
  - On each phone: start a shift, lock the phone for ten minutes, then check the admin `/shifts` map kept moving.
- [ ] G2. Push, end to end (after A3 for iPhone, C1–C3 for Android, E2): sign in on the phone → Account → Notifications → "Turn on notifications" → allow → the card sends a test and asks "Did a notification just appear?". Then assign a visit to that driver from the admin console and check "New visit assigned" arrives and opens the visit when tapped.

## H. Sentry

- [ ] H1. Create a "koolee-driver" project (platform React Native) in Koolee's Sentry org; the run had no Sentry API access. Put its DSN in EAS as `EXPO_PUBLIC_SENTRY_DSN` for all three environments (it is public by design). Until then the app's Sentry stays inert. Then do D4.
