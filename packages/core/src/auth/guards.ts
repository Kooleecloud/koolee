import type { User } from "@koolee/db";

import { NotAuthenticatedError, NotAuthorizedError } from "../errors";

/**
 * Session guards for server actions and route handlers.
 *
 * Authorization lives in core, not in RLS (see packages/db/README.md). These
 * helpers throw typed errors so adapters can map them to redirects or result
 * unions without string-matching.
 */

/** Narrows away null/undefined; throws when there is no user at all. */
export function requireUser<T>(user: T | null | undefined): T {
  if (user === null || user === undefined) {
    throw new NotAuthenticatedError("Sign in to continue.");
  }
  return user;
}

/**
 * A verified customer: a real (non-anonymous) account with at least one
 * verified contact channel. Anonymous funnel sessions fail this — they must
 * pass the OTP gate first.
 */
export function requireVerifiedUser(user: User | null | undefined): User {
  const row = requireUser(user);
  if (row.isAnonymous) {
    throw new NotAuthorizedError("Verify your phone or email to continue.");
  }
  if (!row.phoneVerifiedAt && !row.emailVerifiedAt && !row.phone) {
    throw new NotAuthorizedError("Verify your phone or email to continue.");
  }
  return row;
}
