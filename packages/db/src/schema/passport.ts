import { index, pgEnum, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { createdAt, primaryId, timestamptz, updatedAt } from "./columns";
import { bookings } from "./bookings";
import { users } from "./identity";

export const passportVerificationStatusEnum = pgEnum("passport_verification_status", [
  /** Row exists, nothing uploaded — the agent will photograph at the door. */
  "pending",
  /** A photo is in the private bucket, awaiting the agent's confirmation. */
  "customer_uploaded",
  /** The assigned agent confirmed the passport matches the traveler. */
  "agent_confirmed",
  /** Terminal negative — the visit is blocked and ops owns it. */
  "failed",
]);
export type PassportVerificationStatus =
  (typeof passportVerificationStatusEnum.enumValues)[number];

/**
 * Automated validity checking is a SEAM, not a feature. Nothing in this slice
 * performs one; the default checker returns `not_checked` and never blocks.
 */
export const passportValidityCheckStatusEnum = pgEnum("passport_validity_check_status", [
  "not_checked",
  "passed",
  "failed",
]);
export type PassportValidityCheckStatus =
  (typeof passportValidityCheckStatusEnum.enumValues)[number];

/**
 * Passport verification for one booking — manual, human, and deliberately
 * ignorant of what the passport says.
 *
 * WHAT THIS TABLE MUST NEVER HOLD
 *
 * No passport number. No name. No date of birth. No nationality. No MRZ, and
 * nothing extracted from the image by any means. The whole row is a storage
 * path plus a handful of statuses, and that is a HARD RULE rather than a
 * scoping decision: the table has to be worthless to anyone who can read it.
 * A passport number sitting in a column is an identity-theft primitive with
 * an indefinite shelf life; a private-bucket path is a pointer that a signed
 * URL, an active session and a short TTL all stand in front of.
 *
 * If OCR or automated validity checking ever ships, it reads the image
 * through the `PassportValidityChecker` seam and writes back a STATUS —
 * `passed` / `failed` — never the fields it read to get there.
 *
 * One row per booking (`UNIQUE booking_id`): a booking has exactly one
 * traveler whose identity the visit turns on.
 */
export const passportVerifications = pgTable(
  "passport_verifications",
  {
    id: primaryId(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "restrict" }),
    status: passportVerificationStatusEnum("status").notNull().default("pending"),
    /**
     * Path inside the PRIVATE `passport-photos` bucket — never a public URL,
     * and never rendered without a short-TTL signed URL. Null until someone
     * (customer pre-upload, or the agent at the door) captures one.
     */
    photoStoragePath: text("photo_storage_path"),
    uploadedAt: timestamptz("uploaded_at"),
    confirmedAt: timestamptz("confirmed_at"),
    confirmedByAgentId: uuid("confirmed_by_agent_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    validityCheckStatus: passportValidityCheckStatusEnum("validity_check_status")
      .notNull()
      .default("not_checked"),
    /** Which checker produced `validity_check_status`. Null while unchecked. */
    validityCheckProvider: text("validity_check_provider"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("passport_verifications_booking_id_key").on(t.bookingId),
    index("passport_verifications_status_idx").on(t.status),
  ],
);

export type PassportVerification = typeof passportVerifications.$inferSelect;
export type NewPassportVerification = typeof passportVerifications.$inferInsert;
