import { sql } from "drizzle-orm";
import { check, index, integer, pgEnum, pgTable, text, uuid } from "drizzle-orm/pg-core";

import { createdAt, primaryId, timestamptz } from "./columns";
import { users } from "./identity";

export const ticketExtractionStatusEnum = pgEnum("ticket_extraction_status", [
  "pending",
  "extracted",
  "unreadable",
  "failed",
]);
export type TicketExtractionStatus =
  (typeof ticketExtractionStatusEnum.enumValues)[number];

/**
 * One uploaded e-ticket file (Supabase Storage, PRIVATE bucket — the row
 * carries the storage path, never a public URL).
 *
 * Guest-first linkage: pre-auth uploads key to `draft_id` — the funnel
 * cookie draft's uuid, minted client-session-side before any auth exists —
 * and `user_id` attaches later, at the payment gate, once the session is
 * verified. `draft_id` is deliberately NOT a foreign key: the cookie draft
 * has no server row of its own until the flight step persists one, and an
 * upload may precede that.
 *
 * NOTHING here feeds bookings directly: extraction output is a prefill for
 * the editable review form, and only the user-confirmed form values persist
 * (see packages/core/src/extraction/types.ts).
 */
export const ticketUploads = pgTable(
  "ticket_uploads",
  {
    id: primaryId(),
    /** Funnel cookie draft uuid. Not a FK by design (see above). */
    draftId: uuid("draft_id").notNull(),
    /** Attached at the payment gate; null for guest uploads. */
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    /** Path inside the private bucket, e.g. `tickets/<draftId>/<id>.pdf`. */
    storagePath: text("storage_path").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    /** SHA-256 hex of the uploaded bytes. */
    checksum: text("checksum").notNull(),
    extractionStatus: ticketExtractionStatusEnum("extraction_status")
      .notNull()
      .default("pending"),
    extractedAt: timestamptz("extracted_at"),
    createdAt: createdAt(),
  },
  (t) => [
    index("ticket_uploads_draft_id_idx").on(t.draftId),
    index("ticket_uploads_user_id_idx").on(t.userId),
    check("ticket_uploads_size_positive_check", sql`${t.sizeBytes} > 0`),
  ],
);

export type TicketUpload = typeof ticketUploads.$inferSelect;
export type NewTicketUpload = typeof ticketUploads.$inferInsert;
