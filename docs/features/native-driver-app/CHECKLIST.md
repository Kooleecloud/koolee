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

- [ ] D1. Nothing to do until the builds exist; the run creates the project and profiles.

## E. Vercel env for the agent app (both Preview and Production scopes)

- [ ] E1. `EXPO_ACCESS_TOKEN` — create at expo.dev → Account → Access tokens; needed by the server to send Expo push with enhanced security. Hand back: "set".

## F. Hosted database

- [ ] F1. Apply the run's migrations to hosted once the integration branch is promoted (`pnpm db:status` first, then `pnpm db:migrate` with the direct URL). The SQL for each is in RUN-REPORT-16.

## G. Phones for phase-3 field testing

- [ ] G1. One iPhone and one Android phone. Tell the build which models so the dev build can be installed by link.

## H. Sentry

- [ ] H1. If the run could not create a Sentry project through the API, create "koolee-driver" (React Native) in the Koolee org and hand back its DSN.
