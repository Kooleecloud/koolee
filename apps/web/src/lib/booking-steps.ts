import type { TypedBookingDraft } from "./booking-draft-schema";

/**
 * The funnel's four visible steps, in order. Pure module (no `next/headers`)
 * so both the client stepper and server guards can import it, and so the
 * unlock logic is unit-testable.
 *
 * Progression model: a step is UNLOCKED when every step before it is
 * complete. Completed steps stay clickable so a customer can jump back to
 * edit (e.g. fix the flight from the pay step) without re-walking the funnel;
 * locked steps are neither linked nor named in the stepper.
 */
export const BOOKING_STEPS = [
  { href: "/book/flight", label: "Flight", also: [] as string[] },
  { href: "/book/pickup", label: "Pickup", also: [] as string[] },
  { href: "/book/slot", label: "Window", also: [] as string[] },
  // The verification gate lives inside this step; highlight "Review & pay".
  { href: "/book/pay", label: "Review & pay", also: ["/book/verify"] },
] as const;

export type BookingStepHref = (typeof BOOKING_STEPS)[number]["href"];

/**
 * Per-step completion, index-aligned with BOOKING_STEPS. The final step never
 * reads complete: finishing it creates a booking, which clears the draft.
 */
export function stepCompletion(draft: TypedBookingDraft): boolean[] {
  return [
    Boolean(
      draft.zip &&
        draft.flightNumber &&
        draft.departureAirport &&
        draft.departureAt &&
        draft.paxName,
    ),
    Boolean(draft.line1 && draft.city && draft.state && draft.bagCount),
    Boolean(draft.windowStart && draft.windowEnd),
    false,
  ];
}

/** A step is unlocked when every step before it is complete. */
export function stepIsUnlocked(
  draft: TypedBookingDraft,
  href: BookingStepHref,
): boolean {
  const index = BOOKING_STEPS.findIndex((step) => step.href === href);
  return stepCompletion(draft).slice(0, index).every(Boolean);
}

/** Whether a draft holds anything a customer would care about resuming. */
export function draftHasProgress(draft: TypedBookingDraft): boolean {
  return Boolean(
    draft.zip || draft.flightNumber || draft.line1 || draft.bagCount || draft.windowStart,
  );
}

/**
 * Where a draft should resume — the first incomplete step. Used to bounce
 * deep links off locked steps and to land edits back at the frontier.
 */
export function nextIncompleteStep(draft: TypedBookingDraft): BookingStepHref {
  const completion = stepCompletion(draft);
  for (const [index, step] of BOOKING_STEPS.entries()) {
    if (!completion[index]) return step.href;
  }
  // Unreachable: the pay step never reads complete.
  return "/book/pay";
}
