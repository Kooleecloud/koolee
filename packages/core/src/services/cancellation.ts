import { and, desc, eq } from "drizzle-orm";
import {
  type Booking,
  type BookingStatus,
  type CustodyEvent,
  custodyEvents,
  type Database,
  payments,
  type UserRole,
} from "@koolee/db";

import type { CoreConfig } from "../config";
import { canActOnBooking, type CustomerSession } from "../auth/types";
import { NotFoundError } from "../errors";
import { EVENT_TYPES } from "../booking/state-machine";
import { getBooking } from "./bookings";
import { cancelBookingWithRefund } from "./payment-lifecycle";

/**
 * Cancelling, from the customer's side — and reading back who cancelled.
 *
 * ADMIN CANCELLATION ALREADY EXISTED (`cancelBookingWithRefund`, reached from
 * the console's exception resolution). The customer had no way to call it off
 * at all: the only route was to email support, which meant a person who no
 * longer needed a pickup either paid for it or hoped somebody read their mail
 * in time. This module is the policy around that same call, not a second
 * implementation of it — the transition, the slot release, the custody event
 * and the money all stay where they are.
 */

/**
 * The statuses a CUSTOMER may cancel from.
 *
 * Deliberately narrower than the state machine's, which accepts `cancel` from
 * every pre-transit status including `verified_sealed` and `awaiting_pickup`.
 * Those two mean the visit has HAPPENED — an agent stood at the door, checked
 * a passport against a face, weighed and photographed bags and put numbered
 * seals on them. Undoing that is a conversation, not a button, and the seals
 * have to be accounted for by somebody. Ops can still cancel from there; the
 * customer is pointed at support.
 *
 * `draft` is absent because an unpaid draft is not a trip yet and has no page
 * to cancel from. `exception` is absent because ops owns it outright.
 */
export const CUSTOMER_CANCELLABLE_STATUSES = [
  "paid",
  "agent_assigned",
] as const satisfies readonly BookingStatus[];

/**
 * Why a customer may not cancel, when they may not.
 *
 * A code rather than a sentence so the caller can decide the wording for its
 * own surface, and so a test can assert the RULE rather than the copy.
 */
export type CustomerCancelRefusal =
  /** The booking is past the point where self-service applies. */
  | "not_cancellable_status"
  /** The pickup window has opened. */
  | "window_open"
  /** Money has already changed hands. */
  | "already_captured"
  /** The transition or the provider refused. */
  | "failed";

export interface CustomerCancelEligibility {
  canCancel: boolean;
  /** Null exactly when `canCancel`. */
  refusal: CustomerCancelRefusal | null;
}

/**
 * Whether the "Cancel booking" control should be offered at all.
 *
 * Exported and pure-ish (one payment read) because the PAGE and the ACTION
 * must not be able to disagree: a button rendered against one rule and a
 * server refusing against another is how a customer ends up pressing
 * something that cannot work. Both call this.
 *
 * THE THREE GATES, in the order they are cheapest to answer:
 *
 *  1. **Status.** See {@link CUSTOMER_CANCELLABLE_STATUSES}.
 *  2. **The window has not opened.** Free self-cancel ends at
 *     `pickup_window_start`, mirroring the agreement's §5 semantics: up to the
 *     window, nobody has been dispatched to a door on this booking's account.
 *     After it, an agent may already be outside, and that is a conversation.
 *     A booking with no window at all (the column is nullable) fails this
 *     gate — refusing to guess is the only safe reading, because guessing
 *     wrong here either cancels something in flight or charges somebody who
 *     asked in time.
 *  3. **Nothing captured.** An authorization can simply be released. A
 *     CAPTURE is money that has left the customer's account, and giving it
 *     back is a refund decision with a fee policy attached that this product
 *     does not have yet (see the TODO on `cancelBookingWithRefund`). Ops
 *     refunds; a button does not.
 */
export async function customerCancelEligibility(
  db: Database,
  booking: Pick<Booking, "id" | "status" | "pickupWindowStart">,
  now: Date,
): Promise<CustomerCancelEligibility> {
  if (
    !(CUSTOMER_CANCELLABLE_STATUSES as readonly BookingStatus[]).includes(booking.status)
  ) {
    return { canCancel: false, refusal: "not_cancellable_status" };
  }

  if (
    booking.pickupWindowStart === null ||
    now.getTime() >= booking.pickupWindowStart.getTime()
  ) {
    return { canCancel: false, refusal: "window_open" };
  }

  /*
   * The LATEST payment row, across providers.
   *
   * `cancelBookingWithRefund` scopes its own lookup to the configured
   * provider, which is right for acting; this is a REFUSAL, so it is
   * deliberately wider. A capture recorded under a provider we are no longer
   * configured with is still money that left somebody's account, and offering
   * a free cancel over it would be worse than declining one we could have
   * honoured.
   */
  const latest = await db.query.payments.findFirst({
    where: eq(payments.bookingId, booking.id),
    orderBy: [desc(payments.createdAt)],
  });
  if (latest?.status === "captured" || latest?.status === "refunded") {
    return { canCancel: false, refusal: "already_captured" };
  }

  return { canCancel: true, refusal: null };
}

export interface CancelBookingByCustomerInput {
  bookingId: string;
  /** Free text from the customer. Recorded in the custody trail; optional. */
  reason?: string;
}

export type CancelBookingByCustomerResult =
  | { ok: true; money: "refunded" | "auth_cancelled" | "none" }
  | { ok: false; refusal: CustomerCancelRefusal; error: string };

