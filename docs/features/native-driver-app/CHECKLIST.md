# Native driver app — TD's checklist

> Everything on this page needs a human: an account, a payment, a phone in a
> hand, or a browser login that the build cannot do. Work top to bottom; each
> item says what to hand back so the next step can be run.
>
> Status of the code side lives in
> [`docs/run-reports/RUN-REPORT-16.md`](../../run-reports/RUN-REPORT-16.md).

**The code is done.** All eight phases are merged into `feat/agent-native-app` and verified on the iOS simulator and the Android emulator. Nothing is promoted to `dev` yet; that PR is yours.

**Suggested order**, fastest unblock first:

1. **D1, D2** (dev + preview values), then an Android preview build: `cd apps/driver && npx eas-cli build --platform android --profile preview`. That is an installable APK with the JavaScript inside, talking to the hosted dev stack, so it puts the app on a real Android phone (**G1**) with no store account at all. A development build would need Metro running on your Mac.
2. **C1–C3**: Android push.
3. **H1, D4**: Sentry.
4. Your promotion PR to `dev`, then **F1–F2** (hosted migrations) and **E1–E2** (push env on Vercel).
5. **A1 → A7**: Apple, iPhone and push. Send the Unlisted request (A4) the day A1 clears; it is the slowest step.
6. **B1 → B5**: Google Play.

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

- [ ] B1. Register at play.google.com/console ($25 one-time). Identity verification can take days.
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
- [ ] D2. Set the build-time environment for each EAS environment (values are the hosted ones you already have in Vercel for the agent app; `EXPO_PUBLIC_*` values are public by design):

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

- [ ] F1. Apply the run's migrations to hosted once the integration branch is promoted (`pnpm db:status` first, then `pnpm db:migrate` with the direct URL): 0037 `api_idempotency_keys`, 0038 `driver_push_tokens`, 0039 admin driver Realtime (apply it outside a busy shift — it takes a brief exclusive lock on the two driver tables). The SQL for each is in RUN-REPORT-16.
- [ ] F2. After F1: Supabase dashboard → Database → Replication → the `supabase_realtime` publication must list `driver_positions` and `driver_shifts` (0039 adds them; confirm rather than assume). Then open `/shifts` in the admin console with a driver on shift: the map's hidden `data-fleet-map` attribute should read `live`; `polling` means a part of 0039 is missing (ADMIN-MAP.md §2).

## G. Phones for phase-3 field testing

- [ ] G1. Real phones.
  - **Android, now:** install the preview build's APK from its EAS build page link (order step 1). No Play account is needed.
  - **iPhone:** needs A1–A2 first. Then `npx eas-cli device:create` registers the phone. An internal-distribution build for it needs a profile with `ios.simulator: false`; add one when you get there, or go straight to A7.
  - On each phone: start a shift, lock the phone for ten minutes, then check the admin `/shifts` map kept moving.
- [ ] G2. Push, end to end (after A3 for iPhone, C1–C3 for Android, E2): sign in on the phone → Account → Notifications → "Turn on notifications" → allow → the card sends a test and asks "Did a notification just appear?". Then assign a visit to that driver from the admin console and check "New visit assigned" arrives and opens the visit when tapped.

## H. Sentry

- [ ] H1. Create a "koolee-driver" project (platform React Native) in Koolee's Sentry org; the run had no Sentry API access. Put its DSN in EAS as `EXPO_PUBLIC_SENTRY_DSN` for all three environments (it is public by design). Until then the app's Sentry stays inert. Then do D4.
