import { z } from "zod";

/**
 * Enums mirrored from @koolee/db and @koolee/core. The app cannot import
 * either (they pull in Postgres), so the values live here too. A parity test
 * in apps/agent (`src/api/contract-parity.test.ts`) fails the build if any of
 * these drift from the source of truth.
 */

export const BOOKING_STATUSES = [
  "draft",
  "paid",
  "agent_assigned",
  "verified_sealed",
  "awaiting_pickup",
  "in_transit",
  "delivered_to_bagdrop",
  "completed",
  "exception",
  "cancelled",
] as const;
export const bookingStatusSchema = z.enum(BOOKING_STATUSES);
export type BookingStatus = z.infer<typeof bookingStatusSchema>;

export const TASK_STATUSES = [
  "pending",
  "assigned",
  "in_progress",
  "done",
  "failed",
] as const;
export const taskStatusSchema = z.enum(TASK_STATUSES);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

export const PAYMENT_STATUSES = [
  "pending",
  "authorized",
  "captured",
  "refunded",
  "cancelled",
  "failed",
] as const;
export const paymentStatusSchema = z.enum(PAYMENT_STATUSES);

export const PASSPORT_VERIFICATION_STATUSES = [
  "pending",
  "customer_uploaded",
  "agent_confirmed",
  "failed",
] as const;
export const passportVerificationStatusSchema = z.enum(PASSPORT_VERIFICATION_STATUSES);

export const PASSPORT_VALIDITY_CHECK_STATUSES = [
  "not_checked",
  "passed",
  "failed",
] as const;
export const passportValidityCheckStatusSchema = z.enum(PASSPORT_VALIDITY_CHECK_STATUSES);

export const USER_ROLES = ["customer", "agent", "driver", "admin"] as const;
export const userRoleSchema = z.enum(USER_ROLES);

/** `services/agent-visit.ts` VISIT_EXCEPTION_REASONS. */
export const VISIT_EXCEPTION_REASONS = [
  "customer_not_home",
  "customer_id_mismatch",
  "bags_refused",
  "unsafe_conditions",
  "other",
] as const;
export const visitExceptionReasonSchema = z.enum(VISIT_EXCEPTION_REASONS);
export type VisitExceptionReason = z.infer<typeof visitExceptionReasonSchema>;

/** `services/pickup.ts` PICKUP_EXCEPTION_REASONS. */
export const PICKUP_EXCEPTION_REASONS = [
  "seal_mismatch",
  "bag_count_mismatch",
  "customer_not_home",
  "vehicle_problem",
  "bagdrop_refused",
  "other",
] as const;
export const pickupExceptionReasonSchema = z.enum(PICKUP_EXCEPTION_REASONS);
export type PickupExceptionReason = z.infer<typeof pickupExceptionReasonSchema>;

/** `services/actionability.ts`. */
export const BOOKING_STANDINGS = [
  "active",
  "in_transit",
  "handed_over",
  "exception",
  "terminal",
] as const;
export const bookingStandingSchema = z.enum(BOOKING_STANDINGS);
export const BOOKING_PHASES = [
  "before_window_end",
  "running_late",
  "missed_cutoff",
  "departed",
] as const;
export const bookingPhaseSchema = z.enum(BOOKING_PHASES);

export const VISIT_GATE_BLOCKERS = [
  "agreement_not_accepted",
  "passport_not_confirmed",
  "no_agreement_published",
] as const;
export const visitGateBlockerSchema = z.enum(VISIT_GATE_BLOCKERS);

export const CANCELLATION_ACTORS = ["customer", "staff", "system"] as const;
export const cancellationActorSchema = z.enum(CANCELLATION_ACTORS);
