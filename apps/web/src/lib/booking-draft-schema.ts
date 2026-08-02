import { z } from "zod";
import type { AirportCode, CutoffScope, SlotTier } from "@koolee/core";

/**
 * Booking-draft schema, separated from the cookie helpers in
 * `booking-draft.ts` so it can be unit-tested without a Next request context
 * (`next/headers` cannot be imported outside one).
 */

export const AIRPORT_CODES = ["JFK", "LGA", "EWR"] as const;

export const bookingDraftSchema = z.object({
  flightNumber: z.string().min(2).max(10).optional(),
  airlineIata: z.string().length(2).or(z.string().length(3)).optional(),
  departureAirport: z.enum(AIRPORT_CODES).optional(),
  /** ISO-8601 — cookies hold strings, not Dates. */
  departureAt: z.iso.datetime().optional(),
  scope: z.enum(["domestic", "international"]).optional(),
  paxName: z.string().min(1).max(120).optional(),
  /** E.164. Placeholder until customer sign-in is wired. */
  phone: z.string().min(8).max(20).optional(),

  line1: z.string().min(1).max(200).optional(),
  line2: z.string().max(200).optional(),
  city: z.string().min(1).max(100).optional(),
  state: z.string().length(2).optional(),
  zip: z.string().min(5).max(10).optional(),

  bagCount: z.number().int().min(1).max(10).optional(),
  slotId: z.uuid().optional(),
  slotTier: z.enum(["standard_4h", "express_2h", "priority_1h"]).optional(),
  promoCode: z.string().max(40).optional(),

  bookingId: z.uuid().optional(),
});

export type BookingDraft = z.infer<typeof bookingDraftSchema>;

export interface TypedBookingDraft extends Omit<
  BookingDraft,
  "departureAirport" | "scope" | "slotTier"
> {
  departureAirport?: AirportCode;
  scope?: CutoffScope;
  slotTier?: SlotTier;
}
