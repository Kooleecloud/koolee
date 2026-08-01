import { NotImplementedError } from "../errors";
import type {
  AdminSession,
  AdminSessionReader,
  AgentSession,
  AgentSessionReader,
} from "./types";

/**
 * Agent and admin authentication — NOT IMPLEMENTED.
 *
 * ============================ READ THIS ============================
 * These readers hand out a fully privileged session in development and refuse
 * to run anywhere else. That refusal is the only thing standing between the
 * agent/admin apps and an open door, so it is a hard throw rather than a
 * warning.
 *
 * Before either app is deployed to any environment reachable from the
 * internet — including a preview URL — the following must exist:
 *
 *   TODO(auth-agent):
 *     · Real identity for agents and drivers. Phone OTP against the same
 *       Supabase project is the obvious path, with `users.role` gating access.
 *     · Device binding or short session TTLs. An agent phone is a shared,
 *       frequently-lost device, and a stolen session can seal and sign for
 *       someone else's bags.
 *     · Narrow `canActOnBooking` for agents from "any booking" to "bookings
 *       with a task assigned to this user". See auth/types.ts.
 *
 *   TODO(auth-admin):
 *     · SSO (Google Workspace) with an allowlisted domain, plus a second
 *       factor. Admins can force state transitions and issue refunds.
 *     · An audit trail for every manual override. `custody_events` already
 *       records the transition; the actor must be a real, attributable person.
 *
 *   TODO(auth-both):
 *     · Rate limiting and lockout on the sign-in path.
 *     · Session revocation when a user is deactivated.
 * ===================================================================
 */

const DEV_AGENT_USER_ID = "00000000-0000-4000-8000-00000000a9e7";
const DEV_ADMIN_USER_ID = "00000000-0000-4000-8000-00000000ad11";

export interface DevSessionOptions {
  /** Pass `process.env.NODE_ENV` from the app; core does not read env. */
  nodeEnv: string | undefined;
  /** Override the dev user id, e.g. to match a seeded row. */
  userId?: string;
}

function assertDevelopment(what: string, nodeEnv: string | undefined): void {
  if (nodeEnv !== "development") {
    throw new NotImplementedError(
      `${what} authentication`,
      `Only a development stub exists. See the TODO(auth-*) block in ` +
        `packages/core/src/auth/stubs.ts. Refusing to issue a session with ` +
        `NODE_ENV="${nodeEnv ?? "undefined"}".`,
    );
  }
}

/**
 * Development-only agent session.
 *
 * @throws NotImplementedError outside `NODE_ENV=development`.
 */
export function createDevAgentSessionReader(
  options: DevSessionOptions,
): AgentSessionReader {
  return {
    getSession(): Promise<AgentSession | null> {
      assertDevelopment("Agent", options.nodeEnv);
      return Promise.resolve({
        kind: "agent",
        role: "agent",
        userId: options.userId ?? DEV_AGENT_USER_ID,
      });
    },
  };
}

/**
 * Development-only admin session.
 *
 * @throws NotImplementedError outside `NODE_ENV=development`.
 */
export function createDevAdminSessionReader(
  options: DevSessionOptions,
): AdminSessionReader {
  return {
    getSession(): Promise<AdminSession | null> {
      assertDevelopment("Admin", options.nodeEnv);
      return Promise.resolve({
        kind: "admin",
        role: "admin",
        userId: options.userId ?? DEV_ADMIN_USER_ID,
      });
    },
  };
}

export const DEV_SESSION_USER_IDS = {
  agent: DEV_AGENT_USER_ID,
  admin: DEV_ADMIN_USER_ID,
} as const;
