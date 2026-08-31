import { and, eq, lte } from "drizzle-orm";
import {
  airlineCutoffs,
  type Booking,
  type BookingStatus,
  type Database,
} from "@koolee/db";

import type { CoreConfig } from "../config";
import { BookingNotActionableError } from "../errors";
import { computeBagDropCutoffAt } from "../slots/cutoff";
import type { TransitionActor } from "../booking/state-machine";
import { applyTransition } from "./bookings";

/**
 * Whether a booking can still be acted on, and if not, why not.
 *
 * ONE place answers that question. Before this module the answer was spread
 * across five services as five different status arrays, and none of them knew
 * about time at all: a booking whose flight left yesterday accepted an
 * agreement, took a passport upload, and offered the customer a shortlist of
 * drivers, because `paid` is `paid` whatever the clock says. The gates below
 * are the same object read five ways, so a rule can be changed in one place
 * and cannot be half-applied.
 *
 * TWO independent axes, deliberately not collapsed into one enum:
 *
 *  - **standing** — where the booking is in its lifecycle. `cancelled` and
 *    `completed` are terminal; `delivered_to_bagdrop` means the airline has
 *    the bags; `exception` belongs to ops; `in_transit` means a driver is
 *    holding them right now.
 *  - **phase** — where NOW sits against this booking's own three deadlines:
 *    the end of the pickup window, the airline's bag-drop cutoff, and the
 *    scheduled departure.
 *
 * Collapsing them loses the case the product actually cares about: an
 * `agent_assigned` booking twenty minutes past its pickup window is late and
 * completely salvageable, and the same booking twenty minutes past its
 * bag-drop cutoff is not. Same standing, different phase, opposite answers.
 *
 * All three anchors are INSTANTS and are compared as instants, which is
 * zone-free and therefore correct by construction — `departureAt` was built
 * from the airport's wall clock at booking time, and the window was sold in
 * the airport's zone. Rendering them is a different job and belongs to the
 * caller, in the BOOKING's zone, per docs/TIME.md. Nothing here formats a
 * time, which is why nothing here needs a zone.
 */

/** The five entry points this object gates. */
export interface BookingActions {
  /** Customer accepts the booking agreement. */
  acceptAgreement: boolean;
  /** Customer uploads (or replaces) their passport photo. */
  uploadPassport: boolean;
  /** Customer sees and picks a driver. */
  selectDriver: boolean;
  /** Agent starts the verification visit at the door. */
  startVisit: boolean;
  /** Driver sets off for the pickup. */
  startPickup: boolean;
}

export type ActionName = keyof BookingActions;

/** Where the booking sits in its lifecycle, as far as gating is concerned. */
export type BookingStanding =
  /** Bags are still with the customer or staged for collection. */
  | "active"
  /** A driver is holding the bags right now. */
  | "in_transit"
  /** The airline has them. */
  | "handed_over"
  /** Ops owns it. */
  | "exception"
  /** `completed` or `cancelled`. */
  | "terminal";

/** Where NOW sits against this booking's deadlines. */
export type BookingPhase =
  | "before_window_end"
  /** Past the pickup window, before the bag-drop cutoff: late but savable. */
  | "running_late"
  /** Past the airline's bag-drop cutoff. */
  | "missed_cutoff"
  /** Past the scheduled departure. */
  | "departed";

export interface BookingActionability {
  standing: BookingStanding;
  phase: BookingPhase;
  can: BookingActions;
  /**
   * One sentence naming why the blocked actions are blocked, or null when
   * nothing is blocked. Every surface renders THIS string — a gate that
   * refuses without saying why is the version of this bug that is hardest to
   * support.
   */
  blockedReason: string | null;
  /**
   * The "running late" notice. Set only while actions are still ALLOWED —
   * it is a warning, not a refusal, and the three surfaces show it side by
   * side with controls that still work.
   */
  lateNotice: string | null;
  /**
   * True when a blocked attempt should raise the existing exception path so
   * ops can decide (refund, rebook). False once the booking is already an
   * exception, and false for a booking whose bags are already moving — see
   * the carve-out in `assertActionable`.
   */
  raisesException: boolean;
  /** Echoed so a caller can render the deadline it was measured against. */
  pickupWindowEnd: Date | null;
  /** Null when no cutoff is on record for this airline/airport. */
  bagDropCutoffAt: Date | null;
  departureAt: Date;
}

