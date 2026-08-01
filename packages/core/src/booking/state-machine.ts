import type { BookingStatus, UserRole } from "@koolee/db";

import { CoreError, err, ok, type Result } from "../errors";

/**
 * Booking lifecycle.
 *
 * The transition table below is the single authority on what may follow what.
 * Postgres constrains the *set* of statuses; it says nothing about ordering.
 * Nothing outside this module should assign `bookings.status` directly.
 */

export type BookingEvent =
  /** Payment authorized (not captured — capture happens at pickup). */
  | "authorize_payment"
  /** Dispatch has assigned a check-in agent. */
  | "assign_agent"
  /** ID verified, bags weighed, sealed, photographed. */
  | "complete_verification"
  /** Sealed and staged, waiting for the driver. */
  | "mark_awaiting_pickup"
  /** Driver has the bags. */
  | "start_transit"
  /** Bags handed over at the airline's bag drop. */
  | "deliver_to_bagdrop"
  /** Job closed out. */
  | "complete"
  /** Something went wrong; ops takes over. */
  | "raise_exception"
  /** Ops resolved an exception and the bags are moving again. */
  | "resume_transit"
  /** Ops closed out an exception as delivered. */
  | "force_complete"
  /** Cancelled before the bags left the customer. */
  | "cancel";

/**
 * The transition table.
 *
 * `satisfies` (rather than an annotation) keeps the literal types, so
 * `TRANSITIONS.paid` is known to hold exactly the events paid accepts.
 *
 * Two rules worth stating out loud:
 *  - `cancel` is unavailable from `in_transit` onward. Once a driver has the
 *    bags, "cancel" is not a thing that can happen — that situation is an
 *    exception, and it needs a human.
 *  - `completed` and `cancelled` are terminal. Reopening is a new booking.
 */
export const TRANSITIONS = {
  draft: {
    authorize_payment: "paid",
    cancel: "cancelled",
    raise_exception: "exception",
  },
  paid: {
    assign_agent: "agent_assigned",
    cancel: "cancelled",
    raise_exception: "exception",
  },
  agent_assigned: {
    complete_verification: "verified_sealed",
    cancel: "cancelled",
    raise_exception: "exception",
  },
  verified_sealed: {
    mark_awaiting_pickup: "awaiting_pickup",
    cancel: "cancelled",
    raise_exception: "exception",
  },
  awaiting_pickup: {
    start_transit: "in_transit",
    cancel: "cancelled",
    raise_exception: "exception",
  },
  in_transit: {
    deliver_to_bagdrop: "delivered_to_bagdrop",
    raise_exception: "exception",
  },
  delivered_to_bagdrop: {
    complete: "completed",
    raise_exception: "exception",
  },
  completed: {},
  exception: {
    resume_transit: "in_transit",
    force_complete: "completed",
    cancel: "cancelled",
  },
  cancelled: {},
} as const satisfies Record<BookingStatus, Partial<Record<BookingEvent, BookingStatus>>>;

export type TransitionTable = typeof TRANSITIONS;

/** Statuses from which no event is accepted. */
export const TERMINAL_STATUSES = [
  "completed",
  "cancelled",
] as const satisfies readonly BookingStatus[];

export function isTerminal(status: BookingStatus): boolean {
  return (TERMINAL_STATUSES as readonly BookingStatus[]).includes(status);
}

/** Events legal from `status`, in declaration order. */
export function availableEvents(status: BookingStatus): BookingEvent[] {
  return Object.keys(TRANSITIONS[status]) as BookingEvent[];
}

export function canTransition(status: BookingStatus, event: BookingEvent): boolean {
  return event in TRANSITIONS[status];
}

/** Resulting status, or `null` if the move is illegal. */
export function nextStatus(
  status: BookingStatus,
  event: BookingEvent,
): BookingStatus | null {
  const table = TRANSITIONS[status] as Partial<Record<BookingEvent, BookingStatus>>;
  return table[event] ?? null;
}

export class IllegalTransitionError extends CoreError {
  readonly code = "ILLEGAL_TRANSITION" as const;
  readonly from: BookingStatus;
  readonly event: BookingEvent;
  readonly allowed: BookingEvent[];

