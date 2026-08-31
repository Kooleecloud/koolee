import { and, asc, desc, eq, lte, or } from "drizzle-orm";
import {
  airlineCutoffs,
  airports,
  bags,
  bookings,
  custodyEvents,
  payments,
  pickupTasks,
  users,
  verificationTasks,
  type Bag,
  type Booking,
  type BookingStatus,
  type CustodyEvent,
  type Database,
  type Payment,
  type TaskStatus,
} from "@koolee/db";

import {
  transition,
  type BookingEvent,
  type TransitionActor,
} from "../booking/state-machine";
import { computeBagDropCutoffAt } from "../slots/cutoff";
import { bookingPickupAddress, type PickupAddress } from "./pickup-address";
import type { CoreConfig } from "../config";
import { NotAuthorizedError, NotFoundError, type Result } from "../errors";
import { IllegalTransitionError } from "../booking/state-machine";
import { canActOnBooking, type Session } from "../auth/types";
import { emitBagsSealed, emitExceptionRaised } from "../events/booking-events";
import { FALLBACK_DISPLAY_TZ } from "./display-tz";

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

/**
 * Session-scoped booking list — the seam customer-facing pages go through.
 *
 * A customer session is always pinned to its own `userId`, regardless of what
 * the caller passes in `filter` (passing someone else's id throws rather than
 * silently narrowing). Staff sessions pass filters through unchanged. This is
 * the list-shaped counterpart of `getBookingForSession`: authorization in
 * core, not RLS.
 */
export async function listBookingsForSession(
  db: Database,
  session: Session,
  filter: ListBookingsFilter = {},
): Promise<Booking[]> {
  if (session.kind === "customer") {
    if (filter.userId !== undefined && filter.userId !== session.userId) {
      throw new NotAuthorizedError("customer session may only list its own bookings");
    }
    return listBookings(db, { ...filter, userId: session.userId });
  }
  return listBookings(db, filter);
}

export async function getBooking(
  db: Database,
  bookingId: string,
): Promise<Booking | null> {
  const row = await db.query.bookings.findFirst({ where: eq(bookings.id, bookingId) });
  return row ?? null;
}

/**
 * Whether an agent holds a verification or pickup task for this booking —
 * the database-backed half of agent authorization (see `canActOnBooking`).
 */
export async function agentHasTaskForBooking(
  db: Database,
  agentUserId: string,
  bookingId: string,
): Promise<boolean> {
  const [verification, pickup] = await Promise.all([
    db.query.verificationTasks.findFirst({
      where: and(
        eq(verificationTasks.bookingId, bookingId),
        eq(verificationTasks.assigneeUserId, agentUserId),
      ),
      columns: { id: true },
    }),
    db.query.pickupTasks.findFirst({
      where: and(
        eq(pickupTasks.bookingId, bookingId),
        eq(pickupTasks.assigneeUserId, agentUserId),
      ),
      columns: { id: true },
    }),
  ]);
  return Boolean(verification ?? pickup);
}

/**
 * The session-authorization check every booking read/transition goes
 * through. Async because agents are task-scoped, which needs a lookup;
 * admin and customer resolve synchronously via `canActOnBooking`.
 */
export async function sessionCanActOnBooking(
  db: Database,
  session: Session,
  booking: Booking,
): Promise<boolean> {
  if (session.kind === "agent") {
    return agentHasTaskForBooking(db, session.userId, booking.id);
  }
  return canActOnBooking(session, booking);
}

/** Booking IDs an agent is assigned to (either task kind), for list scoping. */
export async function listAgentBookingIds(
  db: Database,
  agentUserId: string,
): Promise<string[]> {
  const rows = await db
    .selectDistinct({ id: bookings.id })
    .from(bookings)
    .leftJoin(verificationTasks, eq(verificationTasks.bookingId, bookings.id))
    .leftJoin(pickupTasks, eq(pickupTasks.bookingId, bookings.id))
    .where(
      or(
        eq(verificationTasks.assigneeUserId, agentUserId),
        eq(pickupTasks.assigneeUserId, agentUserId),
      ),
    );
  return rows.map((r) => r.id);
}

