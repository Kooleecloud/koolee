"use server";

import { revalidatePath } from "next/cache";
import { endShift, startShift } from "@koolee/core";

import { actionErrorMessage } from "@/lib/action-error";
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
  // One rule, two action files. See `lib/action-error.ts`.
  return { error: actionErrorMessage(error, fallback, "[shift]") };
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
