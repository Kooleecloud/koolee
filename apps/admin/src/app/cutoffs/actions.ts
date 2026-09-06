"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  createAirlineCutoff,
  InvalidInputError,
  NotFoundError,
  updateAirlineCutoff,
  type AirportCode,
  type CutoffScope,
} from "@koolee/core";

import { getCore } from "@/lib/core";
import { requireAdminSession } from "@/lib/session";

/**
 * The bag-drop cutoff matrix.
 *
 * The most consequential form in the console: every sellable pickup window is
 * derived from these numbers, and a cutoff set too generously sells a booking
 * that cannot make its flight. The seed writes all 128 rows at a flat 45/60
 * minutes and stamps each `seed: placeholder — VERIFY …`; core refuses to save
 * that text back, so a row can only stop being a placeholder by somebody
 * saying where the real number came from.
 */

export interface CutoffActionState {
  error?: string;
  ok?: string;
}

function fail(error: unknown, fallback: string): CutoffActionState {
  if (error instanceof InvalidInputError || error instanceof NotFoundError) {
    return { error: error.message };
  }
  console.error("[cutoffs]", fallback, error);
  return { error: fallback };
}

const updateSchema = z.object({
  id: z.uuid(),
  minutes: z.coerce.number().int(),
  source: z.string().trim().min(1).max(500),
});

export async function updateCutoffAction(
  _prev: CutoffActionState,
  form: FormData,
): Promise<CutoffActionState> {
  try {
    await requireAdminSession();
  } catch {
    return { error: "Not signed in as an admin." };
  }

  const parsed = updateSchema.safeParse({
    id: String(form.get("id") ?? ""),
    minutes: String(form.get("minutes") ?? ""),
    source: String(form.get("source") ?? ""),
  });
  if (!parsed.success) {
    return { error: "Give the cutoff in minutes and say where the number came from." };
  }

  try {
    const row = await updateAirlineCutoff(getCore().db, {
      id: parsed.data.id,
      cutoffMinutesBeforeDeparture: parsed.data.minutes,
      source: parsed.data.source,
    });
    revalidatePath("/cutoffs");
    return {
      ok: `${row.airlineIata} ${row.scope} at ${row.airportCode}: ${row.cutoffMinutesBeforeDeparture} min.`,
    };
  } catch (error) {
    return fail(error, "Couldn't save that cutoff.");
  }
}

const createSchema = z.object({
  airlineIata: z.string().trim().min(2).max(3),
  airportCode: z.enum(["JFK", "LGA", "EWR"]),
  scope: z.enum(["domestic", "international"]),
  minutes: z.coerce.number().int(),
  source: z.string().trim().min(1).max(500),
});

export async function createCutoffAction(
  _prev: CutoffActionState,
  form: FormData,
): Promise<CutoffActionState> {
  try {
    await requireAdminSession();
  } catch {
    return { error: "Not signed in as an admin." };
  }

  const parsed = createSchema.safeParse({
    airlineIata: String(form.get("airlineIata") ?? ""),
    airportCode: String(form.get("airportCode") ?? ""),
    scope: String(form.get("scope") ?? ""),
    minutes: String(form.get("minutes") ?? ""),
    source: String(form.get("source") ?? ""),
  });
  if (!parsed.success) {
    return { error: "Check the airline code, the airport, the scope and the minutes." };
  }

  try {
    const row = await createAirlineCutoff(getCore().db, {
      airlineIata: parsed.data.airlineIata,
      airportCode: parsed.data.airportCode as AirportCode,
      scope: parsed.data.scope as CutoffScope,
      cutoffMinutesBeforeDeparture: parsed.data.minutes,
      source: parsed.data.source,
    });
    revalidatePath("/cutoffs");
    return { ok: `${row.airlineIata} added at ${row.airportCode}.` };
  } catch (error) {
    return fail(error, "Couldn't add that cutoff.");
  }
}
