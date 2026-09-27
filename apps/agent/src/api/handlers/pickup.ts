import {
  confirmAirlineHandover as coreConfirmAirlineHandover,
  deliverToBagdrop as coreDeliverToBagdrop,
  reportPickupException as coreReportPickupException,
  scanSealAtPickup as coreScanSealAtPickup,
  startPickupTravel as coreStartPickupTravel,
} from "@koolee/core";
import {
  uuid,
  type Gps,
  type PickupExceptionRequest,
  type ScanSealRequest,
  type ScanSealResponse,
  type StepResponse,
} from "@koolee/api-contract";

import type { ApiContext } from "../context";
import { ApiHttpError, refused } from "../errors";

/**
 * The pickup run — THE implementation, shared by the `/api/v1` routes and
 * the pickup half of `app/tasks/[taskId]/actions.ts` (plus
 * `app/journey-actions.ts`), which only parse a form before calling in here.
 * Every step is idempotent in core, so a driver whose first tap timed out
 * after the write landed gets `ok` again on the retry. A core
 * `{ ok: false, error }` is a refusal with a sentence for the driver and
 * travels as 422 (a server action shows it verbatim); a thrown `CoreError`
 * (a seal mismatch is a `ConflictError`) propagates to the caller's mapping.
 */

/**
 * The contract lets a coordinate be absent, null, or a number; core wants
 * `number | null`. Exactly `0` counts as "no fix" — the web app's FormData
 * rule, kept here so the two clients write identical custody events.
 */
function coordinate(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value !== 0
    ? value
    : null;
}

function position(gps: Gps): { lat: number | null; lng: number | null } {
  return { lat: coordinate(gps.lat), lng: coordinate(gps.lng) };
}

/**
 * A task id that is not a uuid can never match a row — but Postgres rejects
 * it as a type error before the query runs, which the wrapper would log and
 * answer as 500 "check your connection". The honest answer is the same 404
 * an unassigned task gets: the app cannot tell the two apart, and must not.
 */
function assertTaskId(taskId: string): void {
  if (!uuid.safeParse(taskId).success) {
    throw new ApiHttpError("not_found", "That pickup task doesn't exist.");
  }
}

export async function startPickup(
  ctx: ApiContext,
  taskId: string,
  gps: Gps,
): Promise<StepResponse> {
  assertTaskId(taskId);
  const result = await coreStartPickupTravel(ctx.core, ctx.session, {
    taskId,
    ...position(gps),
  });
  if (!result.ok) throw refused(result.error);
  return { ok: true };
}

export async function scanSeal(
  ctx: ApiContext,
  taskId: string,
  body: ScanSealRequest,
): Promise<ScanSealResponse> {
  assertTaskId(taskId);
  const result = await coreScanSealAtPickup(ctx.core, ctx.session, {
    taskId,
    sealValue: body.sealValue,
    ...position(body),
  });
  return {
    ok: true,
    bagId: result.bagId,
    scannedCount: result.scannedCount,
    totalBags: result.totalBags,
    custodyTransferred: result.custodyTransferred,
  };
}

export async function deliver(
  ctx: ApiContext,
  taskId: string,
  gps: Gps,
): Promise<StepResponse> {
  assertTaskId(taskId);
  const result = await coreDeliverToBagdrop(ctx.core, ctx.session, {
    taskId,
    ...position(gps),
  });
  if (!result.ok) throw refused(result.error);
  return { ok: true };
}

export async function handover(
  ctx: ApiContext,
  taskId: string,
  gps: Gps,
): Promise<StepResponse> {
  assertTaskId(taskId);
  const result = await coreConfirmAirlineHandover(ctx.core, ctx.session, {
    taskId,
    ...position(gps),
  });
  if (!result.ok) throw refused(result.error);
  return { ok: true };
}

export async function reportPickupException(
  ctx: ApiContext,
  taskId: string,
  body: PickupExceptionRequest,
): Promise<StepResponse> {
  assertTaskId(taskId);
  const note = body.note?.trim();
  const result = await coreReportPickupException(ctx.core, ctx.session, {
    taskId,
    reason: body.reason,
    ...(note ? { note } : {}),
    ...position(body),
  });
  if (!result.ok) throw refused(result.error);
  return { ok: true };
}
