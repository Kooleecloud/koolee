"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import {
  acceptAgreement,
  cancelBookingByCustomer,
  ConflictError,
  NotAuthorizedError,
  NotFoundError,
  selectDriver,
} from "@koolee/core";

import { getCore } from "@/lib/core";
import { getCustomerSession } from "@/lib/session";

/**
 * Accepting the booking agreement, from the trip page.
 *
 * The version is NOT a form field. `acceptAgreement` resolves the current
 * version server-side, so a page left open across a publish cannot accept the
 * stale terms it happens to be rendering — which is the point of versioning
 * the agreement at all.
 */

export interface AcceptAgreementState {
  error?: string;
  ok?: boolean;
}

/**
 * Evidence is whatever the request actually carried, and nothing else.
 *
 * `x-forwarded-for` is absent in local development and present behind Vercel;
 * when it is absent the key is OMITTED rather than filled with "unknown" or a
 * placeholder address. An invented IP in a record we would produce in a
 * dispute is worse than an honest gap.
 */
async function evidenceFromRequest(): Promise<Record<string, unknown>> {
  const h = await headers();
  const userAgent = h.get("user-agent");
  // First hop is the client; the rest are proxies.
  const forwardedFor = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return {
    ...(userAgent ? { userAgent } : {}),
    ...(forwardedFor ? { ip: forwardedFor } : {}),
  };
}

export async function acceptAgreementAction(
  _prev: AcceptAgreementState,
  form: FormData,
): Promise<AcceptAgreementState> {
  const bookingId = String(form.get("bookingId") ?? "");
  if (!bookingId) return { error: "Something went wrong — please reload the page." };

  const session = await getCustomerSession();
  if (!session) return { error: "Please sign in again to accept." };

  let core;
  try {
    core = getCore();
  } catch {
    return { error: "We can't record that right now. Please try again shortly." };
  }

  try {
    await acceptAgreement(core, {
      bookingId,
      userId: session.userId,
      evidence: await evidenceFromRequest(),
    });
    revalidatePath(`/trips/${bookingId}`);
    return { ok: true };
  } catch (error) {
    if (error instanceof NotFoundError) return { error: "We couldn't find that trip." };
    if (error instanceof NotAuthorizedError) return { error: error.message };
    console.error("[trips] agreement accept failed", error);
    return { error: "We couldn't record that. Please try again." };
  }
}

/* ------------------------------------------------------------------ */
/* Choosing a driver                                                   */
/* ------------------------------------------------------------------ */

export interface SelectDriverState {
  error?: string;
  /**
   * True when the failure was somebody else taking the space (or the driver
   * clocking off) rather than a fault. The UI refreshes the shortlist on this
   * rather than showing a dead end — the customer's next click should be a
   * different driver, not a retry of the same one.
   */
  stale?: boolean;
  ok?: boolean;
}

/**
 * The customer picks their driver.
 *
 * The shift id travels through the form, and that is safe: `selectDriver`
 * re-checks ownership of the booking, the booking's status, the driver's
 * eligibility and the truck's remaining capacity inside its transaction. A
 * tampered shift id gets a `ConflictError`, not an assignment.
 */
export async function selectDriverAction(
  _prev: SelectDriverState,
  form: FormData,
): Promise<SelectDriverState> {
  const bookingId = String(form.get("bookingId") ?? "");
  const shiftId = String(form.get("shiftId") ?? "");
  if (!bookingId || !shiftId) {
    return { error: "Something went wrong — please reload the page." };
  }

  const session = await getCustomerSession();
  if (!session) return { error: "Please sign in again to choose a driver." };

  let core;
  try {
    core = getCore();
  } catch {
    return { error: "We can't do that right now. Please try again shortly." };
  }

  try {
    await selectDriver(core, { bookingId, userId: session.userId, shiftId });
    revalidatePath(`/trips/${bookingId}`);
    return { ok: true };
  } catch (error) {
    if (error instanceof ConflictError) {
      revalidatePath(`/trips/${bookingId}`);
      return { error: error.message, stale: true };
    }
    if (error instanceof NotFoundError) return { error: "We couldn't find that trip." };
    if (error instanceof NotAuthorizedError) return { error: error.message };
    console.error("[trips] driver selection failed", error);
    return { error: "We couldn't book that driver. Please try again." };
  }
}

/* ------------------------------------------------------------------ */
/* Cancelling                                                          */
/* ------------------------------------------------------------------ */

export interface CancelBookingState {
  error?: string;
  ok?: boolean;
}

/**
 * The customer calls off their own booking.
 *
 * The POLICY is not here. `cancelBookingByCustomer` re-checks ownership, the
 * status, the pickup window and whether anything has been captured, then runs
 * the same cancellation the console runs. This action's only job is to carry
 * the session and hand the refusal's own sentence back to the page — the
 * refusal copy is written next to the rule it belongs to, so a page and a
 * server cannot describe the same rule differently.
 *
 * A refusal is a RESULT, not an exception: "your window opened while this page
 * was open" is an ordinary outcome and the customer needs to read it, not a
 * generic apology. Only ownership throws, and it throws `NotFoundError`
 * because saying "not yours" about a booking says the booking exists.
 */
export async function cancelBookingAction(
  _prev: CancelBookingState,
  form: FormData,
): Promise<CancelBookingState> {
  const bookingId = String(form.get("bookingId") ?? "");
  if (!bookingId) return { error: "Something went wrong — please reload the page." };

  const session = await getCustomerSession();
  if (!session) return { error: "Please sign in again to cancel." };

  let core;
  try {
    core = getCore();
  } catch {
    return { error: "We can't do that right now. Please try again shortly." };
  }

  try {
    const result = await cancelBookingByCustomer(core, session, {
      bookingId,
      reason: String(form.get("reason") ?? "").trim() || undefined,
    });
    if (!result.ok) {
      // The page re-renders against the state that refused, so the control
      // disappears at the same moment the sentence explaining it appears.
      revalidatePath(`/trips/${bookingId}`);
      return { error: result.error };
    }
    revalidatePath(`/trips/${bookingId}`);
    revalidatePath("/trips");
    return { ok: true };
  } catch (error) {
    if (error instanceof NotFoundError) return { error: "We couldn't find that trip." };
    console.error("[trips] cancellation failed", error);
    return { error: "We couldn't cancel that. Please try again." };
  }
}
