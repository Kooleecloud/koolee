import "server-only";

import { cookies } from "next/headers";

import { bookingDraftSchema, type TypedBookingDraft } from "./booking-draft-schema";

export { bookingDraftSchema, type BookingDraft, type TypedBookingDraft } from "./booking-draft-schema";

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

/**
 * Which step a draft is ready for — used to bounce a deep link back.
 * Funnel order: ZIP → flight → address → bags → slot → price (→ verify → pay).
 */
export function nextIncompleteStep(draft: TypedBookingDraft): string {
  if (!draft.zip) return "/book/zip";
  if (!draft.flightNumber || !draft.departureAt || !draft.departureAirport) {
    return "/book/flight";
  }
  if (!draft.line1) return "/book/address";
  if (!draft.bagCount) return "/book/bags";
  if (!draft.slotId) return "/book/slot";
  return "/book/price";
}
