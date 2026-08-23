"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  applyTransitionForSession,
  assignAgentToBooking,
  autoAssignBooking,
  EXCEPTION_RESOLUTIONS,
  resolveExceptionBooking,
  type BookingEvent,
} from "@koolee/core";

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

/* ------------------------------------------------------------------ */
/* Assignment                                                          */
/* ------------------------------------------------------------------ */

export interface DispatchActionState {
  error?: string;
  ok?: string;
}

const assignSchema = z.object({
  bookingId: z.uuid(),
  agentUserId: z.uuid(),
});

/**
 * Assign / reassign an agent to a booking's tasks. The core service
 * validates the agent is active staff, moves `paid → agent_assigned`
 * through the matrix on first assignment, and appends a custody event on
 * reassignment. All with this admin's real actor id.
 */
export async function assignAgent(
  _prev: DispatchActionState,
  form: FormData,
): Promise<DispatchActionState> {
  const session = await getAdminSession();
  if (!session) return { error: "Not signed in." };

  const parsed = assignSchema.safeParse({
    bookingId: String(form.get("bookingId") ?? ""),
    agentUserId: String(form.get("agentUserId") ?? ""),
  });
  if (!parsed.success) return { error: "Pick an agent." };

  let core;
  try {
    core = getCore();
  } catch {
    return { error: "Database not configured." };
  }

  const result = await assignAgentToBooking(core, session, parsed.data);
  if (!result.ok) return { error: result.error };

  revalidatePath(`/bookings/${parsed.data.bookingId}`);
  revalidatePath("/bookings");
  return { ok: result.reassigned ? "Reassigned." : "Assigned." };
}

/**
 * Auto-assign one booking from the console.
 *
 * The same core call the automatic path uses, with this admin stamped on the
 * custody event instead of a null system actor — a dispatcher pressing the
 * button is a human decision and the trail should say so. Refusals ("nobody
 * covers that ZIP") are shown as-is: the operator is about to assign somebody
 * manually and needs to know why the machine wouldn't.
 */
export async function autoAssign(
  _prev: DispatchActionState,
  form: FormData,
): Promise<DispatchActionState> {
  const session = await getAdminSession();
  if (!session) return { error: "Not signed in." };

  const bookingId = String(form.get("bookingId") ?? "");
  if (!bookingId) return { error: "Missing booking." };

  let core;
  try {
    core = getCore();
  } catch {
    return { error: "Database not configured." };
  }

  const result = await autoAssignBooking(core, { bookingId, actor: session });
  if (!result.ok) return { error: result.detail };

  revalidatePath(`/bookings/${bookingId}`);
  revalidatePath("/bookings");
  return {
    ok: `Assigned — picked from ${result.candidatesConsidered} covering agent${
      result.candidatesConsidered === 1 ? "" : "s"
    }.`,
  };
}

/* ------------------------------------------------------------------ */
/* Exception resolution                                                */
/* ------------------------------------------------------------------ */

const resolveSchema = z.object({
  bookingId: z.uuid(),
  resolution: z.enum(EXCEPTION_RESOLUTIONS),
  reason: z.string().min(3, "A reason is required.").max(500),
});

/**
 * Resolve an exception through the matrix's defined transitions only —
 * cancel+refund (Phase 5 path), resume transit, or force complete. The
 * REQUIRED reason lands in the compensating custody event; history is
 * never edited.
 */
export async function resolveException(
  _prev: DispatchActionState,
  form: FormData,
): Promise<DispatchActionState> {
  const session = await getAdminSession();
  if (!session) return { error: "Not signed in." };

  const parsed = resolveSchema.safeParse({
    bookingId: String(form.get("bookingId") ?? ""),
    resolution: String(form.get("resolution") ?? ""),
    reason: String(form.get("reason") ?? "").trim(),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  }

  let core;
  try {
    core = getCore();
  } catch {
    return { error: "Database not configured." };
  }

  const result = await resolveExceptionBooking(core, session, parsed.data);
  if (!result.ok) return { error: result.error };

  revalidatePath(`/bookings/${parsed.data.bookingId}`);
  revalidatePath("/bookings");
  revalidatePath("/exceptions");
  return { ok: "Resolved — the custody trail carries the reason." };
}
