import { EnvStatusCard } from "@koolee/ui";

import { describeEnvStatus, isDev, warnMissingEnvOnce } from "@/env";

/**
 * Dev-only diagnostic: which external services have credentials, and what the
 * app does when they do not. Renders nothing outside development.
 */
export function EnvStatus({ appName }: { appName: string }) {
  if (!isDev) return null;

  warnMissingEnvOnce(appName);
  return <EnvStatusCard appName={appName} services={describeEnvStatus()} />;
}
