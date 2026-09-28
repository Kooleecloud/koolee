import {
  arriveAtVisit,
  BUCKETS,
  completeVerificationVisit,
  confirmVisitIdentity,
  getVisitContext,
  recordAgentCapture,
  recordBagSealed,
  reportVisitException as coreReportVisitException,
} from "@koolee/core";
import {
  uuid,
  type CapturePassportRequest,
  type Gps,
  type Ok,
  type SealBagRequest,
  type VisitExceptionRequest,
} from "@koolee/api-contract";

import type { ApiContext } from "../context";
import { ApiHttpError, refused } from "../errors";
import { assertObjectExists, assertPathUnderPrefix } from "../storage";

/**
 * The verification visit's steps — THE implementation, shared by the
 * `/api/v1` routes and the web app's server actions
 * (`app/tasks/[taskId]/actions.ts`), which only parse a form and upload the
 * photo before calling in here. Whichever client put the photo in Storage,
 * the handler's only job with it is to prove the key is the right shape and
 * the object is really there before core writes it into the custody trail.
 *
 * Errors are never folded into the body: a core refusal becomes a 422, a
 * thrown CoreError is mapped by the route wrapper.
 */

/**
 * Core looks the task up by uuid and never validates the shape, so a
 * malformed segment would reach Postgres' uuid cast and surface as a 500.
 * A task id that cannot exist is a 404 — the same answer core gives for a
 * task that is not this agent's, so the two are indistinguishable.
 */
function requireTaskId(taskId: string): string {
  if (!uuid.safeParse(taskId).success) {
    throw new ApiHttpError("not_found", "That task doesn't exist.");
  }
  return taskId;
}

/** Exactly `0` is "no fix", matching the web app's FormData rule. */
function gps(input: Gps): { lat: number | null; lng: number | null } {
  return {
    lat: input.lat ? input.lat : null,
    lng: input.lng ? input.lng : null,
  };
}

export async function arrive(ctx: ApiContext, taskId: string, input: Gps): Promise<Ok> {
  await arriveAtVisit(ctx.core, ctx.session, {
    taskId: requireTaskId(taskId),
    ...gps(input),
  });
  return { ok: true };
}

/**
 * Assignment is resolved BEFORE the storage checks so a task that is not
 * this agent's 404s without revealing whether an object exists — and so the
 * prefix the key must sit under comes from the booking core says the task
 * belongs to, never from the request.
 */
export async function capturePassport(
  ctx: ApiContext,
  taskId: string,
  input: CapturePassportRequest,
): Promise<Ok> {
  requireTaskId(taskId);
  const visit = await getVisitContext(ctx.core.db, ctx.session, taskId, ctx.now);
  assertPathUnderPrefix(input.storagePath, `passports/${visit.booking.id}/`);
  await assertObjectExists(ctx.supabase, BUCKETS.passportPhotos.id, input.storagePath);
  await recordAgentCapture(ctx.core, ctx.session, {
    taskId,
    storagePath: input.storagePath,
  });
  return { ok: true };
}

export async function confirmPassport(
  ctx: ApiContext,
  taskId: string,
  input: Gps,
): Promise<Ok> {
  await confirmVisitIdentity(ctx.core, ctx.session, {
    taskId: requireTaskId(taskId),
    ...gps(input),
  });
  return { ok: true };
}

export async function sealBag(
  ctx: ApiContext,
  taskId: string,
  input: SealBagRequest,
): Promise<Ok> {
  requireTaskId(taskId);
  // Assignment first, exactly like capturePassport: an agent this task is not
  // assigned to gets the 404 core would give them, never a 400 that reveals
  // whether some object exists in the bucket.
  await getVisitContext(ctx.core.db, ctx.session, taskId, ctx.now);
  assertPathUnderPrefix(input.photoPath, `bags/${input.bagId}/`, "photoPath");
  await assertObjectExists(
    ctx.supabase,
    BUCKETS.bagPhotos.id,
    input.photoPath,
    "photoPath",
  );
  await recordBagSealed(ctx.core, ctx.session, {
    taskId,
    bagId: input.bagId,
    sealId: input.sealId,
    weightKg: input.weightKg,
    photoPath: input.photoPath,
    ...gps(input),
  });
  return { ok: true };
}

export async function completeVisit(
  ctx: ApiContext,
  taskId: string,
  input: Gps,
): Promise<Ok> {
  const result = await completeVerificationVisit(ctx.core, ctx.session, {
    taskId: requireTaskId(taskId),
    ...gps(input),
  });
  if (!result.ok) throw refused(result.error);
  return { ok: true };
}

export async function reportVisitException(
  ctx: ApiContext,
  taskId: string,
  input: VisitExceptionRequest,
): Promise<Ok> {
  const note = input.note?.trim();
  const result = await coreReportVisitException(ctx.core, ctx.session, {
    taskId: requireTaskId(taskId),
    reason: input.reason,
    ...(note ? { note } : {}),
    ...gps(input),
  });
  if (!result.ok) throw refused(result.error);
  return { ok: true };
}
