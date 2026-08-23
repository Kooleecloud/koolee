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
 * `role` is constrained to agent/admin — customers never get a row, and
 * `driver` joins the enum's allowed set only when the dispatch model ships.
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
    check("staff_members_role_check", sql`${t.role} in ('agent', 'admin')`),
  ],
);

export type StaffMember = typeof staffMembers.$inferSelect;
export type NewStaffMember = typeof staffMembers.$inferInsert;
