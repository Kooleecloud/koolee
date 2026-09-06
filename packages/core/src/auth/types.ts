import type { UserRole } from "@koolee/db";

/**
 * Auth contracts.
 *
 * Customers verify by phone/email OTP; staff (agent, admin) sign in with
 * email + password and are authorized by their `staff_members` row through
 * `requireStaffRole` (see `../services/staff.ts`) — the role lookup happens
 * per request, which is what makes deactivation immediate.
 */

export interface BaseSession {
  userId: string;
  role: UserRole;
  /** When the underlying token expires, if the provider tells us. */
  expiresAt?: Date;
}

export interface CustomerSession extends BaseSession {
  kind: "customer";
  role: "customer";
  phone: string;
  email?: string | null;
  fullName?: string | null;
}

/**
 * A field-staff session. One shape for both jobs — see `staff_members`: driving
 * is a capability (`can_drive`), not a third role, so the same person's session
 * covers a verification visit and a pickup run.
 *
 * It carries a `userId` and nothing else. It used to carry optional `agentId`
 * and `driverId` pointing at the `agents` and `drivers` tables; both tables
 * were empty scaffolding, both fields were never once populated, and migration
 * 0029 dropped the tables. Every lookup resolves through `users.id`.
 */
export interface AgentSession extends BaseSession {
  kind: "agent";
  role: "agent" | "driver";
}

export interface AdminSession extends BaseSession {
  kind: "admin";
  role: "admin";
}

export type Session = CustomerSession | AgentSession | AdminSession;

/* ------------------------------------------------------------------ */
/* Per-app session readers                                             */
/* ------------------------------------------------------------------ */

/**
 * Each app implements one of these against its own request context (cookies,
 * headers). Core consumes the interface and never reaches for a framework API.
 */

export interface CustomerSessionReader {
  /** Null when not signed in. Never throws for an ordinary anonymous visit. */
  getSession(): Promise<CustomerSession | null>;
}

export interface AgentSessionReader {
  getSession(): Promise<AgentSession | null>;
}

export interface AdminSessionReader {
  getSession(): Promise<AdminSession | null>;
}

export type SessionReader =
  CustomerSessionReader | AgentSessionReader | AdminSessionReader;

/* ------------------------------------------------------------------ */
/* Guards                                                              */
/* ------------------------------------------------------------------ */

export function isCustomerSession(session: Session): session is CustomerSession {
  return session.kind === "customer";
}

export function isAgentSession(session: Session): session is AgentSession {
  return session.kind === "agent";
}

export function isAdminSession(session: Session): session is AdminSession {
  return session.kind === "admin";
}

/**
 * Whether a session may act on a booking, decided synchronously.
 *
 * This is the authorization boundary — RLS is not, because every server-side
 * query runs on a service-role connection that bypasses it. See
 * `packages/db/README.md`.
 *
 * Agents are TASK-scoped: they may act only on bookings with a verification
 * or pickup task assigned to them, which needs a database read. This sync
 * check therefore answers `false` for agents; agent paths go through
 * `sessionCanActOnBooking` in `../services/bookings.ts`, which performs the
 * assignment lookup.
 */
export function canActOnBooking(session: Session, booking: { userId: string }): boolean {
  switch (session.kind) {
    case "admin":
      return true;
    case "agent":
      return false;
    case "customer":
      return session.userId === booking.userId;
  }
}
