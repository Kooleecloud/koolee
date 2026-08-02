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
  | "CONFLICT";

export abstract class CoreError extends Error {
  abstract readonly code: CoreErrorCode;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class SlotNotSellableError extends CoreError {
  readonly code = "SLOT_NOT_SELLABLE" as const;
  readonly slotId: string;
  readonly reason: string;

  constructor(slotId: string, reason: string) {
    super(`Slot ${slotId} is not sellable: ${reason}`);
    this.slotId = slotId;
    this.reason = reason;
  }
}

export class SlotSoldOutError extends CoreError {
  readonly code = "SLOT_SOLD_OUT" as const;
  readonly slotId: string;

  constructor(slotId: string) {
    super(
      `Slot ${slotId} sold out while the booking was being created. ` +
        `No booking was written and no payment was authorized.`,
    );
    this.slotId = slotId;
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

/** A unique identifier (phone, email) already belongs to another account. */
export class ConflictError extends CoreError {
  readonly code = "CONFLICT" as const;
  /** Which identifier collided. */
  readonly field: "phone" | "email";

  constructor(field: "phone" | "email", message?: string) {
    super(message ?? `That ${field} already belongs to another account.`);
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
