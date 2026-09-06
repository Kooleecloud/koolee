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

/* ------------------------------------------------------------------ */
/* The set-aside draft                                                  */
/* ------------------------------------------------------------------ */

/**
 * Where a draft goes when somebody starts a NEW booking over an old one.
 *
 * THE PROBLEM THIS SOLVES, and why it needs a second cookie. `/book` used to
 * resume unconditionally: pressing "Book a pickup" dropped you back into a
 * half-finished booking from three days ago, at whatever step it had reached,
 * with its flight and its address prefilled. For somebody genuinely resuming
 * that is exactly right, and for somebody booking a second trip it is
 * baffling — they asked for a new booking and got somebody else's answer.
 *
 * So a fresh entry now starts CLEAN. But "clean" and "offer to resume" cannot
 * both be true of one cookie: clearing the draft destroys the thing the offer
 * would restore, and keeping it means the form is prefilled and the entry was
 * not clean after all. So the old draft is MOVED here — the live draft really
 * is empty, the funnel really does start at the first step with an empty form,
 * and one tap puts the old one back.
 *
 * SHORTER-LIVED than the draft it came from, deliberately. This is "you were
 * in the middle of something a moment ago", not an archive: an hour is long
 * enough to change your mind and short enough that it never surprises anybody
 * a day later. Account holders keep the real safety net regardless — the
 * `booking_drafts` mirror row lives seven days.
 */
export const STASH_COOKIE_NAME = "koolee_draft_prev";

const STASH_MAX_AGE_SECONDS = 3600;

export function stashCookieOptions() {
  return { ...draftCookieOptions(), maxAge: STASH_MAX_AGE_SECONDS } as const;
}

/** Sets a draft aside so a fresh entry can start empty without losing it. */
export async function stashDraft(draft: TypedBookingDraft): Promise<void> {
  const store = await cookies();
  store.set(STASH_COOKIE_NAME, JSON.stringify(draft), stashCookieOptions());
}

/** The set-aside draft, or null. Parsed the same way the live one is. */
export async function readStashedDraft(): Promise<TypedBookingDraft | null> {
  const store = await cookies();
  const raw = store.get(STASH_COOKIE_NAME)?.value;
  if (!raw) return null;
  try {
    const parsed = bookingDraftSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function clearStashedDraft(): Promise<void> {
  const store = await cookies();
  store.delete(STASH_COOKIE_NAME);
}

/**
 * Puts a set-aside draft back as the live one.
 *
 * Replaces rather than merges: the live draft is empty by construction at
 * this point (that is what "started clean" means), and merging would be a way
 * for a field typed into the fresh form to survive a decision to abandon it.
 */
export async function restoreStashedDraft(): Promise<TypedBookingDraft | null> {
  const stashed = await readStashedDraft();
  if (!stashed) return null;
  const store = await cookies();
  store.set(COOKIE_NAME, JSON.stringify(stashed), draftCookieOptions());
  store.delete(STASH_COOKIE_NAME);
  return stashed;
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