/** Everything the pure computation needs, and nothing else. */
export interface ActionabilitySubject {
  status: BookingStatus;
  pickupWindowEnd: Date | null;
  departureAt: Date;
  /** The airline's bag-drop deadline, or null when none is on record. */
  bagDropCutoffAt: Date | null;
}

const NOTHING: BookingActions = {
  acceptAgreement: false,
  uploadPassport: false,
  selectDriver: false,
  startVisit: false,
  startPickup: false,
};

const EVERYTHING: BookingActions = {
  acceptAgreement: true,
  uploadPassport: true,
  selectDriver: true,
  startVisit: true,
  startPickup: true,
};

function standingOf(status: BookingStatus): BookingStanding {
  switch (status) {
    case "completed":
    case "cancelled":
      return "terminal";
    case "delivered_to_bagdrop":
      return "handed_over";
    case "exception":
      return "exception";
    case "in_transit":
      return "in_transit";
    default:
      return "active";
  }
}

function phaseOf(subject: ActionabilitySubject, now: Date): BookingPhase {
  const at = now.getTime();
  if (at >= subject.departureAt.getTime()) return "departed";
  /*
   * A booking with no cutoff on record has no `missed_cutoff` phase at all.
   *
   * The instinct is to fall back to something strict, and it is wrong here:
   * every other "be conservative" rule in this codebase moves a DEADLINE
   * earlier, which costs the customer nothing. This moves a REFUSAL earlier,
   * which costs them their pickup. We do not claim a deadline passed when we
   * do not know the deadline — and departure, above, is a fact we do know, so
   * a genuinely missed flight is still caught. (`Unknown airline cutoff ⇒
   * refuse to sell` means such a booking should not exist; this is what
   * happens if a cutoff row is retired underneath one that already does.)
   */
  if (subject.bagDropCutoffAt !== null && at >= subject.bagDropCutoffAt.getTime()) {
    return "missed_cutoff";
  }
  if (subject.pickupWindowEnd !== null && at >= subject.pickupWindowEnd.getTime()) {
    return "running_late";
  }
  return "before_window_end";
}

/**
 * The pure computation. Exported because every rule below is a claim about
 * time that ought to be provable without a database.
 */
export function bookingActionability(
  subject: ActionabilitySubject,
  now: Date,
): BookingActionability {
  const standing = standingOf(subject.status);
  const phase = phaseOf(subject, now);

  const base = {
    standing,
    phase,
    pickupWindowEnd: subject.pickupWindowEnd,
    bagDropCutoffAt: subject.bagDropCutoffAt,
    departureAt: subject.departureAt,
  } as const;

  if (standing === "terminal") {
    return {
      ...base,
      can: NOTHING,
      blockedReason:
        subject.status === "cancelled"
          ? "This booking was cancelled."
          : "This booking is complete. Anything further goes through support.",
      lateNotice: null,
      raisesException: false,
    };
  }

  if (standing === "handed_over") {
    return {
      ...base,
      can: NOTHING,
      blockedReason:
        "Your bags are with the airline. Anything further goes through support.",
      lateNotice: null,
      raisesException: false,
    };
  }

  // Ops owns an exception outright. The gates must never block the admin
  // resolution paths, and they cannot: those go through `applyTransition`
  // (resume / force-complete / cancel), not through the five actions here.
  if (standing === "exception") {
    return {
      ...base,
      can: NOTHING,
      blockedReason: "Our team is sorting this booking out and will be in touch.",
      lateNotice: null,
      raisesException: false,
    };
  }

  // The bags are in a van. None of the five actions applies to a booking in
  // this state anyway — and crucially, the driver's remaining work (scanning
  // seals, delivering, confirming handover) is NOT gated here. See the
  // carve-out note on `assertActionable`.
  if (standing === "in_transit") {
    return {
      ...base,
      can: NOTHING,
      blockedReason: "Your bags are with the driver.",
      lateNotice:
        phase === "missed_cutoff" || phase === "departed"
          ? "Your bags are with the driver and our team is tracking this booking."
          : null,
      raisesException: false,
    };
  }

  // standing === "active" from here: the bags are still with the customer.
  if (phase === "missed_cutoff" || phase === "departed") {
    return {
      ...base,
      can: NOTHING,
      blockedReason:
        phase === "departed"
          ? "This flight has already departed, so we can't collect for it. Our team will be in touch."
          : "The airline's bag drop for this flight has closed, so we can't collect for it. Our team will be in touch.",
      lateNotice: null,
      raisesException: true,
    };
  }

  if (phase === "running_late") {
    return {
      ...base,
      can: EVERYTHING,
      blockedReason: null,
      // Late but savable: everything still works, and all three surfaces say
      // so out loud. Blocking here would strand a booking the airline would
      // still have accepted.
      lateNotice:
        "This pickup is running late — it's past your pickup window, but the airline's bag drop is still open.",
      raisesException: false,
    };
  }

  return {
    ...base,
    can: EVERYTHING,
    blockedReason: null,
    lateNotice: null,
    raisesException: false,
  };
}

