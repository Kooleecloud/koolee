import { and, eq, lt } from "drizzle-orm";
import { apiIdempotencyKeys, type Database } from "@koolee/db";

/**
 * Idempotency for the agent app's `/api/v1` routes.
 *
 * THE PROBLEM THIS SOLVES. The native driver app queues actions offline and
 * replays them when the network returns. A replay is the same request sent
 * again because the phone never saw an answer — the first attempt may have
 * landed. Half of the driver steps are idempotent in core (the pickup run);
 * the other half refuse a repeat (`recordBagSealed` throws `ConflictError`
 * on a sealed bag, `startShift` refuses a second open shift), and a refusal
 * on replay would tell the driver a step FAILED that in fact succeeded.
 *
 * THE MODEL. The device mints a key per action. The route claims the key
 * before doing anything (an INSERT that either lands or does not); the first
 * claimant runs the handler and stores the response; every later claimant
 * gets that stored response back. A key reused for a different route or a
 * different body is a mismatch, refused rather than served.
 *
 * WHAT IS STORED. Only responses a client should not retry: successes and
 * domain refusals (4xx). A 5xx is a server failure, and the row is released
 * so the next attempt runs for real.
 *
 * This service is a plain table access layer — it knows nothing about HTTP.
 * The route wrapper in apps/agent turns these states into status codes.
 */

export const IDEMPOTENCY_RETENTION_HOURS = 24;

export type IdempotencyClaim =
  /** Nobody has used this key: run the handler, then `complete` or `release`. */
  | { state: "claimed" }
  /** The handler already ran to a stored answer: return it verbatim. */
  | { state: "replay"; status: number; body: unknown }
  /** Another request holding this key is still running. */
  | { state: "in_progress" }
  /** Same key, different route or body — a client bug, never served. */
  | { state: "mismatch" };

export interface ClaimIdempotencyKeyInput {
  userId: string;
  key: string;
  /** `METHOD /path`, so one key cannot be replayed against another route. */
  route: string;
  /** Digest of the canonical request body. */
  requestHash: string;
  now?: Date;
}

export async function claimIdempotencyKey(
  db: Database,
  input: ClaimIdempotencyKeyInput,
): Promise<IdempotencyClaim> {
  const inserted = await db
    .insert(apiIdempotencyKeys)
    .values({
      userId: input.userId,
      key: input.key,
      route: input.route,
      requestHash: input.requestHash,
      ...(input.now ? { createdAt: input.now } : {}),
    })
    .onConflictDoNothing()
    .returning({ key: apiIdempotencyKeys.key });
  if (inserted.length > 0) return { state: "claimed" };

  const row = await db.query.apiIdempotencyKeys.findFirst({
    where: and(
      eq(apiIdempotencyKeys.userId, input.userId),
      eq(apiIdempotencyKeys.key, input.key),
    ),
  });
  // Lost the insert race and the winner released the row before we read it:
  // the safest answer is "try again", which is what in_progress means to the
  // client.
  if (!row) return { state: "in_progress" };
  if (row.route !== input.route || row.requestHash !== input.requestHash) {
    return { state: "mismatch" };
  }
  if (row.status === null) return { state: "in_progress" };
  return { state: "replay", status: row.status, body: row.responseBody ?? null };
}

export interface CompleteIdempotencyKeyInput {
  userId: string;
  key: string;
  status: number;
  body: unknown;
  now?: Date;
}

/** Stores the first completed response. Idempotent itself: a second call is a no-op. */
export async function completeIdempotencyKey(
  db: Database,
  input: CompleteIdempotencyKeyInput,
): Promise<void> {
  await db
    .update(apiIdempotencyKeys)
    .set({
      status: input.status,
      responseBody: input.body,
      completedAt: input.now ?? new Date(),
    })
    .where(
      and(
        eq(apiIdempotencyKeys.userId, input.userId),
        eq(apiIdempotencyKeys.key, input.key),
      ),
    );
}

/** Drops a claim so the next attempt with this key runs for real (after a 5xx). */
export async function releaseIdempotencyKey(
  db: Database,
  input: { userId: string; key: string },
): Promise<void> {
  await db
    .delete(apiIdempotencyKeys)
    .where(
      and(
        eq(apiIdempotencyKeys.userId, input.userId),
        eq(apiIdempotencyKeys.key, input.key),
      ),
    );
}

export interface PruneIdempotencyKeysResult {
  deleted: number;
}

/**
 * Deletes rows past the retention window. Small table, small batches are not
 * needed: a driver produces a few dozen keys a day, and the sweep runs hourly.
 */
export async function pruneIdempotencyKeys(
  db: Database,
  options: { olderThanHours?: number; now?: Date } = {},
): Promise<PruneIdempotencyKeysResult> {
  const olderThanHours = options.olderThanHours ?? IDEMPOTENCY_RETENTION_HOURS;
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - olderThanHours * 60 * 60 * 1000);
  const rows = await db
    .delete(apiIdempotencyKeys)
    .where(lt(apiIdempotencyKeys.createdAt, cutoff))
    .returning({ key: apiIdempotencyKeys.key });
  return { deleted: rows.length };
}
