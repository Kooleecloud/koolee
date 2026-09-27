import { z } from "zod";

import { isoDateTime, uuid } from "./common";
import { truckSchema } from "./rows";

/** `GET /api/v1/shift` and the `shift` half of `GET /api/v1/me`. */
export const activeShiftSchema = z.object({
  id: uuid,
  truck: truckSchema,
  bagsOnBoard: z.number().int(),
  startedAt: isoDateTime,
});
export type ActiveShift = z.infer<typeof activeShiftSchema>;

export const shiftResponseSchema = z.object({
  shift: activeShiftSchema.nullable(),
});
export type ShiftResponse = z.infer<typeof shiftResponseSchema>;

/** `GET /api/v1/me` — who is signed in, re-checked against `staff_members` per request. */
export const meResponseSchema = z.object({
  userId: uuid,
  email: z.string().nullable(),
  fullName: z.string().nullable(),
  /** Signed URL for the private `avatars` object, or null. Short-lived; refetch, do not cache. */
  avatarUrl: z.string().nullable(),
  /** Key in the `avatars` bucket, for the account screen's "replace" flow. */
  avatarStoragePath: z.string().nullable(),
  canDrive: z.boolean(),
  shift: activeShiftSchema.nullable(),
  serverTime: isoDateTime,
});
export type MeResponse = z.infer<typeof meResponseSchema>;

export const truckOptionSchema = truckSchema.extend({
  /** Who is out with it right now, or null when it is free. */
  heldByUserId: uuid.nullable(),
});
export type TruckOption = z.infer<typeof truckOptionSchema>;

export const trucksResponseSchema = z.object({
  trucks: z.array(truckOptionSchema),
});
export type TrucksResponse = z.infer<typeof trucksResponseSchema>;

export const startShiftRequestSchema = z.object({
  truckId: uuid,
});
export type StartShiftRequest = z.infer<typeof startShiftRequestSchema>;
