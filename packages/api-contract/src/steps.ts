import { z } from "zod";

import { gpsSchema, okSchema, uuid } from "./common";
import { pickupExceptionReasonSchema, visitExceptionReasonSchema } from "./enums";

/**
 * Request bodies for the visit and pickup steps. Every step takes an optional
 * device position; the ones that carry evidence take the storage path of an
 * object the app ALREADY uploaded straight to Supabase Storage under its own
 * session (the bucket policies gate that to active staff). The route verifies
 * the path sits under the expected prefix and that the object exists before
 * it records anything, so a stray or forged path is never written into the
 * custody trail.
 */

// --- verification visit ----------------------------------------------------

export const arriveRequestSchema = gpsSchema;
export const confirmPassportRequestSchema = gpsSchema;
export const completeVisitRequestSchema = gpsSchema;

export const capturePassportRequestSchema = z.object({
  /** `passports/<bookingId>/<uuid>.<ext>` in the `passport-photos` bucket. */
  storagePath: z.string().min(1).max(512),
});
export type CapturePassportRequest = z.infer<typeof capturePassportRequestSchema>;

export const SEAL_ID_MAX_LENGTH = 120;
export const BAG_WEIGHT_MAX_KG = 99;

export const sealBagRequestSchema = gpsSchema.extend({
  bagId: uuid,
  sealId: z.string().trim().min(1, "Enter the seal id.").max(SEAL_ID_MAX_LENGTH),
  weightKg: z
    .number({ error: "Enter the bag's weight in kg." })
    .positive("Weight must be greater than 0.")
    .max(BAG_WEIGHT_MAX_KG, "Weight must be under 99 kg."),
  /** `bags/<bagId>/<uuid>.<ext>` in the `bag-photos` bucket. Required: no photo, no seal. */
  photoPath: z.string().min(1).max(512),
});
export type SealBagRequest = z.infer<typeof sealBagRequestSchema>;

export const VISIT_EXCEPTION_NOTE_MAX_LENGTH = 500;
export const visitExceptionRequestSchema = gpsSchema.extend({
  reason: visitExceptionReasonSchema,
  note: z.string().trim().max(VISIT_EXCEPTION_NOTE_MAX_LENGTH).optional(),
});
export type VisitExceptionRequest = z.infer<typeof visitExceptionRequestSchema>;

// --- pickup run -------------------------------------------------------------

export const startPickupRequestSchema = gpsSchema;
export const deliverRequestSchema = gpsSchema;
export const handoverRequestSchema = gpsSchema;

export const scanSealRequestSchema = gpsSchema.extend({
  sealValue: z.string().trim().min(1, "Scan or type the seal id."),
});
export type ScanSealRequest = z.infer<typeof scanSealRequestSchema>;

export const scanSealResponseSchema = z.object({
  ok: z.literal(true),
  bagId: uuid,
  scannedCount: z.number().int(),
  totalBags: z.number().int(),
  custodyTransferred: z.boolean(),
});
export type ScanSealResponse = z.infer<typeof scanSealResponseSchema>;

export const pickupExceptionRequestSchema = gpsSchema.extend({
  reason: pickupExceptionReasonSchema,
  note: z.string().trim().max(VISIT_EXCEPTION_NOTE_MAX_LENGTH).optional(),
});
export type PickupExceptionRequest = z.infer<typeof pickupExceptionRequestSchema>;

/** Every other step answers with this; the app refetches the task detail. */
export const stepResponseSchema = okSchema;
export type StepResponse = z.infer<typeof stepResponseSchema>;