/** The sentence each refusal gets on a customer-facing surface. */
const REFUSAL_COPY: Record<CustomerCancelRefusal, string> = {
  not_cancellable_status:
    "This booking has moved past the point where it can be cancelled here. Contact support and we will sort it out.",
  window_open:
    "Your pickup window has opened, so cancelling now goes through support. Get in touch and we will help.",
  already_captured:
    "This booking has already been charged, so cancelling goes through support. Get in touch and we will help.",
  failed: "We couldn't cancel this booking. Contact support and we will sort it out.",
};

export function customerCancelRefusalMessage(refusal: CustomerCancelRefusal): string {
  return REFUSAL_COPY[refusal];
}

/**
 * The customer calls off their own booking.
 *
 * Ownership first, then the policy gates, then the SAME cancellation the
 * console performs — `cancelBookingWithRefund`, which runs the state
 * machine's `cancel` transition, releases the slot, writes the custody event
 * and voids the uncaptured authorization through the payment seam. Nothing
 * about the money is reimplemented here; the only difference from an admin
 * cancellation is who the actor is and which gates had to pass first.
 *
 * The actor is the CUSTOMER's own user id and role, which is the whole point
 * of `custody_events` recording an actor: "cancelled by you" and "cancelled
 * by Koolee" are different facts, both surfaced from the same append-only
 * row.
 *
 * A booking that is not theirs 404s rather than 403s — telling a caller that
 * somebody else's booking exists is itself a disclosure, and that is the rule
 * `getBookingForSession` already follows.
 */
export async function cancelBookingByCustomer(
  config: CoreConfig,
  session: CustomerSession,
  input: CancelBookingByCustomerInput,
): Promise<CancelBookingByCustomerResult> {
  const { db } = config;

  const booking = await getBooking(db, input.bookingId);
  if (!booking) throw new NotFoundError("Booking", input.bookingId);
  if (!canActOnBooking(session, booking)) {
    throw new NotFoundError("Booking", input.bookingId);
  }

  /*
   * Re-checked here rather than trusted from the page that rendered the
   * button. A server action stays a reachable POST whatever the UI drew — the
   * same reasoning that keeps the identity gate in core rather than in the
   * agent app.
   */
  const eligibility = await customerCancelEligibility(db, booking, config.clock.now());
  if (!eligibility.canCancel) {
    const refusal = eligibility.refusal ?? "failed";
    return { ok: false, refusal, error: REFUSAL_COPY[refusal] };
  }

  const result = await cancelBookingWithRefund(config, {
    bookingId: booking.id,
    actor: { userId: session.userId, role: session.role },
    reason: input.reason?.trim() || "Cancelled by the customer.",
  });

  if (!result.ok) return { ok: false, refusal: "failed", error: result.error };
  return { ok: true, money: result.money };
}

/* ------------------------------------------------------------------ */
/* Who cancelled it                                                     */
/* ------------------------------------------------------------------ */

/** Who ended a booking, read back off the append-only trail. */
export interface CancellationRecord {
  at: Date;
  /**
   * `customer` when the person who booked it called it off, `staff` when
   * Koolee did, `system` when no actor was recorded (a job, a webhook).
   */
  by: "customer" | "staff" | "system";
  /** The reason carried on the transition, when one was given. */
  reason: string | null;
}

/**
 * Reads the cancellation off a timeline the caller already has.
 *
 * Takes events rather than a booking id ON PURPOSE: every surface that needs
 * this — the trip page, the agent's task detail, the console's booking
 * detail — has already loaded the custody trail, and a second query for a row
 * sitting in memory is a query nobody needed. `custody_events` is append-only
 * and a booking reaches `cancelled` exactly once, so the first matching event
 * is the cancellation; the `?? null` on the reason is for the console's own
 * cancellations, which carry one, versus a customer's, which may not.
 *
 * `by` is derived from the actor's ROLE rather than from whether the actor is
 * the booking's owner: an admin cancelling their own personal booking is
 * still Koolee cancelling it, and the customer should read it that way.
 */
export function cancellationFromTimeline(
  timeline: readonly Pick<
    CustodyEvent,
    "eventType" | "actorRole" | "createdAt" | "metadata"
  >[],
): CancellationRecord | null {
  const event = timeline.find((e) => e.eventType === EVENT_TYPES.cancel);
  if (!event) return null;

  const reason =
    event.metadata &&
    typeof event.metadata === "object" &&
    "reason" in event.metadata &&
    typeof (event.metadata as { reason?: unknown }).reason === "string"
      ? ((event.metadata as { reason: string }).reason ?? null)
      : null;

  return {
    at: event.createdAt,
    by: cancelledByFor(event.actorRole),
    reason,
  };
}

function cancelledByFor(role: UserRole | null): CancellationRecord["by"] {
  if (role === null) return "system";
  return role === "customer" ? "customer" : "staff";
}

/**
 * Loads the cancellation for a booking whose timeline is NOT already in hand.
 *
 * The agent's task detail is the one such surface — it loads a visit or
 * pickup context rather than the customer's full trip detail.
 */
export async function getCancellation(
  db: Database,
  bookingId: string,
): Promise<CancellationRecord | null> {
  const rows = await db
    .select({
      eventType: custodyEvents.eventType,
      actorRole: custodyEvents.actorRole,
      createdAt: custodyEvents.createdAt,
      metadata: custodyEvents.metadata,
    })
    .from(custodyEvents)
    .where(
      and(
        eq(custodyEvents.bookingId, bookingId),
        eq(custodyEvents.eventType, EVENT_TYPES.cancel),
      ),
    )
    .orderBy(desc(custodyEvents.createdAt))
    .limit(1);

  return cancellationFromTimeline(rows);
}
