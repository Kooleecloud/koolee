import { Suspense } from "react";

import { DevPanelClient } from "@/components/dev-panel-client";
import { EnvStatus } from "@/components/env-status";
import { isDev } from "@/env";

/**
 * Dev-only diagnostics drawer, mounted once in the root layout. Renders
 * nothing outside development, so production builds ship no trace of it.
 *
 * The Environment section must be server-rendered here: describeEnvStatus()
 * reads server-only vars (DATABASE_URL, STRIPE_SECRET_KEY, …) that would all
 * report "missing" if evaluated in the browser. It is passed into the client
 * drawer as an already-rendered slot.
 */
export function DevPanel() {
  if (!isDev) return null;

  return (
    <Suspense>
      <DevPanelClient envSection={<EnvStatus appName="web" />} />
    </Suspense>
  );
}
