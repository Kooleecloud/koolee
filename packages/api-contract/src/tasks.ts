import { z } from "zod";

import { isoDateTime, nullableIsoDateTime, uuid } from "./common";
import {
  bookingPhaseSchema,
  bookingStandingSchema,
  cancellationActorSchema,
  paymentStatusSchema,
  visitGateBlockerSchema,
} from "./enums";
import {
  agreementAcceptanceSchema,
  agreementVersionSchema,
  bagSchema,
  bookingSchema,
  custodyEventSchema,
  passportVerificationSchema,
  pickupTaskSchema,
  verificationTaskSchema,
} from "./rows";

/** `services/tasks.ts` TaskBookingContext. */
export const taskBookingContextSchema = z.object({
  id: uuid,
  ref: z.string(),
  paxName: z.string(),
  flightNumber: z.string(),
  departureAirport: z.string(),
  departureAt: isoDateTime,
  bagCount: z.number().int(),
  status: z.string(),
  addressLine1: z.string(),
  addressLine2: z.string().nullable(),
  addressCity: z.string(),
  addressState: z.string().nullable(),
  addressZip: z.string().nullable(),
  addressLat: z.number().nullable(),
  addressLng: z.number().nullable(),
  addressPlaceId: z.string().nullable(),
  contactPhone: z.string().nullable(),
  customerPhone: z.string().nullable(),
  bagDropCutoffAt: nullableIsoDateTime,
});
export type TaskBookingContext = z.infer<typeof taskBookingContextSchema>;

export const scheduledVerificationTaskSchema = z.object({
  task: verificationTaskSchema,
  tz: z.string(),
  booking: taskBookingContextSchema,
});
export const scheduledPickupTaskSchema = z.object({
  task: pickupTaskSchema,
  tz: z.string(),
  booking: taskBookingContextSchema,
});

/**
 * `GET /api/v1/tasks` — everything ever assigned to this driver, including
 * done and failed rows. Grouping into Today / Schedule / History is the app's
 * job (a port of apps/agent `lib/job.ts`), exactly as it is the web page's.
 */
export const assignedTasksResponseSchema = z.object({
  verification: z.array(scheduledVerificationTaskSchema),
  pickup: z.array(scheduledPickupTaskSchema),
  serverTime: isoDateTime,
});
export type AssignedTasksResponse = z.infer<typeof assignedTasksResponseSchema>;

export const pickupAddressSchema = z.object({
  line1: z.string(),
  line2: z.string().nullable(),
  city: z.string(),
  state: z.string(),
  zip: z.string(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  placeId: z.string().nullable(),
});
export type PickupAddress = z.infer<typeof pickupAddressSchema>;

export const taskCustomerSchema = z.object({
  fullName: z.string().nullable(),
  avatarStoragePath: z.string().nullable(),
  phone: z.string().nullable(),
});

/** `services/actionability.ts` BookingActionability, computed server-side. Never re-derive it. */
export const actionabilitySchema = z.object({
  standing: bookingStandingSchema,
  phase: bookingPhaseSchema,
  can: z.object({
    acceptAgreement: z.boolean(),
    uploadPassport: z.boolean(),
    selectDriver: z.boolean(),
    startVisit: z.boolean(),
    startPickup: z.boolean(),
  }),
  blockedReason: z.string().nullable(),
  lateNotice: z.string().nullable(),
  raisesException: z.boolean(),
  pickupWindowEnd: nullableIsoDateTime,
  bagDropCutoffAt: nullableIsoDateTime,
  departureAt: isoDateTime,
});
export type Actionability = z.infer<typeof actionabilitySchema>;

/** `services/staff-travel.ts` StaffTravel — "3.2 miles away · about 15 min". */
export const staffTravelSchema = z.object({
  distanceLabel: z.string(),
  etaLabel: z.string(),
  label: z.string(),
});

export const cancellationSchema = z.object({
  at: isoDateTime,
  by: cancellationActorSchema,
  reason: z.string().nullable(),
});

export const agreementStateSchema = z.object({
  acceptedVersion: agreementVersionSchema.nullable(),
  acceptance: agreementAcceptanceSchema.nullable(),
  currentVersion: agreementVersionSchema.nullable(),
  accepted: z.boolean(),
});

export const identityGateSchema = z.object({
  agreement: agreementStateSchema,
  passport: passportVerificationSchema.nullable(),
  passportConfirmed: z.boolean(),
  blockers: z.array(visitGateBlockerSchema),
  passed: z.boolean(),
});
export type IdentityGate = z.infer<typeof identityGateSchema>;

const detailCommon = {
  booking: bookingSchema,
  bags: z.array(bagSchema),
  timeline: z.array(custodyEventSchema),
  tz: z.string(),
  address: pickupAddressSchema,
  customer: taskCustomerSchema.nullable(),
  /** Signed URL for the customer's avatar, or null. Short-lived. */
  customerAvatarUrl: z.string().nullable(),
  actionability: actionabilitySchema,
  /** Null when the driver has no position yet or the booking has no coordinates. */
  travel: staffTravelSchema.nullable(),
  /** Set only when the booking is terminal by cancellation. */
  cancellation: cancellationSchema.nullable(),
  serverTime: isoDateTime,
};

export const visitDetailSchema = z.object({
  ...detailCommon,
  task: verificationTaskSchema,
  paymentStatus: paymentStatusSchema.nullable(),
  identityGate: identityGateSchema,
  /** 120-second signed URL for the passport capture on file, or null. */
  passportPhotoUrl: z.string().nullable(),
});
export type VisitDetail = z.infer<typeof visitDetailSchema>;

export const pickupDetailSchema = z.object({
  ...detailCommon,
  task: pickupTaskSchema,
  scannedBagIds: z.array(uuid),
  shift: z
    .object({
      id: uuid,
      truckName: z.string(),
    })
    .nullable(),
});
export type PickupDetail = z.infer<typeof pickupDetailSchema>;

/** `GET /api/v1/tasks/:taskId?kind=verification|pickup` — the whole task screen in one read. */
export const taskDetailResponseSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("verification"), visit: visitDetailSchema }),
  z.object({ kind: z.literal("pickup"), pickup: pickupDetailSchema }),
]);
export type TaskDetailResponse = z.infer<typeof taskDetailResponseSchema>;

export const TASK_KINDS = ["verification", "pickup"] as const;
export const taskKindSchema = z.enum(TASK_KINDS);
export type TaskKind = z.infer<typeof taskKindSchema>;
