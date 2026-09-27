import { z } from "zod";

import { isoDateTime, nullableIsoDateTime, uuid } from "./common";
import {
  bookingStatusSchema,
  passportValidityCheckStatusSchema,
  passportVerificationStatusSchema,
  taskStatusSchema,
  userRoleSchema,
} from "./enums";

/**
 * Database rows as they cross the wire. Only the columns a driver screen
 * reads are declared; zod strips the rest, so a column added to the table
 * later never breaks an installed app.
 */

export const verificationTaskSchema = z.object({
  id: uuid,
  bookingId: uuid,
  assigneeUserId: uuid.nullable(),
  status: taskStatusSchema,
  scheduledStart: nullableIsoDateTime,
  scheduledEnd: nullableIsoDateTime,
  startedAt: nullableIsoDateTime,
  completedAt: nullableIsoDateTime,
  notes: z.string().nullable(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type VerificationTaskRow = z.infer<typeof verificationTaskSchema>;

export const pickupTaskSchema = verificationTaskSchema.extend({
  driverShiftId: uuid.nullable(),
});
export type PickupTaskRow = z.infer<typeof pickupTaskSchema>;

export const bookingSchema = z.object({
  id: uuid,
  ref: z.string(),
  userId: uuid,
  status: bookingStatusSchema,
  flightNumber: z.string(),
  airlineIata: z.string(),
  departureAirport: z.string(),
  departureAt: isoDateTime,
  destinationAirport: z.string().nullable(),
  paxName: z.string(),
  pickupLine1: z.string(),
  pickupLine2: z.string().nullable(),
  pickupCity: z.string(),
  pickupState: z.string(),
  pickupZip: z.string(),
  pickupLat: z.number().nullable(),
  pickupLng: z.number().nullable(),
  pickupPlaceId: z.string().nullable(),
  bagCount: z.number().int(),
  pickupWindowStart: nullableIsoDateTime,
  pickupWindowEnd: nullableIsoDateTime,
  displayTz: z.string(),
  contactPhone: z.string().nullable(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type BookingRow = z.infer<typeof bookingSchema>;

export const bagSchema = z.object({
  id: uuid,
  bookingId: uuid,
  ordinal: z.number().int(),
  sealId: z.string().nullable(),
  /** Postgres numeric arrives as a string. */
  weightKg: z.string().nullable(),
  photoUrls: z.array(z.string()),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type BagRow = z.infer<typeof bagSchema>;

export const custodyEventSchema = z.object({
  id: uuid,
  bookingId: uuid,
  bagId: uuid.nullable(),
  actorUserId: uuid.nullable(),
  actorRole: userRoleSchema.nullable(),
  eventType: z.string(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  photoUrl: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  createdAt: isoDateTime,
});
export type CustodyEventRow = z.infer<typeof custodyEventSchema>;

export const passportVerificationSchema = z.object({
  id: uuid,
  bookingId: uuid,
  status: passportVerificationStatusSchema,
  photoStoragePath: z.string().nullable(),
  uploadedAt: nullableIsoDateTime,
  confirmedAt: nullableIsoDateTime,
  confirmedByAgentId: uuid.nullable(),
  validityCheckStatus: passportValidityCheckStatusSchema,
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type PassportVerificationRow = z.infer<typeof passportVerificationSchema>;

export const agreementVersionSchema = z.object({
  id: uuid,
  version: z.number().int(),
  title: z.string(),
  effectiveFrom: isoDateTime,
});
export const agreementAcceptanceSchema = z.object({
  id: uuid,
  bookingId: uuid,
  agreementVersionId: uuid,
  acceptedAt: isoDateTime,
});

export const truckSchema = z.object({
  id: uuid,
  name: z.string(),
  bagCapacity: z.number().int(),
  reservedSpaces: z.number().int(),
  active: z.boolean(),
});
export type TruckRow = z.infer<typeof truckSchema>;

export const driverShiftSchema = z.object({
  id: uuid,
  staffUserId: uuid,
  truckId: uuid,
  startedAt: isoDateTime,
  startedByUserId: uuid.nullable(),
  endedAt: nullableIsoDateTime,
});
export type DriverShiftRow = z.infer<typeof driverShiftSchema>;
