import { and, eq, isNull } from "drizzle-orm";
import {
  ticketUploads,
  type Database,
  type TicketExtractionStatus,
  type TicketUpload,
} from "@koolee/db";

/**
 * `ticket_uploads` rows — bookkeeping for files in the PRIVATE ticket bucket.
 *
 * Guest-first: rows are created keyed to the funnel cookie draft's uuid, and
 * `attachTicketUploadsToUser` claims them for the verified user at the
 * payment gate. Extraction results themselves are never stored here or on
 * any booking — they exist only as the review-form prefill (see
 * packages/core/src/extraction/types.ts for the hard rule).
 */

export interface CreateTicketUploadInput {
  draftId: string;
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
  /** SHA-256 hex of the uploaded bytes. */
  checksum: string;
}

export async function createTicketUpload(
  db: Database,
  input: CreateTicketUploadInput,
): Promise<TicketUpload> {
  const [row] = await db
    .insert(ticketUploads)
    .values({
      draftId: input.draftId,
      storagePath: input.storagePath,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      checksum: input.checksum,
      extractionStatus: "pending",
    })
    .returning();
  if (!row) throw new Error("Insert of ticket upload returned no row");
  return row;
}

export async function setTicketUploadStatus(
  db: Database,
  input: { id: string; status: TicketExtractionStatus },
): Promise<void> {
  await db
    .update(ticketUploads)
    .set({ extractionStatus: input.status, extractedAt: new Date() })
    .where(eq(ticketUploads.id, input.id));
}

/**
 * Claims a draft's guest uploads for the now-verified user — called at the
 * payment gate, consistent with the funnel's guest-first design. Idempotent;
 * never re-assigns an upload that already belongs to someone.
 */
export async function attachTicketUploadsToUser(
  db: Database,
  input: { draftId: string; userId: string },
): Promise<number> {
  const rows = await db
    .update(ticketUploads)
    .set({ userId: input.userId })
    .where(and(eq(ticketUploads.draftId, input.draftId), isNull(ticketUploads.userId)))
    .returning({ id: ticketUploads.id });
  return rows.length;
}

export async function listTicketUploadsForDraft(
  db: Database,
  draftId: string,
): Promise<TicketUpload[]> {
  return db.select().from(ticketUploads).where(eq(ticketUploads.draftId, draftId));
}
