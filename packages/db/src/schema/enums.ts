import { pgEnum } from "drizzle-orm/pg-core";

/** Airport codes Koolee currently serves. */
export const AIRPORT_CODES = ["JFK", "LGA", "EWR"] as const;
export type AirportCode = (typeof AIRPORT_CODES)[number];

export const userRoleEnum = pgEnum("user_role", ["customer", "agent", "driver", "admin"]);
export type UserRole = (typeof userRoleEnum.enumValues)[number];

export const cutoffScopeEnum = pgEnum("cutoff_scope", ["domestic", "international"]);
export type CutoffScope = (typeof cutoffScopeEnum.enumValues)[number];

/**
 * Booking lifecycle. The legal transitions between these values live in
 * `@koolee/core` (booking state machine) — not here. Postgres only guarantees
 * the value is one of the set.
 */
export const bookingStatusEnum = pgEnum("booking_status", [
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
]);
export type BookingStatus = (typeof bookingStatusEnum.enumValues)[number];

export const taskStatusEnum = pgEnum("task_status", [
  "pending",
  "assigned",
  "in_progress",
  "done",
  "failed",
]);
export type TaskStatus = (typeof taskStatusEnum.enumValues)[number];

export const slotTierEnum = pgEnum("slot_tier", [
  "standard_4h",
  "express_2h",
  "priority_1h",
]);
export type SlotTier = (typeof slotTierEnum.enumValues)[number];

export const paymentStatusEnum = pgEnum("payment_status", [
  /** Intent created, awaiting client confirmation in the browser. */
  "pending",
  "authorized",
  "captured",
  "refunded",
  "cancelled",
  "failed",
]);
export type PaymentStatus = (typeof paymentStatusEnum.enumValues)[number];

export const waitlistSourceEnum = pgEnum("waitlist_source", [
  /** The marketing /waitlist page. */
  "waitlist_page",
  /** The out-of-area email capture inside the booking funnel. */
  "booking_out_of_area",
]);
export type WaitlistSource = (typeof waitlistSourceEnum.enumValues)[number];
