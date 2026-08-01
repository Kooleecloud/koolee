"use server";

import { revalidatePath } from "next/cache";
import { applyTransitionForSession, type BookingEvent } from "@koolee/core";

import { getCore } from "@/lib/core";
import { getAdminSession } from "@/lib/session";

/**
 * Manual state override from the ops console.
 *
 * A thin adapter. The state machine decides what is legal; an illegal move
 * comes back as a typed `IllegalTransitionError` and is rendered as a message
 * rather than thrown, because "an operator clicked something that is not
 * possible right now" is an expected outcome, not a fault.
 */

export interface TransitionActionState {
  error?: string;
  /** What the operator could legally do instead. */
  allowed?: string[];
  ok?: string;
}

export async function manualTransition(
  _prev: TransitionActionState,
  form: FormData,
): Promise<TransitionActionState> {
  const bookingId = String(form.get("bookingId") ?? "");
  const event = String(form.get("event") ?? "") as BookingEvent;
  const note = String(form.get("note") ?? "").trim();

  if (!bookingId || !event) return { error: "Missing booking or event." };

  const session = await getAdminSession();
  if (!session) return { error: "Not signed in." };

  let core;
  try {
    core = getCore();
  } catch {
    return { error: "Database not configured." };
  }

  const result = await applyTransitionForSession(core, session, {
    bookingId,
    event,
    metadata: {
      source: "admin_manual_override",
      ...(note ? { note } : {}),
    },
  });

  if (!result.ok) {
    const error = result.error;
    return {
      error: error.message,
      ...("allowed" in error ? { allowed: error.allowed } : {}),
    };
  }

  revalidatePath(`/bookings/${bookingId}`);
  revalidatePath("/bookings");

  return { ok: `Moved to ${result.value.status}.` };
}