/**
 * The same answer for a booking row, with its bag-drop deadline resolved.
 *
 * Two functions rather than one because the rules and the lookup are separate
 * concerns: the rules are pure and unit-tested against a clock, and this is
 * the thin part that goes to the database for the one value a booking row
 * does not carry.
 *
 * The cutoff is the STRICTEST on record across both scopes, for the reason
 * `resolveStrictestCutoffMinutes` documents: bookings do not persist
 * domestic vs international, and the looser row is a deadline that runs late.
 */
export async function getBookingActionability(
  db: Database,
  booking: Booking,
  now: Date,
): Promise<BookingActionability> {
  const rows = await db
    .select({ minutes: airlineCutoffs.cutoffMinutesBeforeDeparture })
    .from(airlineCutoffs)
    .where(
      and(
        eq(airlineCutoffs.airlineIata, booking.airlineIata.toUpperCase()),
        eq(airlineCutoffs.airportCode, booking.departureAirport),
        lte(airlineCutoffs.effectiveFrom, now),
      ),
    );

  const cutoffMinutes = rows.reduce<number | null>(
    (strictest, row) =>
      strictest === null ? row.minutes : Math.max(strictest, row.minutes),
    null,
  );

  return bookingActionability(
    {
      status: booking.status,
      pickupWindowEnd: booking.pickupWindowEnd ?? null,
      departureAt: booking.departureAt,
      bagDropCutoffAt:
        cutoffMinutes === null
          ? null
          : computeBagDropCutoffAt(booking.departureAt, cutoffMinutes),
    },
    now,
  );
}

/**
 * The enforcement point. Throws `BookingNotActionableError` when `action` is
 * blocked, and raises the exception path on the way out when the booking has
 * missed its deadline.
 *
 * **The exception is raised exactly once**, and not because anything here
 * counts: `applyTransition` guards its update with `WHERE status = from`, so
 * the second concurrent attempt loses the race and returns an illegal-
 * transition error — and once the row IS `exception`, `raisesException` is
 * false for every attempt after it. The emit itself is
 * `applyTransition`'s job (see the standing rule about never re-adding an
 * emit at a call site).
 *
 * **The in-transit carve-out.** A driver already holding the bags is not
 * stopped by any of this. The five actions gated here all belong to the phase
 * BEFORE custody transfers; the driver's own steps — scanning seals,
 * delivering, confirming the airline took them — call none of them, so a van
 * that is already moving keeps moving. Bags are safer at the airline, or back
 * with ops, than in limbo. Ops still sees it: `cutoffRiskMonitor` scans
 * `in_transit` bookings every five minutes and alerts on exactly this case.
 */
export async function assertActionable(
  config: CoreConfig,
  booking: Booking,
  action: ActionName,
  actor?: TransitionActor,
): Promise<BookingActionability> {
  const state = await getBookingActionability(config.db, booking, config.clock.now());
  if (state.can[action]) return state;

  if (state.raisesException) {
    const moved = await applyTransition(config, {
      bookingId: booking.id,
      event: "raise_exception",
      ...(actor === undefined ? {} : { actor }),
      exceptionReason:
        state.phase === "departed"
          ? "Flight departed before the bags were collected"
          : "Airline bag-drop cutoff passed before the bags were collected",
      metadata: { blockedAction: action, phase: state.phase },
    });
    if (!moved.ok) {
      // Someone else moved it first — including, most likely, a concurrent
      // blocked attempt raising the same exception. Nothing to do: the
      // booking is with ops either way, and the customer gets the same
      // message below.
      console.warn(
        `[actionability] booking ${booking.id} could not be raised to exception: ${moved.error.message}`,
      );
    }
  }

  throw new BookingNotActionableError(
    action,
    state.standing,
    state.phase,
    state.blockedReason ?? "This booking can't be changed right now.",
  );
}
