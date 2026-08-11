import { jsonb, pgTable, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { createdAt, primaryId, timestamptz, updatedAt } from "./columns";
import { users } from "./identity";

/**
 * Server-side booking-funnel draft, one per user.
 *
 * Deliberately NOT a `bookings` row: a real booking is priced, capacity-claimed
 * and custody-logged atomically by `createBooking`, and its columns are
 * NOT NULL for good reason. A funnel draft is the opposite — partial by
 * definition — so it lives here as an opaque payload owned by the (possibly
 * anonymous) auth uid, and only becomes a `bookings` row at the payment step.
 *
 * One draft per user: starting a new booking replaces the old draft, which is
 * what the funnel means by "resume". Anonymous-user GC deletes these via the
 * FK cascade.
 */
export const bookingDrafts = pgTable(
  "booking_drafts",
  {
    id: primaryId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Same shape as the funnel cookie draft; validated on every read. */
    payload: jsonb("payload")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    /**
     * Inactivity expiry, refreshed on every upsert (7 days for verified
     * accounts, 24 hours for anonymous funnel sessions). Reads treat an
     * expired draft as absent; the cleanup job soft-deletes it later.
     */
    expiresAt: timestamptz("expires_at")
      .notNull()
      .default(sql`now() + interval '7 days'`),
    /**
     * Soft delete — product flows (discard, completion, expiry) never
     * hard-delete a draft. Only user GC removes rows, via the FK cascade.
     * A new upsert for the same user revives the row.
     */
    deletedAt: timestamptz("deleted_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("booking_drafts_user_id_key").on(t.userId)],
);

export type BookingDraft = typeof bookingDrafts.$inferSelect;
export type NewBookingDraft = typeof bookingDrafts.$inferInsert;
