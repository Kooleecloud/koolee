import "server-only";

import { createDevAdminSessionReader, type AdminSession } from "@koolee/core";

import { env } from "@/env";

/**
 * Admin session.
 *
 * A development stub. It throws `NotImplementedError` outside
 * `NODE_ENV=development` — see the TODO(auth-admin) block in
 * `packages/core/src/auth/stubs.ts`. Admins can force state transitions and
 * issue refunds, so this app must not be reachable without real SSO and an
 * audit trail.
 */
const reader = createDevAdminSessionReader({ nodeEnv: env.NODE_ENV });

export async function getAdminSession(): Promise<AdminSession | null> {
  return reader.getSession();
}

/** Non-throwing variant so pages can render a refusal instead of a 500. */
export async function tryGetAdminSession(): Promise<
  { session: AdminSession | null } | { error: string }
> {
  try {
    return { session: await reader.getSession() };
  } catch (error: unknown) {
    return {
      error: error instanceof Error ? error.message : "Sign-in is not available.",
    };
  }
}
