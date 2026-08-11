import { and, eq, gt, isNull, lte } from "drizzle-orm";
import { bookingDrafts, bookings, type BookingDraft, type Database } from "@koolee/db";

import type { CoreConfig } from "../config";
import { cancelBookingWithRefund } from "./payment-lifecycle";

/**
 * Server-side funnel drafts, one per (possibly anonymous) user.
 *
 * The payload mirrors the funnel cookie draft and is treated as opaque here —
 * the web app validates it with its zod schema on read. Nothing in a draft is
 * authoritative: `createBooking` re-validates everything at the payment step.
 *
 * Lifecycle: every upsert refreshes `expiresAt` (an inactivity TTL — the
 * caller picks it: 7 days for verified accounts, 24 hours for anonymous
 * sessions). Reads treat expired or soft-deleted rows as absent. Product
 * flows never hard-delete: discard/completion/expiry set `deletedAt`, and a
 * later upsert for the same user revives the row (one draft per user).
 */

/** 7 days — verified accounts keep a resumable draft across devices. */
export const BOOKING_DRAFT_TTL_VERIFIED_MS = 7 * 24 * 3600_000;
/** 24 hours — anonymous funnel sessions are a short-lived convenience cache. */
export const BOOKING_DRAFT_TTL_ANONYMOUS_MS = 24 * 3600_000;

export interface UpsertBookingDraftInput {
  userId: string;
  payload: Record<string, unknown>;
  /** Inactivity TTL in ms, refreshed on every write. Defaults to 7 days. */
  ttlMs?: number;
  now?: Date;
}

export async function upsertBookingDraft(
  db: Database,
  input: UpsertBookingDraftInput,
): Promise<BookingDraft> {
  const now = input.now ?? new Date();
  const expiresAt = new Date(
    now.getTime() + (input.ttlMs ?? BOOKING_DRAFT_TTL_VERIFIED_MS),
  );

  const [row] = await db
    .insert(bookingDrafts)
    .values({ userId: input.userId, payload: input.payload, expiresAt })
    .onConflictDoUpdate({
      target: bookingDrafts.userId,
      // New activity revives a soft-deleted/expired row — one draft per user.
      set: { payload: input.payload, expiresAt, deletedAt: null, updatedAt: now },
    })
    .returning();

  if (!row) throw new Error("Upsert of booking draft returned no row");
  return row;
}

/** The user's draft, if it is neither soft-deleted nor past its expiry. */
export async function getBookingDraft(
  db: Database,
  userId: string,
  options: { now?: Date } = {},
): Promise<BookingDraft | null> {
  const now = options.now ?? new Date();
  const row = await db.query.bookingDrafts.findFirst({
    where: and(
      eq(bookingDrafts.userId, userId),
      isNull(bookingDrafts.deletedAt),
      gt(bookingDrafts.expiresAt, now),
    ),
  });
  return row ?? null;
}

/** Soft-deletes the user's draft row, if any. Idempotent. */
export async function softDeleteBookingDraft(
  db: Database,
  userId: string,
  now: Date = new Date(),
): Promise<void> {
  await db
    .update(bookingDrafts)
    .set({ deletedAt: now })
    .where(and(eq(bookingDrafts.userId, userId), isNull(bookingDrafts.deletedAt)));
}

export interface DiscardBookingDraftInput {
  userId: string;
  /**
   * The cookie-held draft booking id, if the caller has one — covers the case
   * where the mirror row is stale or missing (its sync is best-effort).
   */
  bookingId?: string | null;
  /** Recorded in the custody trail of any cancelled draft booking. */
  reason: string;
  now?: Date;
}

export interface DiscardBookingDraftResult {
  /** Draft bookings whose payment authorization was voided. */
  cancelledBookingIds: string[];
}

/**
 * Discards a user's funnel draft: soft-deletes the row AND unwinds any draft
 * booking the payment step created for it — a discarded draft must not keep
 * holding a confirmable payment intent.
 *
 * Only bookings that are (a) owned by this user and (b) still in `draft`
 * status are cancelled — the payload is mirrored from a client-held cookie,
 * so the booking id inside it is never trusted on its own.
 */
