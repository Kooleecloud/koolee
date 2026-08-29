import { eq } from "drizzle-orm";
import {
  staffMembers,
  users,
  type Database,
  type StaffMember,
  type UserRole,
} from "@koolee/db";

import { assertRole } from "../auth/require-role";
import { ConflictError, NotAuthorizedError } from "../errors";

/**
 * Staff role assignment — the authorization source of truth for the agent
 * and admin apps.
 *
 * READ THIS before "fixing" access control by disabling signups: the shared
 * Supabase project must keep anonymous sign-ins enabled (the customer funnel
 * starts with `signInAnonymously()`), so ACCOUNT CREATION CANNOT BE DISABLED
 * PROJECT-WIDE and is not the security boundary. The boundary is the role:
 * every agent/admin page, server action, and route handler resolves the
 * session's role through `requireStaffRole` (which wraps the `assertRole`
 * seam), and an account with no active `staff_members` row gets nothing.
 *
 * Roles are never self-selected and never assigned client-side: rows are
 * written only by `createStaffMember`, which is called from the admin app's
 * invite action (service-role territory) and the local seed script.
 *
 * Deactivation is immediate by construction: the lookup happens on every
 * request, so flipping `active` to false fails `assertRole` on the very next
 * request even for a live session.
 */

export const STAFF_ROLES = ["agent", "admin"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export function isStaffRole(role: string): role is StaffRole {
  return (STAFF_ROLES as readonly string[]).includes(role);
}

/** The active staff role for an auth user, or null when they have none. */
export async function getActiveStaffRole(
  db: Database,
  userId: string,
): Promise<StaffRole | null> {
  const row = await db.query.staffMembers.findFirst({
    where: eq(staffMembers.userId, userId),
  });
  if (!row || !row.active || !isStaffRole(row.role)) return null;
  return row.role;
}

/**
 * The staff guard: resolves the user's active staff role and asserts it is
 * allowed. Throws `NotAuthorizedError` for customers, anonymous sessions,
 * deactivated staff, and staff of the wrong role — every entry point of the
 * agent/admin apps funnels through this.
 */
export async function requireStaffRole(
  db: Database,
  userId: string,
  allowed: readonly UserRole[],
): Promise<StaffRole> {
  const role = await getActiveStaffRole(db, userId);
  if (!role) {
    throw new NotAuthorizedError("No active staff role for this account.");
  }
  assertRole(role, allowed);
  return role;
}

export interface StaffMemberWithIdentity extends StaffMember {
  email: string | null;
  fullName: string | null;
  /** Key in the PRIVATE `avatars` bucket, or null. Signed by the caller. */
  avatarStoragePath: string | null;
}

/** All staff rows (active and deactivated), newest first, with identity. */
export async function listStaffMembers(
  db: Database,
): Promise<StaffMemberWithIdentity[]> {
  const rows = await db
    .select({
      member: staffMembers,
      email: users.email,
      fullName: users.fullName,
      avatarStoragePath: users.avatarStoragePath,
    })
    .from(staffMembers)
    .innerJoin(users, eq(users.id, staffMembers.userId))
    .orderBy(staffMembers.createdAt);
  return rows.map((r) => ({
    ...r.member,
    email: r.email,
    fullName: r.fullName,
    avatarStoragePath: r.avatarStoragePath,
  }));
}

export interface StaffIdentity {
  fullName: string | null;
  email: string | null;
  /** Key in the PRIVATE `avatars` bucket, or null. */
  avatarStoragePath: string | null;
  /**
   * May open a driver shift and be offered to customers as a driver.
   *
   * Carried on the IDENTITY rather than fetched separately because the agent
   * app decides whether to mount the shift bar on every render, and a
   * capability the shell has to ask for in a second round trip is one that
   * flickers. Read from `staff_members`, so deactivating an account or
   * revoking the grant takes effect on the next request like the role does.
   */
  canDrive: boolean;
}

/**
 * Display identity for one staff account — the name and face the agent app
 * puts on its own Account tab.
 *
 * Deliberately NOT `getCustomerById`: that reads the same table, but a staff
 * app reaching for a function named after customers is how a boundary stops
 * meaning anything. This returns only what a header renders.
 */
export async function getStaffIdentity(
  db: Database,
  userId: string,
): Promise<StaffIdentity | null> {
  const [row] = await db
    .select({
      fullName: users.fullName,
      email: users.email,
      avatarStoragePath: users.avatarStoragePath,
      canDrive: staffMembers.canDrive,
      active: staffMembers.active,
    })
    .from(users)
    .leftJoin(staffMembers, eq(staffMembers.userId, users.id))
    .where(eq(users.id, userId))
    .limit(1);

  if (!row) return null;
  return {
    fullName: row.fullName,
    email: row.email,
    avatarStoragePath: row.avatarStoragePath,
    // A deactivated staff row never grants a capability, whatever the column
    // says. The role guard already refuses the request; this keeps the two
    // answers from disagreeing if it is ever read on its own.
    canDrive: (row.canDrive ?? false) && (row.active ?? false),
  };
}

export interface SetStaffCanDriveInput {
  userId: string;
  canDrive: boolean;
}

/** Grants or revokes the driving capability. Admin-only at the action layer. */
export async function setStaffCanDrive(
  db: Database,
  input: SetStaffCanDriveInput,
): Promise<StaffMember | null> {
  const [row] = await db
    .update(staffMembers)
    .set({ canDrive: input.canDrive, updatedAt: new Date() })
    .where(eq(staffMembers.userId, input.userId))
    .returning();
  return row ?? null;
}

export interface CreateStaffMemberInput {
  /** Supabase auth uid of the (usually just-invited) account. */
  userId: string;
  email: string;
  role: StaffRole;
  /** Admin who issued the invite; null for seeded accounts. */
  invitedByUserId?: string | null;
  fullName?: string | null;
}

/**
 * Materialises the `public.users` row and the staff role assignment in one
 * transaction. Idempotent per user: re-inviting an existing staff member
 * updates the role and reactivates the row.
 *
 * The role is validated HERE, server-side — never trust a role value that
 * travelled through a form.
 */
export async function createStaffMember(
  db: Database,
  input: CreateStaffMemberInput,
): Promise<StaffMember> {
  if (!isStaffRole(input.role)) {
    throw new NotAuthorizedError(
      `Role "${String(input.role)}" cannot be assigned to staff — allowed: ${STAFF_ROLES.join(", ")}.`,
    );
  }

  try {
    return await db.transaction(async (tx) => {
      await tx
        .insert(users)
        .values({
          id: input.userId,
          email: input.email.toLowerCase(),
          fullName: input.fullName ?? null,
          role: input.role,
          isAnonymous: false,
        })
        .onConflictDoUpdate({
          target: users.id,
          set: {
            email: input.email.toLowerCase(),
            role: input.role,
            isAnonymous: false,
          },
        });

      const [row] = await tx
        .insert(staffMembers)
        .values({
          userId: input.userId,
          role: input.role,
          active: true,
          invitedByUserId: input.invitedByUserId ?? null,
        })
        .onConflictDoUpdate({
          target: staffMembers.userId,
          set: { role: input.role, active: true, updatedAt: new Date() },
        })
        .returning();

      if (!row) throw new Error("Insert of staff member returned no row");
      return row;
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError("email");
    throw error;
  }
}

/**
 * Deactivate (or reactivate) a staff member. Deactivation takes effect on
 * the next request — `requireStaffRole` reads this row every time.
 */
export async function setStaffMemberActive(
  db: Database,
  input: { userId: string; active: boolean },
): Promise<StaffMember | null> {
  const [row] = await db
    .update(staffMembers)
    .set({ active: input.active, updatedAt: new Date() })
    .where(eq(staffMembers.userId, input.userId))
    .returning();
  return row ?? null;
}

/** Postgres unique_violation (23505) anywhere on the cause chain. */
function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  while (typeof current === "object" && current !== null) {
    if ((current as { code?: unknown }).code === "23505") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
