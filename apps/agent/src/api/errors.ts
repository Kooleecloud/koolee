import { CoreError } from "@koolee/core";
import { API_ERROR_STATUS, type ApiError, type ApiErrorCode } from "@koolee/api-contract";

/**
 * One translation from "what core said" to "what the phone receives".
 *
 * A `CoreError` is a deliberate refusal carrying a sentence written for the
 * person at the door — it crosses the wire verbatim with a stable code the
 * app can branch on. Everything else is a transport or server failure, and
 * the honest instruction is "check your connection"; the real error is
 * logged here and shown to nobody. Same rule as `lib/action-error.ts`, with
 * a status code attached.
 */

export class ApiHttpError extends Error {
  readonly status: number;
  readonly body: ApiError;

  constructor(code: ApiErrorCode, message: string, extra: Partial<ApiError> = {}) {
    super(message);
    this.name = "ApiHttpError";
    this.status = API_ERROR_STATUS[code];
    this.body = { error: code, message, ...extra };
  }
}

/** For a core step that answered `{ ok: false, error }` — a refusal, not a crash. */
export function refused(message: string): ApiHttpError {
  return new ApiHttpError("refused", message);
}

export const TRANSPORT_FALLBACK =
  "Something went wrong. Check your connection and try again.";

export interface ErrorMappingOptions {
  /**
   * Routes where a `NotAuthorizedError` from core means "not on shift" rather
   * than "not an agent" — the position endpoint. Keeps the web queue's 409
   * disposition rule working for the app.
   */
  notOnShift?: boolean;
  logPrefix?: string;
}

export function toApiHttpError(
  error: unknown,
  options: ErrorMappingOptions = {},
): ApiHttpError {
  if (error instanceof ApiHttpError) return error;

  if (error instanceof CoreError) {
    const extra = extraFor(error);
    switch (error.code) {
      case "NOT_AUTHENTICATED":
        return new ApiHttpError("not_authorized", error.message);
      case "NOT_AUTHORIZED":
        return options.notOnShift
          ? new ApiHttpError("not_on_shift", error.message)
          : new ApiHttpError("forbidden", error.message);
      case "NOT_FOUND":
        return new ApiHttpError("not_found", error.message);
      case "INVALID_INPUT":
        return new ApiHttpError("invalid_input", error.message, extra);
      case "CONFLICT":
        return new ApiHttpError("conflict", error.message, extra);
      case "BOOKING_NOT_ACTIONABLE":
        return new ApiHttpError("booking_not_actionable", error.message, extra);
      default:
        // ILLEGAL_TRANSITION, SLOT_*, PAYMENT_FAILED, … — still a refusal
        // with a readable sentence, just not one a driver route expects.
        return new ApiHttpError("conflict", error.message);
    }
  }

  console.error(options.logPrefix ?? "[api]", error);
  return new ApiHttpError("internal", TRANSPORT_FALLBACK);
}

function extraFor(error: CoreError): Partial<ApiError> {
  const extra: Partial<ApiError> = {};
  const record = error as unknown as Record<string, unknown>;
  if (typeof record.field === "string") extra.field = record.field;
  if (typeof record.standing === "string") extra.standing = record.standing;
  if (typeof record.phase === "string") extra.phase = record.phase;
  return extra;
}