export async function discardBookingDraft(
  config: CoreConfig,
  input: DiscardBookingDraftInput,
): Promise<DiscardBookingDraftResult> {
  const { db } = config;
  const now = input.now ?? new Date();

  // Read the raw row (even expired/deleted) — its payload may reference a
  // draft booking with a still-confirmable payment intent.
  const row = await db.query.bookingDrafts.findFirst({
    where: eq(bookingDrafts.userId, input.userId),
  });

  const payloadBookingId =
    typeof row?.payload["bookingId"] === "string"
      ? (row.payload["bookingId"] as string)
      : null;
  const candidateIds = [
    ...new Set([payloadBookingId, input.bookingId ?? null].filter(
      (id): id is string => Boolean(id),
    )),
  ];

  const cancelledBookingIds: string[] = [];
  for (const bookingId of candidateIds) {
    const booking = await db.query.bookings.findFirst({
      where: eq(bookings.id, bookingId),
    });
    if (!booking || booking.userId !== input.userId || booking.status !== "draft") {
      continue;
    }
    const result = await cancelBookingWithRefund(config, {
      bookingId,
      actor: { userId: input.userId, role: "customer" },
      reason: input.reason,
    });
    if (result.ok) {
      cancelledBookingIds.push(bookingId);
    } else {
      // Someone moved the booking concurrently — leave it visible to ops.
      console.warn(
        `[booking-drafts] draft booking ${bookingId} could not be cancelled: ${result.error}`,
      );
    }
  }

  await softDeleteBookingDraft(db, input.userId, now);
  return { cancelledBookingIds };
}

export interface ExpireBookingDraftsResult {
  expiredDrafts: number;
  cancelledBookings: number;
}

/**
 * Sweeps drafts past their inactivity expiry: unwinds any draft booking they
 * reference (same ownership + status gates as a manual discard) and marks
 * them soft-deleted. Correctness never depends on this running — reads
 * already treat expired rows as absent — it exists to void stale payment
 * intents.
 */
export async function expireBookingDrafts(
  config: CoreConfig,
  options: { now?: Date; log?: (message: string) => void } = {},
): Promise<ExpireBookingDraftsResult> {
  const now = options.now ?? new Date();
  const log =
    options.log ?? ((m: string) => console.log(`[booking-drafts] ${m}`));

  const expired = await config.db
    .select({ userId: bookingDrafts.userId })
    .from(bookingDrafts)
    .where(and(isNull(bookingDrafts.deletedAt), lte(bookingDrafts.expiresAt, now)));

  let cancelledBookings = 0;
  for (const { userId } of expired) {
    const { cancelledBookingIds } = await discardBookingDraft(config, {
      userId,
      reason: "booking_draft_expired",
      now,
    });
    cancelledBookings += cancelledBookingIds.length;
  }

  if (expired.length > 0) {
    log(`expired=${expired.length} cancelledBookings=${cancelledBookings}`);
  }
  return { expiredDrafts: expired.length, cancelledBookings };
}

/**
 * Moves a draft from an orphaned anonymous user onto an existing account
 * (phone-conflict flow). The target's own stale draft, if any, is replaced —
 * the in-flight funnel wins. The source row is soft-deleted, not removed.
 */
export async function reparentBookingDraft(
  db: Database,
  input: { fromUserId: string; toUserId: string; ttlMs?: number },
): Promise<BookingDraft | null> {
  const source = await getBookingDraft(db, input.fromUserId);
  if (!source) return null;

  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + (input.ttlMs ?? BOOKING_DRAFT_TTL_VERIFIED_MS),
  );

  return db.transaction(async (tx) => {
    await tx
      .update(bookingDrafts)
      .set({ deletedAt: now })
      .where(eq(bookingDrafts.userId, input.fromUserId));
    const [row] = await tx
      .insert(bookingDrafts)
      .values({ userId: input.toUserId, payload: source.payload, expiresAt })
      .onConflictDoUpdate({
        target: bookingDrafts.userId,
        set: { payload: source.payload, expiresAt, deletedAt: null, updatedAt: now },
      })
      .returning();
    return row ?? null;
  });
}
