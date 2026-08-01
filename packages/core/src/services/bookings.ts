import { and, asc, desc, eq } from "drizzle-orm";
import {
  bookings,
  custodyEvents,
  type Booking,
  type BookingStatus,
  type CustodyEvent,
  type Database,
} from "@koolee/db";

import {
  transition,
  type BookingEvent,
  type TransitionActor,
} from "../booking/state-machine";
import type { CoreConfig } from "../config";
import { NotAuthorizedError, NotFoundError, type Result } from "../errors";
import { IllegalTransitionError } from "../booking/state-machine";
import { canActOnBooking, type Session } from "../auth/types";

/**
 * Read and transition services for bookings.
 *
 * Apps call these; they never touch Drizzle themselves. Authorization is
 * enforced here — RLS does not apply to these queries, which run on a
 * service-role connection (see packages/db/README.md).
 */

export interface ListBookingsFilter {
  status?: BookingStatus;
  userId?: string;
  limit?: number;
}

export async function listBookings(
  db: Database,
  filter: ListBookingsFilter = {},
): Promise<Booking[]> {
  const conditions = [
    filter.status ? eq(bookings.status, filter.status) : undefined,
    filter.userId ? eq(bookings.userId, filter.userId) : undefined,
  ].filter((c): c is NonNullable<typeof c> => c !== undefined);

  return db
    .select()
    .from(bookings)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(bookings.createdAt))
    .limit(filter.limit ?? 100);
}

export async function getBooking(
  db: Database,
  bookingId: string,
): Promise<Booking | null> {
  const row = await db.query.bookings.findFirst({ where: eq(bookings.id, bookingId) });
  return row ?? null;
}

/** Booking plus its custody timeline, authorized against the session. */
export async function getBookingForSession(
  db: Database,
  session: Session,
  bookingId: string,
): Promise<{ booking: Booking; timeline: CustodyEvent[] }> {
  const booking = await getBooking(db, bookingId);
  if (!booking) throw new NotFoundError("Booking", bookingId);

  if (!canActOnBooking(session, booking)) {
    // Deliberately a 404-shaped error, not a 403: telling an unauthorized
    // caller that the booking exists is itself a disclosure.
    throw new NotFoundError("Booking", bookingId);
  }

  const timeline = await db
    .select()
    .from(custodyEvents)
    .where(eq(custodyEvents.bookingId, bookingId))
    .orderBy(asc(custodyEvents.createdAt));

  return { booking, timeline };
}

export async function getTimeline(
  db: Database,
  bookingId: string,
): Promise<CustodyEvent[]> {
  return db
    .select()
    .from(custodyEvents)
    .where(eq(custodyEvents.bookingId, bookingId))
    .orderBy(asc(custodyEvents.createdAt));
}

/* ------------------------------------------------------------------ */
/* Transitions                                                         */
/* ------------------------------------------------------------------ */

export interface ApplyTransitionInput {
  bookingId: string;
  event: BookingEvent;
  actor?: TransitionActor;
  bagId?: string | null;
  lat?: number | null;
  lng?: number | null;
  photoUrl?: string | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * Applies a state transition and writes its custody event in ONE transaction.
 *
 * The status update is guarded on the status the state machine was given
 * (`WHERE status = from`), so a concurrent transition loses rather than
 * silently overwriting. An illegal move is returned as a typed error, not
 * thrown — the admin console renders it, and it is an expected outcome rather
 * than a fault.
 */
export async function applyTransition(
  config: CoreConfig,
  input: ApplyTransitionInput,
): Promise<Result<Booking, IllegalTransitionError | NotFoundError>> {
  const { db } = config;

  const booking = await getBooking(db, input.bookingId);
  if (!booking) {
    return { ok: false, error: new NotFoundError("Booking", input.bookingId) };
  }

  const attempted = transition(booking, {
    event: input.event,
    ...(input.actor === undefined ? {} : { actor: input.actor }),
    ...(input.bagId === undefined ? {} : { bagId: input.bagId }),
    ...(input.lat === undefined ? {} : { lat: input.lat }),
    ...(input.lng === undefined ? {} : { lng: input.lng }),
    ...(input.photoUrl === undefined ? {} : { photoUrl: input.photoUrl }),
    ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
  });

  if (!attempted.ok) return attempted;

  const { from, to, custodyEvent } = attempted.value;

  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(bookings)
      .set({ status: to })
      .where(and(eq(bookings.id, input.bookingId), eq(bookings.status, from)))
      .returning();

    if (!row) return null;

    await tx.insert(custodyEvents).values(custodyEvent);
    return row;
  });

  if (!updated) {
    // Someone else moved it between our read and our write.
    const current = await getBooking(db, input.bookingId);
    return {
      ok: false,
      error: new IllegalTransitionError(current?.status ?? from, input.event),
    };
  }

  return { ok: true, value: updated };
}

/** Transition guarded by a session's permissions. */
export async function applyTransitionForSession(
  config: CoreConfig,
  session: Session,
  input: Omit<ApplyTransitionInput, "actor">,
): Promise<Result<Booking, IllegalTransitionError | NotFoundError>> {
  const booking = await getBooking(config.db, input.bookingId);
  if (!booking) {
    return { ok: false, error: new NotFoundError("Booking", input.bookingId) };
  }
  if (!canActOnBooking(session, booking)) {
    throw new NotAuthorizedError(
      `${session.kind} session may not transition booking ${input.bookingId}.`,
    );
  }

  return applyTransition(config, {
    ...input,
    actor: { userId: session.userId, role: session.role },
  });
}
