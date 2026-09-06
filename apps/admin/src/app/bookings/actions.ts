"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  adminReassignPickup,
  adminUnassignPickup,
  applyTransitionForSession,
  assignAgentToBooking,
  autoAssignBooking,
  ConflictError,
  EXCEPTION_RESOLUTIONS,
  NotFoundError,
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

const reassignPickupSchema = z.object({
  bookingId: z.uuid(),
  shiftId: z.uuid(),
  override: z.boolean(),
});

/**
 * Move a pickup to a different driver's shift.
 *
 * The customer normally chooses; this is for when they cannot, or when the one
 * they chose fell through. It runs the SAME transaction, lock and capacity
 * recount as `selectDriver` — the two are the same operation with a different
 * actor, and letting them drift into two concurrency stories is how a van ends
 * up overloaded.
 *
 * The override waives the zone and capacity rules and is RECORDED on the
 * custody event with the exact rule it waived, so a van that arrived overloaded
 * traces back to a decision rather than to a bug.
 */
export async function reassignPickup(
  _prev: DispatchActionState,
  form: FormData,
): Promise<DispatchActionState> {
  const session = await getAdminSession();
  if (!session) return { error: "Not signed in." };

  const parsed = reassignPickupSchema.safeParse({
    bookingId: String(form.get("bookingId") ?? ""),
    shiftId: String(form.get("shiftId") ?? ""),
    override: form.get("override") === "on",
  });
  if (!parsed.success) return { error: "Pick a driver who is on shift." };

  let core;
  try {
    core = getCore();
  } catch {
    return { error: "Database not configured." };
  }

  try {
    const result = await adminReassignPickup(core, {
      bookingId: parsed.data.bookingId,
      shiftId: parsed.data.shiftId,
      adminUserId: session.userId,
      override: parsed.data.override,
    });
    revalidatePath(`/bookings/${parsed.data.bookingId}`);
    revalidatePath("/bookings");
    revalidatePath("/shifts");
    return {
      ok:
        result.overrode.length > 0
          ? `Moved, overriding ${result.overrode.join(" and ")}. The override is on the custody trail.`
          : "Moved to that driver.",
    };
  } catch (error) {
    if (error instanceof ConflictError || error instanceof NotFoundError) {
      return { error: error.message };
    }
    console.error("[dispatch] pickup reassignment failed", error);
    return { error: "Couldn't move that pickup." };
  }
}

const unassignPickupSchema = z.object({
  bookingId: z.uuid(),
  reason: z.string().trim().max(500).optional(),
});

/**
 * Take the driver off a pickup and leave it unassigned.
 *
 * The console could only ever MOVE a pickup from one shift to another, so an
 * admin undoing an assignment — a driver called in sick, a van broke down, the
 * customer picked somebody who then went off shift — had to park the booking
 * on some other driver who was not going to do it either. Every one of those
 * is a lie told to the dispatch board, and the board is what decides who gets
 * chased. An unassigned sealed booking is not a gap in the record; it is
 * exactly what the at-risk flag exists to surface.
 *
 * The reason is OPTIONAL, unlike force-end's. Force-ending a shift touches
 * every booking on it and strands bags; this touches one booking that has not
 * been collected yet.
 */
export async function unassignPickup(
  _prev: DispatchActionState,
  form: FormData,
): Promise<DispatchActionState> {
  const session = await getAdminSession();
  if (!session) return { error: "Not signed in." };

  const raw = String(form.get("reason") ?? "").trim();
  const parsed = unassignPickupSchema.safeParse({
    bookingId: String(form.get("bookingId") ?? ""),
    ...(raw ? { reason: raw } : {}),
  });
  if (!parsed.success) return { error: "Couldn't read that request." };

  let core;
  try {
    core = getCore();
  } catch {
    return { error: "Database not configured." };
  }

  try {
    await adminUnassignPickup(core, {
      bookingId: parsed.data.bookingId,
      adminUserId: session.userId,
      ...(parsed.data.reason ? { reason: parsed.data.reason } : {}),
    });
    revalidatePath(`/bookings/${parsed.data.bookingId}`);
    revalidatePath("/bookings");
    revalidatePath("/shifts");
    return {
      ok: "Driver removed. The pickup is back in the pool and shows as awaiting a driver.",
    };
  } catch (error) {
    if (error instanceof ConflictError || error instanceof NotFoundError) {
      return { error: error.message };
    }
    console.error("[dispatch] pickup unassign failed", error);
    return { error: "Couldn't remove that driver." };
  }
}
