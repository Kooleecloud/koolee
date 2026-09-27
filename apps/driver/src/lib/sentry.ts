import * as Sentry from "@sentry/react-native";
import { isRunningInExpoGo } from "expo";

import { env } from "./env";

/**
 * Imported from the entry file, before Expo Router, so a crash during a
 * headless location wake is reported like any other. No DSN (a fresh clone,
 * a checklist item still open) means Sentry stays inert — `init` with an
 * empty DSN is a documented no-op.
 */
Sentry.init({
  dsn: env.sentryDsn || undefined,
  environment: env.channel,
  tracesSampleRate: 0.2,
  integrations: [
    Sentry.expoRouterIntegration({ enableTimeToInitialDisplay: !isRunningInExpoGo() }),
  ],
  enableNativeFramesTracking: !isRunningInExpoGo(),
});

export { Sentry };
