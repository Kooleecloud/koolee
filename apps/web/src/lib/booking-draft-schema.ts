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
/**
 * A leg we read but did NOT prefill — the other half of a round trip, offered
 * on the review form as a one-click swap. Deliberately the four fields the
 * form needs and nothing else: this rides in a 4 KB cookie.
 */
export const prefillAlternativeSchema = z.object({
  departureAirport: z.enum(AIRPORT_CODES),
  destinationAirport: z.string().length(3).optional(),
  flightNumber: z.string().min(2).max(10).optional(),
  departureAtLocal: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
    .optional(),
  /**
   * This leg's OWN domestic/international reading, derived from the
   * destination country the model read for THIS segment.
   *
   * It is carried per-alternative rather than recomputed on swap because the
   * swap has no document to re-read — and leaving it unset made the review
   * form fall back to "Domestic" on a leg to Paris, which is the same silent
   * fallback the JFK airport default was fixed for. Domestic vs international
   * selects a different bag-drop cutoff (45 vs 60 minutes), so a wrong guess
   * here is an operational error, not a cosmetic one.
   */
  scope: z.enum(["domestic", "international"]).optional(),
});

export type PrefillAlternative = z.infer<typeof prefillAlternativeSchema>;

/**
 * One leg of the itinerary as READ, for the read-back list. Three fields and
 * a route: enough to recognise a flight, small enough that six of them fit
 * the cookie beside everything else.
 */
export const prefillLegSchema = z.object({
  departureAirport: z.string().length(3),
  destinationAirport: z.string().length(3).optional(),
  flightNumber: z.string().min(2).max(10).optional(),
  departureAtLocal: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
    .optional(),
});

export type PrefillLeg = z.infer<typeof prefillLegSchema>;

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
  /** Informational: where the chosen leg lands, shown in the summary line. */
  destinationAirport: z.string().length(3).optional(),
  /** One-way vs round trip, so the form knows whether to offer the swap. */
  documentKind: z.enum(["one_way", "round_trip", "multi_city", "unclear"]).optional(),
  /**
   * WHY this leg was chosen. The review form turns it into a sentence — the
   * difference between a blank airport dropdown and "this ticket departs SFO,
   * and we only serve JFK, LGA and EWR".
   */
  selectionReason: z
    .enum([
      "single_serviced_origin",
      "earliest_upcoming_serviced_origin",
      "ambiguous_serviced_origins",
      "all_serviced_departures_past",
      "no_serviced_origin",
      "no_segments",
    ])
    .optional(),
  /** The origin we read but do not serve. Only set when there is no airport. */
  nonServicedOrigin: z.string().length(3).optional(),
  /** Other NYC-departing legs on the same ticket, for the swap offer. */
  alternatives: z.array(prefillAlternativeSchema).max(2).optional(),
  /**
   * Every leg read off the ticket, in print order — read-only, so the
   * customer can see that a three-leg itinerary was read as three legs.
   * Includes the legs departing airports we do not serve, which is exactly
   * the half `alternatives` cannot carry.
   */
  legs: z.array(prefillLegSchema).max(6).optional(),
  /** Index into `legs` of the leg prefilled above. */
  chosenLegIndex: z.number().int().min(0).max(5).optional(),
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
  /**
   * Where the flight lands. Read off the ticket when we could, or typed on
   * the flight form, and DISPLAY ONLY — nothing operational reads it.
   *
   * It exists so a trip is recognisable months later: a customer scanning
   * their history does not remember "AI144", they remember flying to Delhi.
   * Loosely typed on purpose — a destination is anywhere on earth, not one of
   * the three airports we collect from.
   */
  destinationAirport: z.string().length(3).optional(),
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
  /**
   * The ZIP the coverage answer and the price were computed FOR.
   *
   * Set on the flight step, where the customer first tells us where their
   * bags are and gets told "yes, we come to you". `zip` above then becomes
   * the ADDRESS's ZIP two steps later, and the two are allowed to differ only
   * for as long as it takes the pickup step to reconcile them — after which
   * they are equal, and `createBooking` refuses the booking if they are not.
   * Kept as its own field rather than inferred, because "which ZIP were you
   * quoted?" has no answer once one value has overwritten the other.
   */
  quotedZip: z.string().min(5).max(10).optional(),
  /**
   * The precise point and Places id for the address above, when the customer
   * picked a suggestion rather than typing it.
   *
   * All three travel together and are CLEARED the moment any address field is
   * edited by hand — coordinates that belong to a different address are worse
   * than none, because the price and the driver's map link would both point
   * at the wrong door while looking exactly as confident. The pickup step's
   * form clears them; `submitPickup` never invents them.
   */
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  placeId: z.string().min(1).max(255).optional(),

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
