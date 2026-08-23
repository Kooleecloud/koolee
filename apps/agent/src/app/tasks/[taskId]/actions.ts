"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  arriveAtVisit,
  completeVerificationVisit,
  ConflictError,
  NotFoundError,
  recordBagSealed,
  recordIdentityVerified,
  reportVisitException,
  VISIT_EXCEPTION_REASONS,
} from "@koolee/core";

import { getCore } from "@/lib/core";
import { requireAgentSession } from "@/lib/session";
import { getSupabaseServerClient } from "@/lib/supabase/server";

/**
 * The verification visit's server actions — thin adapters over the core
 * flow. Every step writes its custody event in core with the REAL agent id
 * (the session resolved here per request).
 *
 * Photo uploads: server-side, to the PRIVATE `bag-photos` bucket, as the
 * signed-in agent over the anon key (this app holds no service key — the
 * storage RLS policies in migration 0008 gate writes to active staff).
 * There is no offline sync: a failed step returns a clear error and the
 * agent retries when connectivity is back.
 */

export interface VisitActionState {
  error?: string;
  ok?: boolean;
}

// Must stay at or below the Server Action bodySizeLimit in next.config.mjs —
// a larger value here is unreachable: the request 413s before we run.
const BAG_PHOTO_MAX_BYTES = 4 * 1024 * 1024;
const BAG_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];

async function context(taskId: string) {
  const session = await requireAgentSession();
  const core = getCore();
  return { session, core, taskId };
}

function gps(form: FormData): { lat?: number | null; lng?: number | null } {
  const lat = Number(form.get("lat"));
  const lng = Number(form.get("lng"));
  return {
    lat: Number.isFinite(lat) && lat !== 0 ? lat : null,
    lng: Number.isFinite(lng) && lng !== 0 ? lng : null,
  };
}

function fail(error: unknown, fallback: string): VisitActionState {
  if (error instanceof NotFoundError || error instanceof ConflictError) {
    return { error: error.message };
  }
  console.error("[visit]", fallback, error);
  return { error: `${fallback} Check your connection and try again.` };
}

export async function arriveAction(
  _prev: VisitActionState,
  form: FormData,
): Promise<VisitActionState> {
  try {
    const { session, core } = await context(String(form.get("taskId")));
    await arriveAtVisit(core, session, {
      taskId: String(form.get("taskId")),
      ...gps(form),
    });
    revalidatePath(`/tasks/${String(form.get("taskId"))}`);
    return { ok: true };
  } catch (error) {
    return fail(error, "Couldn't record your arrival.");
  }
}

export async function verifyIdentityAction(
  _prev: VisitActionState,
  form: FormData,
): Promise<VisitActionState> {
  try {
    const taskId = String(form.get("taskId"));
    const { session, core } = await context(taskId);
    await recordIdentityVerified(core, session, { taskId });
    revalidatePath(`/tasks/${taskId}`);
    return { ok: true };
  } catch (error) {
    return fail(error, "Couldn't record the ID check.");
  }
}

/**
 * Seal id, weight and photo are all REQUIRED — they are the custody record for
 * the bag. An agent who cannot weigh or photograph flags an exception rather
 * than sealing (see `reportExceptionAction`); there is no partial seal.
 */
const sealSchema = z.object({
  taskId: z.uuid(),
  bagId: z.uuid(),
  sealId: z.string().min(1, "Enter the seal id.").max(120),
  weightKg: z
    .number({ error: "Enter the bag's weight in kg." })
    .positive("Weight must be greater than 0.")
    .max(99, "Weight must be under 99 kg."),
});

export async function sealBagAction(
  _prev: VisitActionState,
  form: FormData,
): Promise<VisitActionState> {
  const weightRaw = String(form.get("weightKg") ?? "").trim();
  const parsed = sealSchema.safeParse({
    taskId: String(form.get("taskId") ?? ""),
    bagId: String(form.get("bagId") ?? ""),
    sealId: String(form.get("sealId") ?? "").trim(),
    // Undefined rather than NaN when blank, so zod reports "enter the weight"
    // instead of a type error the agent can do nothing with.
    weightKg: weightRaw ? Number(weightRaw) : undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the bag details." };
  }

  try {
    const { session, core } = await context(parsed.data.taskId);

    // Required photo — uploaded first so the custody event can carry it. A
    // failed upload aborts the seal: a bag must never be recorded as sealed
    // with its photo silently missing.
    const photo = form.get("photo");
    if (!(photo instanceof File) || photo.size === 0) {
      return { error: "Take a photo of the bag before sealing it." };
    }
    if (photo.size > BAG_PHOTO_MAX_BYTES) {
      return { error: "That photo is too large — keep it under 4 MB." };
    }
    if (!BAG_PHOTO_TYPES.includes(photo.type)) {
      return { error: "Photos must be JPEG, PNG, or WebP." };
    }
    const supabase = await getSupabaseServerClient();
    if (!supabase) return { error: "Storage isn't configured." };

    const extension =
      photo.type === "image/png" ? "png" : photo.type === "image/webp" ? "webp" : "jpg";
    const photoPath = `bags/${parsed.data.bagId}/${crypto.randomUUID()}.${extension}`;
    const { error: uploadError } = await supabase.storage
      .from("bag-photos")
      .upload(photoPath, new Uint8Array(await photo.arrayBuffer()), {
        contentType: photo.type,
      });
    if (uploadError) {
      console.error("[visit] photo upload failed", uploadError.message);
      return { error: "Photo upload failed. Check your connection and try again." };
    }

    await recordBagSealed(core, session, {
      taskId: parsed.data.taskId,
      bagId: parsed.data.bagId,
      sealId: parsed.data.sealId,
      weightKg: parsed.data.weightKg,
      photoPath,
      ...gps(form),
    });
    revalidatePath(`/tasks/${parsed.data.taskId}`);
    return { ok: true };
  } catch (error) {
    return fail(error, "Couldn't record the seal.");
  }
}

export async function completeVisitAction(
  _prev: VisitActionState,
  form: FormData,
): Promise<VisitActionState> {
  try {
    const taskId = String(form.get("taskId"));
    const { session, core } = await context(taskId);
    const result = await completeVerificationVisit(core, session, {
      taskId,
      ...gps(form),
    });
    if (!result.ok) return { error: result.error };
    revalidatePath(`/tasks/${taskId}`);
    // No payment outcome to report: completing a visit records custody only.
    // Charging is swept from the web app, which owns the payment credentials.
    return { ok: true };
  } catch (error) {
    return fail(error, "Couldn't complete the visit.");
  }
}

const exceptionSchema = z.object({
  taskId: z.uuid(),
  reason: z.enum(VISIT_EXCEPTION_REASONS),
  note: z.string().max(500).optional(),
});

export async function reportExceptionAction(
  _prev: VisitActionState,
  form: FormData,
): Promise<VisitActionState> {
  const parsed = exceptionSchema.safeParse({
    taskId: String(form.get("taskId") ?? ""),
    reason: String(form.get("reason") ?? ""),
    note: String(form.get("note") ?? "").trim() || undefined,
  });
  if (!parsed.success) return { error: "Pick a reason." };

  try {
    const { session, core } = await context(parsed.data.taskId);
    const result = await reportVisitException(core, session, {
      taskId: parsed.data.taskId,
      reason: parsed.data.reason,
      ...(parsed.data.note ? { note: parsed.data.note } : {}),
      ...gps(form),
    });
    if (!result.ok) return { error: result.error };
    revalidatePath(`/tasks/${parsed.data.taskId}`);
    return { ok: true };
  } catch (error) {
    return fail(error, "Couldn't report the problem.");
  }
}
