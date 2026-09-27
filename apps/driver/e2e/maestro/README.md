# Driver app — on-device flows

[Maestro](https://maestro.mobile.dev) flows that drive a development build on
the iOS simulator or the Android emulator. They are how phases 3 and 4 of the
native app were verified (see `docs/run-reports/RUN-REPORT-16.md`), and they
are the quickest way to see every screen again after a change.

## Prerequisites

- The local stack: `pnpm local` (Supabase + seeded roster), the agent app on
  `:3011` (`cd apps/agent && npx next dev -p 3011`), Metro for this app
  (`cd apps/driver && npx expo start --dev-client`).
- A development build installed on the device: `npx expo prebuild`, then
  `xcodebuild … -sdk iphonesimulator` + `xcrun simctl install`, or
  `./gradlew :app:assembleDebug` + `adb install` (EAS `development` builds
  work too).
- Maestro 2.x on the PATH (`curl -Ls https://get.maestro.mobile.dev | bash`,
  needs a JDK 17).

## Run

```bash
cd apps/driver/e2e/maestro
IOS=<simulator udid>           # xcrun simctl list devices booted
# An array, not a string: zsh does not word-split "$ENV", and every -e would
# arrive as one argument (the flows then see `undefined`).
ENV=(-e AGENT_EMAIL=agent@koolee.local -e AGENT_PASSWORD=koolee-agent-dev-1
     -e VISIT_REF=KOO-XXXXX -e PICKUP_TASK_ID=<pickup task uuid>)

maestro --device "$IOS" test -e METRO_URL=http%3A%2F%2Flocalhost%3A8081 open-dev-client.yaml
maestro --device "$IOS" test "${ENV[@]}" sign-in.yaml screens.yaml visit.yaml

# Android: the emulator reaches the Mac at 10.0.2.2
maestro --device emulator-5554 test -e METRO_URL=http%3A%2F%2F10.0.2.2%3A8081 open-dev-client.yaml
```

`pickup.yaml` WRITES to the local database (the set-off is a custody event);
point `PICKUP_TASK_ID` at a throwaway local booking whose flight has not
left. `open-task.yaml` opens any task by id (`TASK_ID`, `TASK_KIND`, `SHOT`).

The flows are written to run in any order and after a failure: `_home.yaml`
(a subflow, not run on its own) backs out of a task screen first, and the
Schedule tab — which keeps both its view and its scroll position — is
scrolled back to its toggle and set to "To do" before anything looks for a
card. On Android the first `open-dev-client.yaml` after an install can land
on the dev launcher's home instead of the app; run it again.

Refs and task ids are local data, which is why no flow hard-codes one. List
them for the signed-in agent with `GET /api/v1/tasks` (bearer token from
`POST /auth/v1/token?grant_type=password` on the local Supabase).
