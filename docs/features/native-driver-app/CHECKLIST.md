# Native driver app — TD's checklist

> Everything on this page needs a human: an account, a payment, a phone in a
> hand, or a browser login that the build cannot do. Work top to bottom; each
> item says what to hand back so the next step can be run.
>
> Status of the code side lives in
> [`docs/run-reports/RUN-REPORT-16.md`](../../run-reports/RUN-REPORT-16.md).

## A. Apple Developer account (blocks iPhone builds, iOS push, App Store)

- [ ] A1. Enrol at developer.apple.com (Organisation enrolment needs a D-U-N-S number; Individual is faster). ~1–3 days.
- [ ] A2. Once approved, run `npx eas-cli credentials --platform ios` in `apps/driver` and sign in with the Apple ID when prompted. EAS creates the distribution certificate and provisioning profiles. Hand back: "done".
- [ ] A3. Create an APNs key: Certificates, Identifiers & Profiles → Keys → + → enable Apple Push Notifications service → download the `.p8`. Upload it with `npx eas-cli credentials --platform ios` → Push Notifications. Hand back: "done".
- [ ] A4. Request Unlisted App Distribution: https://developer.apple.com/contact/request/unlisted-app/ — the request text is in `docs/features/native-driver-app/STORE-COPY.md`. Takes days; do this as soon as A1 clears.
- [ ] A5. In App Store Connect create the app record (bundle id `cloud.koolee.driver`), fill the privacy questions using `STORE-COPY.md`.

## B. Google Play developer account (blocks Play listing and Play-signed builds)

- [ ] B1. Register at play.google.com/console ($25 one-time). Identity verification can take days.
- [ ] B2. Create the app (package `cloud.koolee.driver`), choose "Unlisted" under Advanced settings → Managed publishing / or Internal testing + closed track (see `STORE-COPY.md`).
- [ ] B3. Service account for `eas submit`: Play Console → Setup → API access → create a service account with "Release manager", download its JSON key, then run `npx eas-cli submit --platform android --profile production` once with `--key <json>` so EAS stores it. Hand back: "done".

## C. Firebase (Android push only, free, no Play account needed)

- [ ] C1. console.firebase.google.com → Add project "koolee-driver" → add an Android app with package `cloud.koolee.driver`.
- [ ] C2. Project settings → Service accounts → Generate new private key (JSON). Upload it: `npx eas-cli credentials --platform android` → Google Service Account → FCM V1. Hand back: "done".

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
- [ ] D3. Android keystore: run `npx eas-cli credentials --platform android` once in `apps/driver`, choose the **development** profile → Keystore → "Set up a new keystore" and accept the generated one. EAS cannot generate it non-interactively, so the run's cloud Android build stops at this step until you do. Hand back: "done", then the run (or you) re-runs `npx eas-cli build --platform android --profile development`.
- [ ] D4. Add `SENTRY_AUTH_TOKEN` as an EAS secret (`npx eas-cli env:create production --name SENTRY_AUTH_TOKEN --value <token> --visibility secret`) once the Sentry project exists (H1), so release builds upload source maps.

## E. Vercel env for the agent app (both Preview and Production scopes)

- [ ] E1. `EXPO_ACCESS_TOKEN` — create at expo.dev → Account → Access tokens; needed by the server to send Expo push with enhanced security. Hand back: "set".

## F. Hosted database

- [ ] F1. Apply the run's migrations to hosted once the integration branch is promoted (`pnpm db:status` first, then `pnpm db:migrate` with the direct URL). The SQL for each is in RUN-REPORT-16.

## G. Phones for phase-3 field testing

- [ ] G1. One iPhone and one Android phone. Tell the build which models so the dev build can be installed by link.

## H. Sentry

- [ ] H1. If the run could not create a Sentry project through the API, create "koolee-driver" (React Native) in the Koolee org and hand back its DSN.