  constructor(from: BookingStatus, event: BookingEvent) {
    const allowed = availableEvents(from);
    super(
      allowed.length === 0
        ? `Booking is ${from}, which is terminal — "${event}" is not possible.`
        : `Cannot "${event}" a booking that is ${from}. Allowed from here: ${allowed.join(", ")}.`,
    );
    this.from = from;
    this.event = event;
    this.allowed = allowed;
  }
}

/* ------------------------------------------------------------------ */
/* Custody events                                                      */
/* ------------------------------------------------------------------ */

/**
 * The custody row a successful transition produces.
 *
 * The caller MUST persist this in the same database transaction as the status
 * change. A status that moved without a custody event is an unexplained gap in
 * the chain of custody, which is exactly what this table exists to prevent.
 */
export interface CustodyEventDraft {
  bookingId: string;
  bagId?: string | null;
  actorUserId?: string | null;
  actorRole?: UserRole | null;
  eventType: string;
  lat?: number | null;
  lng?: number | null;
  photoUrl?: string | null;
  metadata?: Record<string, unknown> | null;
}

/** Stable `custody_events.event_type` value per event. */
export const EVENT_TYPES = {
  authorize_payment: "booking.payment_authorized",
  assign_agent: "booking.agent_assigned",
  complete_verification: "booking.verified_sealed",
  mark_awaiting_pickup: "booking.awaiting_pickup",
  start_transit: "booking.in_transit",
  deliver_to_bagdrop: "booking.delivered_to_bagdrop",
  complete: "booking.completed",
  raise_exception: "booking.exception_raised",
  resume_transit: "booking.exception_resolved_resumed",
  force_complete: "booking.exception_resolved_completed",
  cancel: "booking.cancelled",
} as const satisfies Record<BookingEvent, string>;

/* ------------------------------------------------------------------ */
/* transition()                                                        */
/* ------------------------------------------------------------------ */

/** The subset of a booking the state machine reads. */
export interface TransitionableBooking {
  id: string;
  status: BookingStatus;
}

export interface TransitionActor {
  userId: string | null;
  role: UserRole | null;
}

export interface TransitionInput {
  event: BookingEvent;
  /** Omit for system-driven transitions (jobs, webhooks). */
  actor?: TransitionActor;
  bagId?: string | null;
  lat?: number | null;
  lng?: number | null;
  photoUrl?: string | null;
  /** Merged into the custody event's `metadata` jsonb. */
  metadata?: Record<string, unknown> | null;
}

export interface TransitionSuccess {
  from: BookingStatus;
  to: BookingStatus;
  event: BookingEvent;
  /** Persist this in the SAME transaction as the status update. */
  custodyEvent: CustodyEventDraft;
}

export type TransitionResult = Result<TransitionSuccess, IllegalTransitionError>;

/**
 * Applies `input.event` to `booking`.
 *
 * Pure: it reads nothing and writes nothing. The caller performs the status
 * update and the custody insert together, transactionally.
 */
export function transition(
  booking: TransitionableBooking,
  input: TransitionInput,
): TransitionResult {
  const from = booking.status;
  const to = nextStatus(from, input.event);

  if (to === null) {
    return err(new IllegalTransitionError(from, input.event));
  }

  const custodyEvent: CustodyEventDraft = {
    bookingId: booking.id,
    bagId: input.bagId ?? null,
    actorUserId: input.actor?.userId ?? null,
    actorRole: input.actor?.role ?? null,
    eventType: EVENT_TYPES[input.event],
    lat: input.lat ?? null,
    lng: input.lng ?? null,
    photoUrl: input.photoUrl ?? null,
    metadata: { from, to, event: input.event, ...(input.metadata ?? {}) },
  };

  return ok({ from, to, event: input.event, custodyEvent });
}

/**
 * Throwing variant, for call sites where an illegal transition is a bug rather
 * than a user-facing outcome.
 */
export function transitionOrThrow(
  booking: TransitionableBooking,
  input: TransitionInput,
): TransitionSuccess {
  const result = transition(booking, input);
  if (!result.ok) throw result.error;
  return result.value;
}
