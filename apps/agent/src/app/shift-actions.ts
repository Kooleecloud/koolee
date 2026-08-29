"use server";

import { revalidatePath } from "next/cache";
import {
  ConflictError,
  endShift,
  InvalidInputError,
  NotAuthorizedError,
  NotFoundError,
  startShift,
} from "@koolee/core";

import { getCore } from "@/lib/core";
import { requireAgentSession } from "@/lib/session";

/**
 * Starting and ending a shift.
 *
 * Thin adapters, like the visit actions. Everything that decides whether a
 * shift may open or close lives in core — the capability check, the truck's
 * availability, and the refusal to clock off with bags still on board — because
 * a server action stays a reachable POST whatever the UI renders.
 */

export interface ShiftActionState {
  error?: string;
  ok?: boolean;
}

function fail(error: unknown, fallback: string): ShiftActionState {
  if (
    error instanceof ConflictError ||
    error instanceof NotAuthorizedError ||
    error instanceof NotFoundError ||
    error instanceof InvalidInputError
  ) {
    // These messages are written FOR the driver — "that truck is already out
    // with Nina Petrov", "you still have 2 bags for KOO-7H2QM" — so they are
    // shown verbatim rather than flattened into a generic failure.
    return { error: error.message };
  }
  console.error("[shift]", fallback, error);
  return { error: `${fallback} Check your connection and try again.` };
}

export async function startShiftAction(
  _prev: ShiftActionState,
  form: FormData,
): Promise<ShiftActionState> {
  const truckId = String(form.get("truckId") ?? "");
  if (!truckId) return { error: "Pick a truck first." };

  try {
    const session = await requireAgentSession();
    await startShift(getCore(), { staffUserId: session.userId, truckId });
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (error) {
    return fail(error, "Couldn't start your shift.");
  }
}

export async function endShiftAction(
  _prev: ShiftActionState,
  _form: FormData,
): Promise<ShiftActionState> {
  try {
    const session = await requireAgentSession();
    await endShift(getCore(), { staffUserId: session.userId });
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (error) {
    return fail(error, "Couldn't end your shift.");
  }
}
