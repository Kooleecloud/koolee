import type { UserRole } from "@koolee/db";

/**
 * Auth contracts. This is a **seam**, not an implementation.
 *
 * Only the customer path is real (Supabase phone OTP). Agent and admin
 * authentication is deliberately unbuilt — see `./stubs.ts` for what has to
 * replace it before either app is exposed to anything but localhost.
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

export interface AgentSession extends BaseSession {
  kind: "agent";
  role: "agent" | "driver";
  /** Populated when the user is a check-in agent. */
  agentId?: string;
  /** Populated when the user is a driver. */
  driverId?: string;
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
 * Whether a session may act on a booking.
 *
 * This is the authorization boundary — RLS is not, because every server-side
 * query runs on a service-role connection that bypasses it. See
 * `packages/db/README.md`.
 */
export function canActOnBooking(session: Session, booking: { userId: string }): boolean {
  switch (session.kind) {
    case "admin":
      return true;
    case "agent":
      // TODO: narrow to bookings with a task assigned to this user. Requires
      // the dispatch model, which is not built yet.
      return true;
    case "customer":
      return session.userId === booking.userId;
  }
}
