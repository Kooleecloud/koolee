"use server";

import { revalidatePath } from "next/cache";
import { startShiftRequestSchema } from "@koolee/api-contract";

import { resolveActionContext } from "@/api/context";
import { endDriverShift, startDriverShift } from "@/api/handlers/shift";
import { actionErrorMessage } from "@/lib/action-error";

/**
 * Starting and ending a shift.
 *
 * Form adapters over the SAME handlers the native app reaches through
 * `/api/v1/shift/start` and `/api/v1/shift/end` (`src/api/handlers/shift.ts`),
 * so a shift opens and closes through one code path whichever client the
 * driver holds. Everything that decides whether a shift may open or close
 * lives in core — the capability check, the truck's availability, and the
 * refusal to clock off with bags still on board — because a server action
 * stays a reachable POST whatever the UI renders.
 */

export interface ShiftActionState {
  error?: string;
  ok?: boolean;
}

function fail(error: unknown, fallback: string): ShiftActionState {
  // One rule, every action file. See `lib/action-error.ts`.
  return { error: actionErrorMessage(error, fallback, "[shift]") };
}

export async function startShiftAction(
  _prev: ShiftActionState,
  form: FormData,
): Promise<ShiftActionState> {
  // The contract wants a uuid; the only way a form fails that is "nothing
  // picked", so the sentence stays the driver's, not zod's.
  const body = startShiftRequestSchema.safeParse({
    truckId: String(form.get("truckId") ?? ""),
  });
  if (!body.success) return { error: "Pick a truck first." };

  try {
    await startDriverShift(await resolveActionContext(), body.data.truckId);
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
    await endDriverShift(await resolveActionContext());
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (error) {
    return fail(error, "Couldn't end your shift.");
  }
}
