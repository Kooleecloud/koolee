import "server-only";

import { createDevAgentSessionReader, type AgentSession } from "@koolee/core";

import { env } from "@/env";

/**
 * Agent session.
 *
 * A development stub. It throws `NotImplementedError` outside
 * `NODE_ENV=development` — see the TODO(auth-agent) block in
 * `packages/core/src/auth/stubs.ts` for what must exist before this app is
 * reachable from anywhere but localhost.
 */
const reader = createDevAgentSessionReader({ nodeEnv: env.NODE_ENV });

export async function getAgentSession(): Promise<AgentSession | null> {
  return reader.getSession();
}

/**
 * Non-throwing variant so a page can render a "not available" state instead of
 * a 500 when the stub refuses outside development.
 */
export async function tryGetAgentSession(): Promise<
  { session: AgentSession | null } | { error: string }
> {
  try {
    return { session: await reader.getSession() };
  } catch (error: unknown) {
    return {
      error: error instanceof Error ? error.message : "Sign-in is not available.",
    };
  }
}
