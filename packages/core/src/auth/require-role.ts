import type { UserRole } from "@koolee/db";

import { NotAuthorizedError } from "../errors";

/**
 * Role guard for the staff apps (agent, driver, admin) that are not built
 * yet — see `./types.ts` for why this is a seam, not an implementation.
 * Customer routes don't need this: they gate on session presence alone,
 * and every customer row is `role: "customer"`.
 */
export function assertRole(role: UserRole, allowed: readonly UserRole[]): void {
  if (!allowed.includes(role)) {
    throw new NotAuthorizedError(`role ${role} not permitted`);
  }
}
