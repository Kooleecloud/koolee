/**
 * Typed errors for the domain layer.
 *
 * Every failure a caller might reasonably handle differently gets its own
 * class with a stable `code`, so adapters (route handlers, server actions) can
 * branch on it without string-matching messages.
 */

export type CoreErrorCode =
  | "ILLEGAL_TRANSITION"
  | "SLOT_NOT_SELLABLE"
  | "SLOT_SOLD_OUT"
  | "OUT_OF_COVERAGE"
  | "CUTOFF_UNKNOWN"
  | "PRICING_RULE_INVALID"
  | "PAYMENT_FAILED"
  | "NOT_AUTHENTICATED"
  | "NOT_AUTHORIZED"
  | "NOT_FOUND"
  | "NOT_IMPLEMENTED"
  | "CONFLICT"
  | "INVALID_INPUT"
  | "QUOTE_ZIP_MISMATCH"
  | "BOOKING_NOT_ACTIONABLE";

export abstract class CoreError extends Error {
  abstract readonly code: CoreErrorCode;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class SlotNotSellableError extends CoreError {
  readonly code = "SLOT_NOT_SELLABLE" as const;
  /** Identifies the rejected pickup window (its start, ISO-8601). */
  readonly slotId: string;
  readonly reason: string;

  constructor(slotId: string, reason: string) {
    super(`Pickup window ${slotId} is not bookable: ${reason}`);
    this.slotId = slotId;
    this.reason = reason;
  }
}

export class OutOfCoverageError extends CoreError {
  readonly code = "OUT_OF_COVERAGE" as const;
  readonly zip: string;

  constructor(zip: string) {
    super(`ZIP ${zip} is outside the current Koolee service area.`);
    this.zip = zip;
  }
}

/**
 * The booking's pickup address is in a different ZIP from the one its
 * coverage check and its price were computed for.
 *
 * The funnel asks for a ZIP on the flight step (that is what says "yes, we
 * come to you" and what the quote is built from) and for a full address two
 * steps later, and nothing used to make the two agree: any covered ZIP was
 * accepted at the address step, silently replacing the one the customer was
 * quoted. ZIP is not cosmetic here — it picks the coverage answer, the
 * `zip_centroids` coordinate every drive-time estimate starts from, and the
 * `agent_zones` row that decides who is dispatched.
 *
 * The UI reconciles this before it can happen (an inline notice offering
 * "update my quote" or "use a different address"). This error is the
 * guarantee behind that UI, because a server action stays a reachable POST
 * whatever the form renders.
 */
export class QuoteZipMismatchError extends CoreError {
  readonly code = "QUOTE_ZIP_MISMATCH" as const;
  /** The ZIP the price and coverage answer were computed for. */
  readonly quotedZip: string;
  /** The ZIP of the address the booking would be created against. */
  readonly addressZip: string;

  constructor(quotedZip: string, addressZip: string) {
    super(
      `Pickup address is in ${addressZip} but this booking was quoted for ${quotedZip}.`,
    );
    this.quotedZip = quotedZip;
    this.addressZip = addressZip;
  }
}

/**
 * The booking is past a deadline, or past the point in its life, where this
 * action still means anything.
 *
 * Distinct from `IllegalTransitionError`, which is about the state machine's
 * own table. This one is about TIME and about terminal standing: accepting an
 * agreement for a flight that left yesterday is not an illegal transition —
 * nothing transitions — it is simply an action with no meaning left in it.
 *
 * `message` is written for the person who hit the wall, because it is what
 * every surface renders. See `services/actionability.ts`.
 */
export class BookingNotActionableError extends CoreError {
  readonly code = "BOOKING_NOT_ACTIONABLE" as const;
  /** Which of the five gated actions was refused. */
  readonly action: string;
  /** Lifecycle standing at the time of the refusal. */
  readonly standing: string;
  /** Position against the booking's deadlines at the time of the refusal. */
  readonly phase: string;

  constructor(action: string, standing: string, phase: string, message: string) {
    super(message);
    this.action = action;
    this.standing = standing;
    this.phase = phase;
  }
}

export class CutoffUnknownError extends CoreError {
  readonly code = "CUTOFF_UNKNOWN" as const;

  constructor(airlineIata: string, airportCode: string, scope: string) {
    super(
      `No bag-drop cutoff on record for ${airlineIata} at ${airportCode} (${scope}). ` +
        `Refusing to sell a slot without one — the cutoff is what decides whether ` +
        `the bags can physically make the flight.`,
    );
  }
}

export class PricingRuleInvalidError extends CoreError {
  readonly code = "PRICING_RULE_INVALID" as const;

  constructor(reason: string) {
    super(`Pricing rule is invalid: ${reason}`);
  }
}

export class PaymentFailedError extends CoreError {
  readonly code = "PAYMENT_FAILED" as const;
  override readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.cause = cause;
  }
}

export class NotAuthenticatedError extends CoreError {
  readonly code = "NOT_AUTHENTICATED" as const;

  constructor(message = "No valid session.") {
    super(message);
  }
}

export class NotAuthorizedError extends CoreError {
  readonly code = "NOT_AUTHORIZED" as const;

  constructor(message = "Not permitted.") {
    super(message);
  }
}

export class NotFoundError extends CoreError {
  readonly code = "NOT_FOUND" as const;

  constructor(what: string, id: string) {
    super(`${what} ${id} not found.`);
  }
}

/**
 * A conflicting resource state: a unique identifier (phone, email) already
 * belonging to another account, a record (address) that other rows depend on,
 * or a step attempted against a state that has moved past it (seal, passport).
 */
export type ConflictField =
  | "phone"
  | "email"
  | "address"
  | "seal"
  | "passport"
  /** A shift collision: this person, or this truck, is already out. */
  | "shift"
  /** Driver selection lost a race, or the chosen driver stopped being eligible. */
  | "driver";

export class ConflictError extends CoreError {
  readonly code = "CONFLICT" as const;
  /** What collided. */
  readonly field: ConflictField;

  constructor(field: ConflictField, message?: string) {
    super(message ?? `That ${field} already belongs to another account.`);
    this.field = field;
  }
}

/**
 * A caller passed input the domain refuses outright. Actions validate before
 * calling core, so reaching this means a bug or a bypassed form — the message
 * is safe to show but never fine-grained.
 */
export class InvalidInputError extends CoreError {
  readonly code = "INVALID_INPUT" as const;
  readonly field: string;

  constructor(field: string, message?: string) {
    super(message ?? `Invalid ${field}.`);
    this.field = field;
  }
}

/** Marks a deliberate seam that has not been implemented yet. */
export class NotImplementedError extends CoreError {
  readonly code = "NOT_IMPLEMENTED" as const;

  constructor(what: string, todo: string) {
    super(`${what} is not implemented. ${todo}`);
  }
}

/**
 * Result type for operations whose failure is an expected outcome rather than
 * an exception — the booking state machine in particular, where "that move is
 * illegal" is ordinary control flow.
 */
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });
