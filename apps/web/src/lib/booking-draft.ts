import "server-only";

import { cookies } from "next/headers";
import { z } from "zod";
import type { AirportCode, CutoffScope, SlotTier } from "@koolee/core";

/**
 * Multi-step booking draft, held in a cookie.
 *
 * A cookie rather than a `draft` row on purpose: the flow is abandoned far more
 * often than it is completed, and a table of half-finished bookings is a
 * cleanup job nobody wants. Nothing here is authoritative — every value is
 * re-validated by `createBooking` before a booking exists.
 *
 * No PII beyond a passenger name and address, and the cookie is httpOnly and
 * expires with the session.
 */

const COOKIE_NAME = "koolee_draft";
const AIRPORT_CODES = ["JFK", "LGA", "EWR"] as const;

export const bookingDraftSchema = z.object({
  flightNumber: z.string().min(2).max(10).optional(),
  airlineIata: z.string().length(2).or(z.string().length(3)).optional(),
  departureAirport: z.enum(AIRPORT_CODES).optional(),
  /** ISO-8601 — cookies hold strings, not Dates. */
  departureAt: z.string().datetime().optional(),
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
  slotId: z.string().uuid().optional(),
  slotTier: z.enum(["standard_4h", "express_2h", "priority_1h"]).optional(),
  promoCode: z.string().max(40).optional(),

  bookingId: z.string().uuid().optional(),
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

export async function readDraft(): Promise<TypedBookingDraft> {
  const store = await cookies();
  const raw = store.get(COOKIE_NAME)?.value;
  if (!raw) return {};

  try {
    const parsed = bookingDraftSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : {};
  } catch {
    // A malformed cookie starts the flow over rather than breaking the page.
    return {};
  }
}

/** Merges a patch into the draft. Call from a server action. */
export async function writeDraft(patch: TypedBookingDraft): Promise<TypedBookingDraft> {
  const current = await readDraft();
  const next = bookingDraftSchema.parse({ ...current, ...patch });

  const store = await cookies();
  store.set(COOKIE_NAME, JSON.stringify(next), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
  });

  return next;
}

export async function clearDraft(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

/** Which step a draft is ready for — used to bounce a deep link back. */
export function nextIncompleteStep(draft: TypedBookingDraft): string {
  if (!draft.flightNumber || !draft.departureAt || !draft.departureAirport) {
    return "/book/flight";
  }
  if (!draft.zip || !draft.line1) return "/book/address";
  if (!draft.bagCount) return "/book/bags";
  if (!draft.slotId) return "/book/slot";
  return "/book/pay";
}
