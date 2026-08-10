"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  airportLocalInstant,
  createSlotBlock,
  deleteSlotBlock,
  resolveDisplayTz,
} from "@koolee/core";

import { getCore } from "@/lib/core";
import { requireAdminSession } from "@/lib/session";

/**
 * Window blackouts: create / delete. A block hides every pickup window that
 * overlaps it from customers — existing bookings are untouched, so ops can
 * see what a block strands (the bookings page filtered to that day) before
 * or after placing it.
 *
 * Hours are entered in the airport's local wall clock (all three airports:
 * America/New_York) and converted to instants at this edge — core stores and
 * compares instants only.
 */

export interface BlockActionState {
  error?: string;
  ok?: string;
}


const createSchema = z.object({
  airportCode: z.enum(["JFK", "LGA", "EWR"]),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startHour: z.number().int().min(0).max(23),
  hours: z.number().int().min(1).max(24),
  reason: z.string().max(200).optional(),
});

export async function createBlock(
  _prev: BlockActionState,
  form: FormData,
): Promise<BlockActionState> {
  let session;
  try {
    session = await requireAdminSession();
  } catch {
    return { error: "Not signed in as an admin." };
  }

  const parsed = createSchema.safeParse({
    airportCode: String(form.get("airportCode") ?? ""),
    day: String(form.get("day") ?? ""),
    startHour: Number(form.get("startHour")),
    hours: Number(form.get("hours")),
    reason: String(form.get("reason") ?? "").trim() || undefined,
  });
  if (!parsed.success) {
    return { error: "Pick an airport, a date, a start hour, and a length." };
  }
  const { airportCode, day, startHour, hours, reason } = parsed.data;

  let core;
  try {
    core = getCore();
  } catch {
    return { error: "Database not configured." };
  }

  try {
    // "2 PM at JFK" must mean 2 PM AT JFK — resolve the hour against the
    // zone of the airport being blocked, not a console-wide constant.
    const tz = await resolveDisplayTz(core.db, airportCode);
    const blockStart = airportLocalInstant(day, startHour, tz);
    const blockEnd = new Date(blockStart.getTime() + hours * 60 * 60 * 1000);
    await createSlotBlock(core, {
      airportCode,
      blockStart,
      blockEnd,
      reason: reason ?? null,
      createdBy: session.userId,
    });
  } catch (error) {
    console.error("[blocks] create failed", error);
    return { error: "Could not create the block. Try again." };
  }

  revalidatePath("/blocks");
  return { ok: "Block created — those windows are hidden from customers." };
}

export async function removeBlock(
  _prev: BlockActionState,
  form: FormData,
): Promise<BlockActionState> {
  try {
    await requireAdminSession();
  } catch {
    return { error: "Not signed in as an admin." };
  }

  const id = String(form.get("id") ?? "");
  if (!id) return { error: "Missing block id." };

  let core;
  try {
    core = getCore();
  } catch {
    return { error: "Database not configured." };
  }

  try {
    const deleted = await deleteSlotBlock(core, id);
    if (!deleted) return { error: "That block no longer exists." };
  } catch (error) {
    console.error("[blocks] delete failed", error);
    return { error: "Could not remove the block. Try again." };
  }

  revalidatePath("/blocks");
  return { ok: "Block removed — those windows are bookable again." };
}
