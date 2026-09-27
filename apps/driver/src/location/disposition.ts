import { ApiRequestError, isRetryable } from "../lib/api";

/**
 * What to do with a batch of queued positions the server did not take.
 *
 * KEEP when a later attempt can succeed: no signal, a server failure, or a
 * 401. A 401 is about the SESSION, not the fixes — once the driver signs back
 * in, the same fixes are accepted as long as the shift is still open — so
 * throwing them away would erase exactly the stretch of the route nobody saw.
 * Holding them costs nothing unbounded: the queue keeps a rolling hour.
 *
 * DROP when no attempt ever will: 409 not on shift (the shift ended under a
 * queue that was still full), 400 a fix the server refuses. Holding those
 * would block every good fix behind them forever.
 */
export type BatchDisposition = "keep" | "drop";

export function positionBatchDisposition(error: unknown): BatchDisposition {
  if (isRetryable(error)) return "keep";
  if (error instanceof ApiRequestError && error.status === 401) return "keep";
  return "drop";
}
