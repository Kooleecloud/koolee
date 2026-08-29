import { sql } from "drizzle-orm";
import { boolean, check, index, pgTable, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { createdAt, primaryId, updatedAt } from "./columns";
import { userRoleEnum } from "./enums";
import { users } from "./identity";

/**
 * Staff role assignments — the source of truth `assertRole` checks against.
 *
 * Why a table and not "disable signups": the shared Supabase project MUST
 * keep anonymous sign-ins (and therefore account creation) enabled — the
 * customer funnel starts with `signInAnonymously()`. Account creation cannot
 * be the security boundary. The boundary is the ROLE: an authenticated
 * account with no active row here gets nothing from the agent/admin apps.
 *
 * One row per user. `active = false` is deactivation: the per-request role
 * lookup in `@koolee/core` fails `assertRole` immediately, live session or
 * not. Rows are never deleted so the assignment history stays attributable
 * (who was invited by whom, and when).
 *
 * `role` is constrained to agent/admin — customers never get a row. The
 * `user_role` enum also carries `driver`, and the CHECK deliberately still
 * excludes it: DRIVING IS A CAPABILITY, NOT A THIRD ROLE. One person doing
 * both jobs is the stated v1 reality, and a third role would have forced every
 * authorization site (`STAFF_ROLES`, `getActiveStaffRole`, both app session
 * readers) to learn about a person who is an agent on Tuesday and a driver on
 * Thursday. `can_drive` says the same thing without splitting the roster.
 */
export const staffMembers = pgTable(
  "staff_members",
  {
    id: primaryId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: userRoleEnum("role").notNull(),
    active: boolean("active").notNull().default(true),
    /**
     * May open a `driver_shifts` row and be offered to customers as a driver.
     *
     * A capability alongside the role, not a role of its own — see the note
     * above. Defaults false: an existing agent does not silently become
     * selectable as a driver the moment this column lands.
     */
    canDrive: boolean("can_drive").notNull().default(false),
    /** The admin whose invite created this row. Null for seeded accounts. */
    invitedByUserId: uuid("invited_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("staff_members_user_id_key").on(t.userId),
    index("staff_members_role_active_idx").on(t.role, t.active),
    index("staff_members_can_drive_idx").on(t.canDrive, t.active),
    check("staff_members_role_check", sql`${t.role} in ('agent', 'admin')`),
  ],
);

export type StaffMember = typeof staffMembers.$inferSelect;
export type NewStaffMember = typeof staffMembers.$inferInsert;
