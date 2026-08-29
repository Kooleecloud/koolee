import {
  boolean,
  doublePrecision,
  index,
  pgTable,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { createdAt, primaryId, timestamptz } from "./columns";
import { userRoleEnum } from "./enums";

export const users = pgTable(
  "users",
  {
    id: primaryId(),
    /**
     * E.164. Primary identifier — customers verify it with a phone OTP.
     * Nullable because an anonymous funnel user has no phone until the
     * payment gate, and email-only travellers never set one.
     */
    phone: varchar("phone", { length: 20 }),
    email: varchar("email", { length: 320 }),
    fullName: text("full_name"),
    /**
     * Object key in the PRIVATE `avatars` bucket — `<userId>/<uuid>.<ext>`,
     * never a URL. Reads mint a short-lived signed URL; there is no public URL
     * to anybody's face. Null until they upload one, which is the common case
     * and the reason every surface needs an initials fallback.
     */
    avatarStoragePath: text("avatar_storage_path"),
    role: userRoleEnum("role").notNull().default("customer"),
    /** True for a guest funnel session (Supabase anonymous sign-in). */
    isAnonymous: boolean("is_anonymous").notNull().default(false),
    phoneVerifiedAt: timestamptz("phone_verified_at"),
    emailVerifiedAt: timestamptz("email_verified_at"),
    profileCompletedAt: timestamptz("profile_completed_at"),
    /** Touched on draft activity and sign-in; drives anonymous-user GC. */
    lastSeenAt: timestamptz("last_seen_at").notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("users_phone_key").on(t.phone),
    uniqueIndex("users_email_key").on(t.email),
    index("users_role_idx").on(t.role),
    index("users_anon_last_seen_idx").on(t.isAnonymous, t.lastSeenAt),
  ],
);

export const addresses = pgTable(
  "addresses",
  {
    id: primaryId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Customer-facing name for a saved address ("Home", "Office"). */
    label: text("label"),
    line1: text("line1").notNull(),
    line2: text("line2"),
    city: text("city").notNull(),
    state: varchar("state", { length: 2 }).notNull(),
    zip: varchar("zip", { length: 10 }).notNull(),
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    /** Google Places ID, when the address came from autocomplete. */
    placeId: text("place_id"),
    createdAt: createdAt(),
  },
  (t) => [
    index("addresses_user_id_idx").on(t.userId),
    index("addresses_zip_idx").on(t.zip),
  ],
);

/**
 * There is no `agents` table and no `drivers` table. Both existed as empty
 * scaffolding from 0000 until migration 0029 dropped them: zero rows, zero
 * reads, zero writes, in any app, ever.
 *
 * Staff identity is `users` + an active `staff_members` row, and that is the
 * whole of it. Role comes from `staff_members.role`, the ability to drive from
 * `staff_members.can_drive`, territory from `agent_zones`, and the vehicle from
 * `driver_shifts` → `trucks`. Nothing resolves an "agent id" or a "driver id",
 * which is why `AgentSession` no longer carries either.
 */

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Address = typeof addresses.$inferSelect;
export type NewAddress = typeof addresses.$inferInsert;