/** Booking plus its custody timeline, authorized against the session. */
export async function getBookingForSession(
  db: Database,
  session: Session,
  bookingId: string,
): Promise<{ booking: Booking; timeline: CustodyEvent[] }> {
  const booking = await getBooking(db, bookingId);
  if (!booking) throw new NotFoundError("Booking", bookingId);

  if (!(await sessionCanActOnBooking(db, session, booking))) {
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

/**
 * The agent coming to the door, named the way a customer should see them.
 *
 * Given name only, on purpose: staff email is an internal identifier and the
 * customer has no use for it. Ops reads the full identity through
 * `getBookingAssignment` instead.
 */
export interface AssignedAgent {
  /**
   * The staff user id. Carried so a caller can ask
   * `avatarPathsForViewer` for their face by IDENTITY rather than being
   * handed a storage path — see `services/avatar-visibility.ts`.
   */
  userId: string;
  givenName: string | null;
  taskStatus: TaskStatus;
  /**
   * Key in the PRIVATE `avatars` bucket, or null. The customer is not staff,
   * so their session cannot sign this under 0027's read policy — the web app
   * signs it service-role, which is safe precisely because it only ever
   * reaches here for an agent this booking is assigned to.
   */
  avatarStoragePath: string | null;
}

export interface BookingDetail {
  booking: Booking;
  /** The designed customer-facing render of the append-only event log. */
  timeline: CustodyEvent[];
  bags: Bag[];
  payments: Payment[];
  /** Where the agent is coming. Null only if the address row went missing. */
  /**
   * The doorstep as it was when the booking was made — read off the booking,
   * never joined. See `bookingPickupAddress`: the saved address the customer
   * booked from may since have been edited or deleted, and neither may change
   * what this page says happened.
   */
  pickupAddress: PickupAddress;
  /** Null until dispatch assigns the visit. */
  assignedAgent: AssignedAgent | null;
  /** Airport-local IANA zone — the only zone a pickup window may be read in. */
  tz: string;
  /**
   * The bag-drop deadline for this flight, or null when no cutoff is on
   * record (we refuse to guess one — see `resolveCutoffMinutes`).
   */
  bagDropCutoffAt: Date | null;
}

/**
 * Legacy rows only. Bookings created since `display_tz` landed carry their own
 * zone; this covers the pre-column rows that the migration backfilled but that
 * a stale read could still surface as empty.
 */
const FALLBACK_TZ = FALLBACK_DISPLAY_TZ;

/**
 * Full booking detail — timeline, bags (with seal ids when present), payment
 * history, the pickup address, the assigned agent, and the bag-drop deadline —
 * authorized against the session like every other read. Everything is scoped
 * by the booking id, so one booking's page can never leak another booking's
 * events.
 */
export async function getBookingDetailForSession(
  db: Database,
  session: Session,
  bookingId: string,
): Promise<BookingDetail> {
  const { booking, timeline } = await getBookingForSession(db, session, bookingId);

  const [bagRows, paymentRows, agentRow, airportRow, cutoffRows] = await Promise.all([
    db
      .select()
      .from(bags)
      .where(eq(bags.bookingId, bookingId))
      // By ordinal, never createdAt: a booking's bags share a timestamp, so
      // that ordering was a non-deterministic tie (see bags.ordinal).
      .orderBy(asc(bags.ordinal)),
    db
      .select()
      .from(payments)
      .where(eq(payments.bookingId, bookingId))
      .orderBy(asc(payments.createdAt)),
    db
      .select({
        userId: users.id,
        fullName: users.fullName,
        avatarStoragePath: users.avatarStoragePath,
        taskStatus: verificationTasks.status,
      })
      .from(verificationTasks)
      .innerJoin(users, eq(users.id, verificationTasks.assigneeUserId))
      .where(eq(verificationTasks.bookingId, bookingId))
      .limit(1),
    db.query.airports.findFirst({
      where: eq(airports.code, booking.departureAirport),
      columns: { tz: true },
    }),
    db
      .select({ minutes: airlineCutoffs.cutoffMinutesBeforeDeparture })
      .from(airlineCutoffs)
      .where(
        and(
          eq(airlineCutoffs.airlineIata, booking.airlineIata.toUpperCase()),
          eq(airlineCutoffs.airportCode, booking.departureAirport),
          lte(airlineCutoffs.effectiveFrom, new Date()),
        ),
      ),
  ]);

  const assignee = agentRow[0];

  // Bookings do not store the domestic/international scope, so a flight can
  // match cutoff rows for both. Take the STRICTEST of them: a deadline that
  // runs early costs the customer nothing, one that runs late puts bags on
  // the wrong side of the counter.
  const cutoffMinutes = cutoffRows.reduce<number | null>(
    (strictest, row) =>
      strictest === null ? row.minutes : Math.max(strictest, row.minutes),
    null,
  );

  return {
    booking,
    timeline,
    bags: bagRows,
    payments: paymentRows,
    pickupAddress: bookingPickupAddress(booking),
    assignedAgent: assignee
      ? {
          userId: assignee.userId,
          givenName: assignee.fullName?.trim().split(/\s+/)[0] ?? null,
          taskStatus: assignee.taskStatus,
          avatarStoragePath: assignee.avatarStoragePath,
        }
      : null,
    // The booking's own snapshot first — that column exists precisely so a
    // render needs no join. The airport lookup stays as the fallback for rows
    // written before it, and for the airport-not-found case.
    tz: booking.displayTz || (airportRow?.tz ?? FALLBACK_TZ),
    bagDropCutoffAt:
      cutoffMinutes === null
        ? null
        : computeBagDropCutoffAt(booking.departureAt, cutoffMinutes),
  };
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
  /**
   * Human-readable reason carried into the `booking/exception_raised` ops
   * email. Only read when the transition lands on `exception`. Omitted →
   * derived from `metadata.reason` (+ `note`/`detail`), which is what the
   * existing call sites already write.
   */
  exceptionReason?: string;
}

/**
 * The sentence ops reads in the alert email.
 *
 * Reads `metadata` rather than demanding a new argument at every call site:
 * the agent-visit and payment-capture paths already put a `reason` there,
 * and a path that puts nothing still produces something better than an empty
 * body.
 */
function exceptionReasonFrom(input: ApplyTransitionInput): string {
  const explicit = input.exceptionReason?.trim();
  if (explicit) return explicit;

  const metadata = input.metadata ?? {};
  const text = (key: string): string | null => {
    const value = metadata[key];
    return typeof value === "string" && value.trim() ? value.trim() : null;
  };

  const reason = text("reason");
  const detail = text("note") ?? text("detail");

  // The admin console's manual override writes `note` and no `reason`
  // (bookings/actions.ts). Falling through to the generic sentence there
  // would throw away the one thing the operator actually typed.
  if (!reason) {
    return detail ?? `Booking moved to exception by ${input.event}.`;
  }
  return detail ? `${reason} — ${detail}` : reason;
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

  const committed = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(bookings)
      .set({ status: to })
      .where(and(eq(bookings.id, input.bookingId), eq(bookings.status, from)))
      .returning();

    if (!row) return null;

    // The custody event's id is the dedupe key for the emitted domain event:
    // one row per raise, written in the same transaction as the status
    // change, so the loser of a concurrent transition emits nothing.
    const [event] = await tx
      .insert(custodyEvents)
      .values(custodyEvent)
      .returning({ id: custodyEvents.id });

    return { row, custodyEventId: event?.id ?? null };
  });

  if (!committed) {
    // Someone else moved it between our read and our write.
    const current = await getBooking(db, input.bookingId);
    return {
      ok: false,
      error: new IllegalTransitionError(current?.status ?? from, input.event),
    };
  }

  /*
   * AFTER the commit, and only when THIS call performed the move.
   *
   * Both emits below live here for the same reason: the state a booking
   * ARRIVES AT is the fact worth telling somebody about, and the arrival is
   * observable in exactly one place. `raise_exception` is legal from seven
   * states and reached from three services; `verified_sealed` has one caller
   * today (`completeVerificationVisit`) and emitting at that caller instead
   * would leave the second one silent. Never throws — see
   * events/booking-events.ts.
   */
  if (to === "verified_sealed") {
    await emitBagsSealed(config.emitter, {
      bookingId: input.bookingId,
      dedupeKey: committed.custodyEventId ?? `${input.event}:${Date.now()}`,
    });
  }

  if (to === "exception") {
    await emitExceptionRaised(config.emitter, {
      bookingId: input.bookingId,
      reason: exceptionReasonFrom(input),
      dedupeKey: committed.custodyEventId ?? `${input.event}:${Date.now()}`,
      // Null actor is a system-raised exception (a job, a webhook) — omit
      // rather than send null; the ops email renders "system".
      ...(typeof input.actor?.userId === "string"
        ? { raisedByUserId: input.actor.userId }
        : {}),
    });
  }

  return { ok: true, value: committed.row };
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
  if (!(await sessionCanActOnBooking(config.db, session, booking))) {
    throw new NotAuthorizedError(
      `${session.kind} session may not transition booking ${input.bookingId}.`,
    );
  }

  return applyTransition(config, {
    ...input,
    actor: { userId: session.userId, role: session.role },
  });
}
