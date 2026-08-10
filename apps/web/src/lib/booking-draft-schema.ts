import { z } from "zod";
import type { AirportCode, CutoffScope } from "@koolee/core";

/**
 * Booking-draft schema, separated from the cookie helpers in
 * `booking-draft.ts` so it can be unit-tested without a Next request context
 * (`next/headers` cannot be imported outside one).
 */

export const AIRPORT_CODES = ["JFK", "LGA", "EWR"] as const;

/**
 * RAW ticket-extraction output, quarantined under its own key.
 *
 * Only the flight REVIEW FORM reads this — as editable defaults. It is never
 * read by `confirmBooking`, `syncDraftRow`, or any other booking-write path:
 * pressing Continue on the review form (`submitFlight`) is what promotes the
 * user-confirmed values into the real draft keys and clears this. That is
 * the mechanism behind the hard rule that extracted values never persist to
 * booking fields.
 */
export const ticketPrefillSchema = z.object({
  flightNumber: z.string().min(2).max(10).optional(),
  airlineIata: z.string().min(2).max(3).optional(),
  departureAirport: z.enum(AIRPORT_CODES).optional(),
  /** Local wall-clock `YYYY-MM-DDTHH:mm` as extracted — not trusted. */
  departureAtLocal: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
    .optional(),
  paxName: z.string().min(1).max(120).optional(),
  scope: z.enum(["domestic", "international"]).optional(),
  confidence: z.enum(["high", "low"]),
  uploadId: z.uuid().optional(),
});

export type TicketPrefill = z.infer<typeof ticketPrefillSchema>;

export const bookingDraftSchema = z.object({
  /**
   * Funnel-session id, minted on first cookie write. Keys guest artifacts
   * (ticket uploads) until the user id attaches at the payment gate.
   */
  draftId: z.uuid().optional(),
  /** Quarantined extraction output — review-form defaults ONLY (see above). */
  ticketPrefill: ticketPrefillSchema.optional(),

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
  /**
   * The picked pickup window — a clock-aligned one-hour span, ISO-8601.
   * Both travel together (a submit writes or clears the pair).
   */
  windowStart: z.iso.datetime().optional(),
  windowEnd: z.iso.datetime().optional(),
  promoCode: z.string().max(40).optional(),

  bookingId: z.uuid().optional(),
});

export type BookingDraft = z.infer<typeof bookingDraftSchema>;

export interface TypedBookingDraft extends Omit<BookingDraft, "departureAirport" | "scope"> {
  departureAirport?: AirportCode;
  scope?: CutoffScope;
}
