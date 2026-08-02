import { eq } from "drizzle-orm";
import { bookingDrafts, type BookingDraft, type Database } from "@koolee/db";

/**
 * Server-side funnel drafts, one per (possibly anonymous) user.
 *
 * The payload mirrors the funnel cookie draft and is treated as opaque here —
 * the web app validates it with its zod schema on read. Nothing in a draft is
 * authoritative: `createBooking` re-validates everything at the payment step.
 */

export interface UpsertBookingDraftInput {
  userId: string;
  payload: Record<string, unknown>;
}

export async function upsertBookingDraft(
  db: Database,
  input: UpsertBookingDraftInput,
): Promise<BookingDraft> {
  const [row] = await db
    .insert(bookingDrafts)
    .values({ userId: input.userId, payload: input.payload })
    .onConflictDoUpdate({
      target: bookingDrafts.userId,
      set: { payload: input.payload, updatedAt: new Date() },
    })
    .returning();

  if (!row) throw new Error("Upsert of booking draft returned no row");
  return row;
}

export async function getBookingDraft(
  db: Database,
  userId: string,
): Promise<BookingDraft | null> {
  const row = await db.query.bookingDrafts.findFirst({
    where: eq(bookingDrafts.userId, userId),
  });
  return row ?? null;
}

export async function deleteBookingDraft(db: Database, userId: string): Promise<void> {
  await db.delete(bookingDrafts).where(eq(bookingDrafts.userId, userId));
}

/**
 * Moves a draft from an orphaned anonymous user onto an existing account
 * (phone-conflict flow). The target's own stale draft, if any, is replaced —
 * the in-flight funnel wins.
 */
export async function reparentBookingDraft(
  db: Database,
  input: { fromUserId: string; toUserId: string },
): Promise<BookingDraft | null> {
  const source = await getBookingDraft(db, input.fromUserId);
  if (!source) return null;

  return db.transaction(async (tx) => {
    await tx.delete(bookingDrafts).where(eq(bookingDrafts.userId, input.fromUserId));
    const [row] = await tx
      .insert(bookingDrafts)
      .values({ userId: input.toUserId, payload: source.payload })
      .onConflictDoUpdate({
        target: bookingDrafts.userId,
        set: { payload: source.payload, updatedAt: new Date() },
      })
      .returning();
    return row ?? null;
  });
}
