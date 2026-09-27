import { z } from "zod";

/**
 * Shared vocabulary for every `/api/v1` route.
 *
 * WHO READS THIS. The route handlers in apps/agent parse requests and shape
 * responses with these schemas; the native driver app parses responses with
 * the same ones. Dates travel as ISO-8601 strings because `JSON.stringify`
 * turns a `Date` into one on the way out — the app parses them back where it
 * needs a `Date`.
 */

export const API_PREFIX = "/api/v1";

/** Header the app sends on every mutating request; see core `api-idempotency`. */
export const IDEMPOTENCY_HEADER = "Idempotency-Key";
export const IDEMPOTENCY_KEY_MAX_LENGTH = 128;

export const isoDateTime = z.iso.datetime({ offset: true });
export const nullableIsoDateTime = isoDateTime.nullable();
export const uuid = z.uuid();

/**
 * Every non-2xx body has this shape. `error` is a stable machine code for the
 * app to branch on; `message` is human copy safe to show the driver verbatim
 * (domain refusals) or the generic connection fallback (transport failures).
 */
export const API_ERROR_CODES = [
  /** No usable session: sign in again. */
  "not_authorized",
  /** Signed in, but not an active agent. */
  "forbidden",
  "not_found",
  /** The body failed schema validation. */
  "invalid_body",
  /** Core rejected a field value. */
  "invalid_input",
  /** A domain conflict: seal in use, already on shift, passport already confirmed… */
  "conflict",
  /** Core answered `{ ok: false, error }` — a deliberate refusal with a sentence. */
  "refused",
  /** The booking cannot be acted on in its current standing/phase. */
  "booking_not_actionable",
  /** Positions are only recorded on shift. */
  "not_on_shift",
  /** Same idempotency key, first attempt still running — retry shortly. */
  "idempotency_in_progress",
  /** Same idempotency key, different route or body — a client bug. */
  "idempotency_mismatch",
  /** Server dependency down (database, storage). Retry later. */
  "unavailable",
  "internal",
] as const;

export const apiErrorCodeSchema = z.enum(API_ERROR_CODES);
export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;

export const apiErrorSchema = z.object({
  error: apiErrorCodeSchema,
  message: z.string(),
  /** Set for `invalid_input` / `conflict`: which field core complained about. */
  field: z.string().optional(),
  /** Set for `booking_not_actionable`. */
  standing: z.string().optional(),
  phase: z.string().optional(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

/** Which HTTP status each error code travels with. One table, both sides. */
export const API_ERROR_STATUS: Record<ApiErrorCode, number> = {
  not_authorized: 401,
  forbidden: 403,
  not_found: 404,
  invalid_body: 400,
  invalid_input: 400,
  conflict: 409,
  refused: 422,
  booking_not_actionable: 409,
  not_on_shift: 409,
  idempotency_in_progress: 409,
  idempotency_mismatch: 422,
  unavailable: 503,
  internal: 500,
};

export const okSchema = z.object({ ok: z.literal(true) });
export type Ok = z.infer<typeof okSchema>;

/**
 * A device position, optional on every step. `null`/absent means "no fix";
 * exactly `0` is treated as no fix too, matching the web app's FormData rule.
 */
export const gpsSchema = z.object({
  lat: z.number().finite().nullable().optional(),
  lng: z.number().finite().nullable().optional(),
});
export type Gps = z.infer<typeof gpsSchema>;
