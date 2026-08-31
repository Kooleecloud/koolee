"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  adminForceEndShift,
  ConflictError,
  InvalidInputError,
  NotFoundError,
  setStaffCanDrive,
} from "@koolee/core";

import { getCore } from "@/lib/core";
import { requireAdminSession } from "@/lib/session";

export interface ShiftAdminState {
  error?: string;
  ok?: string;
}

function fail(error: unknown, fallback: string): ShiftAdminState {
  if (
    error instanceof ConflictError ||
    error instanceof InvalidInputError ||
    error instanceof NotFoundError
  ) {
    return { error: error.message };
  }
  console.error("[shifts]", fallback, error);
  return { error: fallback };
}

const forceEndSchema = z.object({
  shiftId: z.uuid(),
  reason: z.string().trim().min(1).max(500),
});

/**
 * Ends somebody else's shift.
 *
 * The reason is REQUIRED and is written into the custody trail of every
 * booking this touches — the van broke down, the driver's phone died, they
 * went home without clocking off. Anything still on the truck goes back in the
 * pool; anything already in transit is raised as an exception, because bags in
 * a van whose shift just ended is an incident, not a dispatch gap.
 */
export async function forceEndShiftAction(
  _prev: ShiftAdminState,
  form: FormData,
): Promise<ShiftAdminState> {
  let session;
  try {
    session = await requireAdminSession();
  } catch {
    return { error: "Not signed in as an admin." };
  }

  const parsed = forceEndSchema.safeParse({
    shiftId: String(form.get("shiftId") ?? ""),
    reason: String(form.get("reason") ?? ""),
  });
  if (!parsed.success) {
    return { error: "Say why — it goes into the custody trail of every booking." };
  }

  try {
    const result = await adminForceEndShift(getCore(), {
      shiftId: parsed.data.shiftId,
      adminUserId: session.userId,
      reason: parsed.data.reason,
    });
    revalidatePath("/shifts");
    revalidatePath("/bookings");

    const released = result.released.length;
    const raised = result.raisedExceptions.length;
    return {
      ok:
        released === 0
          ? "Shift ended."
          : `Shift ended. ${released} pickup${released === 1 ? "" : "s"} back in the pool${
              raised > 0
                ? `, ${raised} raised as an exception (bags already in transit)`
                : ""
            }.`,
    };
  } catch (error) {
    return fail(error, "Couldn't end that shift.");
  }
}

const canDriveSchema = z.object({
  userId: z.uuid(),
  canDrive: z.enum(["true", "false"]),
});

/** Grants or revokes the driving capability. Takes effect on their next request. */
export async function setCanDriveAction(
  _prev: ShiftAdminState,
  form: FormData,
): Promise<ShiftAdminState> {
  try {
    await requireAdminSession();
  } catch {
    return { error: "Not signed in as an admin." };
  }

  const parsed = canDriveSchema.safeParse({
    userId: String(form.get("userId") ?? ""),
    canDrive: String(form.get("canDrive") ?? ""),
  });
  if (!parsed.success) return { error: "Something went wrong — reload the page." };

  try {
    const row = await setStaffCanDrive(getCore().db, {
      userId: parsed.data.userId,
      canDrive: parsed.data.canDrive === "true",
    });
    if (!row) return { error: "That person has no staff record." };
    revalidatePath("/staff");
    revalidatePath("/shifts");
    return { ok: row.canDrive ? "Cleared to drive." : "Driving access revoked." };
  } catch (error) {
    return fail(error, "Couldn't change that.");
  }
}
