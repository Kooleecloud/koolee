import { index, pgTable, text, uuid } from "drizzle-orm/pg-core";

import { createdAt, primaryId } from "./columns";

/**
 * Audit log of OTP send attempts, one row per allowed send.
 *
 * Supabase's `updateUser({ phone })` (the anonymous → permanent upgrade) cannot
 * carry a Turnstile token, so this table backs the compensating server-side
 * throttle: max 3 sends per user per rolling 15 minutes, max 5 per destination
 * per rolling 60 minutes across ALL users.
 *
 * `user_id` is the Supabase auth uid but deliberately NOT a foreign key: the
 * destination cap only blocks number-farming if rows survive the deletion of
 * the anonymous users that created them. Rows are pruned after 24h by the
 * daily cleanup job instead.
 */
export const otpSendLog = pgTable(
  "otp_send_log",
  {
    id: primaryId(),
    userId: uuid("user_id").notNull(),
    /**
     * HMAC-SHA256 of the normalized destination (`hashDestination` in
     * @koolee/core). Every lookup is an exact match, so the throttle never
     * needs the plaintext phone/email — and storing it would leave a rolling
     * 24h list of every number that entered the funnel.
     */
    destinationHash: text("destination_hash").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("otp_send_log_user_created_idx").on(t.userId, t.createdAt),
    index("otp_send_log_dest_hash_created_idx").on(t.destinationHash, t.createdAt),
  ],
);

export type OtpSendLogRow = typeof otpSendLog.$inferSelect;
export type NewOtpSendLogRow = typeof otpSendLog.$inferInsert;
