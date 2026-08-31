"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  ConflictError,
  createTruck,
  InvalidInputError,
  NotFoundError,
  updateTruck,
} from "@koolee/core";

import { getCore } from "@/lib/core";
import { requireAdminSession } from "@/lib/session";

/**
 * The fleet.
 *
 * A truck is a name and a bag capacity. `reserved_spaces` is editable and
 * UNWIRED — nothing reads it, and the form says so — because the number needs
 * a home before it needs an enforcer, and a column quietly doing nothing is
 * only safe if the screen that edits it admits as much.
 */

export interface TruckActionState {
  error?: string;
  ok?: string;
}

function fail(error: unknown, fallback: string): TruckActionState {
  if (
    error instanceof ConflictError ||
    error instanceof InvalidInputError ||
    error instanceof NotFoundError
  ) {
    return { error: error.message };
  }
  console.error("[trucks]", fallback, error);
  return { error: fallback };
}

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  bagCapacity: z.coerce.number().int().min(1).max(500),
  reservedSpaces: z.coerce.number().int().min(0).max(500),
});

export async function createTruckAction(
  _prev: TruckActionState,
  form: FormData,
): Promise<TruckActionState> {
  try {
    await requireAdminSession();
  } catch {
    return { error: "Not signed in as an admin." };
  }

  const parsed = createSchema.safeParse({
    name: String(form.get("name") ?? ""),
    bagCapacity: String(form.get("bagCapacity") ?? ""),
    reservedSpaces: String(form.get("reservedSpaces") ?? "0"),
  });
  if (!parsed.success) {
    return { error: "Give the truck a name and a capacity of at least one bag." };
  }

  try {
    const truck = await createTruck(getCore().db, parsed.data);
    revalidatePath("/trucks");
    return { ok: `${truck.name} added.` };
  } catch (error) {
    return fail(error, "Couldn't add that truck.");
  }
}

const updateSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).max(120),
  bagCapacity: z.coerce.number().int().min(1).max(500),
  reservedSpaces: z.coerce.number().int().min(0).max(500),
});

export async function updateTruckAction(
  _prev: TruckActionState,
  form: FormData,
): Promise<TruckActionState> {
  try {
    await requireAdminSession();
  } catch {
    return { error: "Not signed in as an admin." };
  }

  const parsed = updateSchema.safeParse({
    id: String(form.get("id") ?? ""),
    name: String(form.get("name") ?? ""),
    bagCapacity: String(form.get("bagCapacity") ?? ""),
    reservedSpaces: String(form.get("reservedSpaces") ?? "0"),
  });
  if (!parsed.success) return { error: "Check the name and the capacity." };

  try {
    const truck = await updateTruck(getCore().db, parsed.data);
    revalidatePath("/trucks");
    return { ok: `${truck.name} saved.` };
  } catch (error) {
    return fail(error, "Couldn't save that truck.");
  }
}

export async function setTruckActiveAction(
  _prev: TruckActionState,
  form: FormData,
): Promise<TruckActionState> {
  try {
    await requireAdminSession();
  } catch {
    return { error: "Not signed in as an admin." };
  }

  const id = String(form.get("id") ?? "");
  const active = String(form.get("active") ?? "") === "true";
  if (!id) return { error: "Something went wrong — reload the page." };

  try {
    const truck = await updateTruck(getCore().db, { id, active });
    revalidatePath("/trucks");
    return {
      ok: `${truck.name} ${active ? "back in service" : "taken out of service"}.`,
    };
  } catch (error) {
    // The interesting failure: the van is on the road with somebody in it.
    // Core names the driver; that sentence is shown as-is.
    return fail(error, "Couldn't change that truck.");
  }
}
