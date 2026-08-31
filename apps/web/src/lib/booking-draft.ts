import "server-only";

import { cookies } from "next/headers";

import { bookingDraftSchema, type TypedBookingDraft } from "./booking-draft-schema";

export {
  bookingDraftSchema,
  type BookingDraft,
  type TypedBookingDraft,
} from "./booking-draft-schema";

/**
 * Multi-step booking draft, held in a cookie.
 *
 * A cookie rather than a `draft` row on purpose: the flow is abandoned far more
 * often than it is completed, and a table of half-finished bookings is a
 * cleanup job nobody wants. Nothing here is authoritative — every value is
 * re-validated by `createBooking` before a booking exists.
 *
 * No PII beyond a passenger name and address, and the cookie is httpOnly and
 * expires 24 hours after the last step (sliding — see
 * DRAFT_COOKIE_MAX_AGE_SECONDS).
 */

/**
 * Exported for the /book/return route handler, which deletes the cookie on
 * its own redirect response — the one draft-clearing site that cannot use
 * `clearDraft()`'s request-scoped store.
 */
export const DRAFT_COOKIE_NAME = "koolee_draft";

const COOKIE_NAME = DRAFT_COOKIE_NAME;

/**
 * Sliding inactivity TTL: refreshed on every write, so the guest draft
 * survives 24 hours since the LAST step, then the browser drops it. Account
 * holders outlive this via the `booking_drafts` mirror row (7 days), which
 * the /book entry rehydrates from.
 */
export const DRAFT_COOKIE_MAX_AGE_SECONDS = 24 * 3600;

/** Shared with the /book entry route, which sets the cookie on a redirect. */
export function draftCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: DRAFT_COOKIE_MAX_AGE_SECONDS,
  } as const;
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
  store.set(COOKIE_NAME, JSON.stringify(next), draftCookieOptions());

  return next;
}

export async function clearDraft(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

/**
 * The draft's funnel-session id, minted on first use. Guest artifacts
 * (ticket uploads) key on this until the verified user id attaches at the
 * payment gate.
 */
export async function ensureDraftId(): Promise<string> {
  const draft = await readDraft();
  if (draft.draftId) return draft.draftId;
  const draftId = crypto.randomUUID();
  await writeDraft({ draftId });
  return draftId;
}

// Step order, completion, and `nextIncompleteStep` live in the pure module
// `booking-steps.ts` so the client stepper can share them.
