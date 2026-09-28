import {
  endShift,
  getActiveShift,
  listTruckOptions,
  startShift,
  type ActiveShift as CoreActiveShift,
} from "@koolee/core";
import type {
  ActiveShift,
  Ok,
  ShiftResponse,
  TrucksResponse,
} from "@koolee/api-contract";

import type { ApiContext } from "../context";
import { toJson } from "../json";

/**
 * Shift handlers — THE implementation, shared by the `/api/v1/shift` routes
 * and `app/shift-actions.ts`, which only parses the form before calling in
 * here. Everything that decides whether a shift may open or close lives in
 * core; these only shape the answer.
 */

export function serializeActiveShift(active: CoreActiveShift | null): ActiveShift | null {
  if (!active) return null;
  return {
    id: active.shift.id,
    truck: toJson({
      id: active.truck.id,
      name: active.truck.name,
      bagCapacity: active.truck.bagCapacity,
      reservedSpaces: active.truck.reservedSpaces,
      active: active.truck.active,
    }),
    bagsOnBoard: active.bagsOnBoard,
    startedAt: active.shift.startedAt.toISOString(),
  };
}

export async function readShift(ctx: ApiContext): Promise<ShiftResponse> {
  const active = await getActiveShift(ctx.core.db, ctx.session.userId);
  return { shift: serializeActiveShift(active) };
}

export async function startDriverShift(
  ctx: ApiContext,
  truckId: string,
): Promise<ShiftResponse> {
  const active = await startShift(ctx.core, { staffUserId: ctx.session.userId, truckId });
  return { shift: serializeActiveShift(active) };
}

export async function endDriverShift(ctx: ApiContext): Promise<Ok> {
  await endShift(ctx.core, { staffUserId: ctx.session.userId });
  return { ok: true };
}

export async function readTrucks(ctx: ApiContext): Promise<TrucksResponse> {
  const trucks = await listTruckOptions(ctx.core.db);
  return {
    trucks: trucks.map((truck) => ({
      id: truck.id,
      name: truck.name,
      bagCapacity: truck.bagCapacity,
      reservedSpaces: truck.reservedSpaces,
      active: truck.active,
      heldByUserId: truck.heldByUserId,
    })),
  };
}
