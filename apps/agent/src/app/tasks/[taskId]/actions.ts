"use server";

import { revalidatePath } from "next/cache";
import type { z } from "zod";
import { getVisitContext } from "@koolee/core";
import {
  arriveRequestSchema,
  bagPhotoPath,
  completeVisitRequestSchema,
  confirmPassportRequestSchema,
  deliverRequestSchema,
  EXTENSION_BY_MIME_TYPE,
  handoverRequestSchema,
  imageMimeTypeSchema,
  pickupExceptionRequestSchema,
  scanSealRequestSchema,
  sealBagRequestSchema,
  startPickupRequestSchema,
  UPLOAD_BUCKETS,
  VISIT_EXCEPTION_NOTE_MAX_LENGTH,
  visitExceptionRequestSchema,
  type Gps,
  type ImageMimeType,
} from "@koolee/api-contract";

import { resolveActionContext } from "@/api/context";
import {
  deliver,
  handover,
  reportPickupException,
  scanSeal,
  startPickup,
} from "@/api/handlers/pickup";
import {
  arrive,
  capturePassport,
  completeVisit,
  confirmPassport,
  reportVisitException,
  sealBag,
} from "@/api/handlers/visit";
import { actionErrorMessage } from "@/lib/action-error";
import { uploadPassportPhoto } from "@/lib/passport-photos";

/**
 * The verification visit's and the pickup run's server actions.
 *
 * ONE IMPLEMENTATION PER DRIVER STEP (phase 8). Each action here is a form
 * adapter over the SAME handler the native app reaches through `/api/v1`
 * (`src/api/handlers/visit.ts`, `src/api/handlers/pickup.ts`): parse the
 * FormData, validate it with the contract's request schema, hand the typed
 * body to the handler with a cookie-resolved `ApiContext`, revalidate. What
 * a step means — which custody event it writes, which refusal it gives, how
 * it treats a missing fix — is decided in exactly one place for both clients.
 * Every step still writes its custody event in core with the REAL agent id
 * (the session resolved here per request).
 *
 * Photo uploads are the one thing the web app still does itself: the native
 * app uploads straight to Storage and sends the object key, whereas a browser
 * form carries the bytes, so the action uploads them server-side — to the
 * PRIVATE buckets, as the signed-in agent over the anon key (this app holds
 * no service key; the storage RLS policies in migrations 0008/0022 gate
 * writes to active staff) — and then passes the resulting key to the handler
 * exactly as the app would. The handler's own guards (prefix, existence)
 * still run on it. There is no offline sync: a failed step returns a clear
 * error and the agent retries when connectivity is back.
 */

export interface VisitActionState {
  error?: string;
  ok?: boolean;
}

// Must stay at or below the Server Action bodySizeLimit in next.config.mjs —
// a larger value here is unreachable: the request 413s before we run. (The
// contract's per-bucket ceilings are for the native app's direct uploads.)
const PHOTO_MAX_BYTES = 4 * 1024 * 1024;

/**
 * The device position from the form's hidden fields, in the contract's `Gps`
 * shape. Exactly `0` is "no fix" — the handlers apply the same rule, so both
 * clients write identical custody events.
 */
function gps(form: FormData): Gps {
  const lat = Number(form.get("lat"));
  const lng = Number(form.get("lng"));
  return {
    lat: Number.isFinite(lat) && lat !== 0 ? lat : null,
    lng: Number.isFinite(lng) && lng !== 0 ? lng : null,
  };
}

function text(form: FormData, name: string): string {
  return String(form.get(name) ?? "");
}

/**
 * Validates a form-built body with the contract's request schema. The first
 * issue's message is returned when the contract wrote it for a driver (seal
 * id, weight); a caller that knows its schema only fails in ways a driver
 * cannot act on (an enum, a uuid) passes a fixed sentence instead.
 */
function validate<S extends z.ZodType>(
  schema: S,
  raw: unknown,
  fallback: string,
  { firstIssue = true, noteCopy }: { firstIssue?: boolean; noteCopy?: string } = {},
): { ok: true; data: z.output<S> } | { ok: false; error: string } {
  const parsed = schema.safeParse(raw);
  if (parsed.success) return { ok: true, data: parsed.data as z.output<S> };
  const issue = parsed.error.issues[0];
  // The exception forms fail in two ways a driver can act on: no reason, or a
  // note past the contract's ceiling. "Pick a reason." for the second would
  // send them hunting for a reason they already picked.
  if (noteCopy && issue?.path[0] === "note") return { ok: false, error: noteCopy };
  const message = firstIssue ? issue?.message : undefined;
  return { ok: false, error: message ?? fallback };
}

const NOTE_TOO_LONG_COPY = `Keep the note under ${VISIT_EXCEPTION_NOTE_MAX_LENGTH} characters.`;

/**
 * The photo guards a form must pass before its bytes go anywhere. `missing`
 * is the step's own sentence ("take a photo of the bag…"); the size and type
 * sentences are shared.
 */
function acceptPhoto(
  value: FormDataEntryValue | null,
  missing: string,
): { ok: true; photo: File; mime: ImageMimeType } | { ok: false; error: string } {
  if (!(value instanceof File) || value.size === 0) return { ok: false, error: missing };
  if (value.size > PHOTO_MAX_BYTES) {
    return { ok: false, error: "That photo is too large — keep it under 4 MB." };
  }
  const mime = imageMimeTypeSchema.safeParse(value.type);
  if (!mime.success) return { ok: false, error: "Photos must be JPEG, PNG, or WebP." };
  return { ok: true, photo: value, mime: mime.data };
}

function fail(error: unknown, fallback: string): VisitActionState {
  // One rule, every action file. See `lib/action-error.ts` for why it matches
  // the base classes (`CoreError`, `ApiHttpError`) rather than a list.
  return { error: actionErrorMessage(error, fallback, "[visit]") };
}

export async function arriveAction(
  _prev: VisitActionState,
  form: FormData,
): Promise<VisitActionState> {
  const taskId = text(form, "taskId");
  const body = validate(arriveRequestSchema, gps(form), "Couldn't read your position.");
  if (!body.ok) return { error: body.error };

  try {
    await arrive(await resolveActionContext(), taskId, body.data);
    revalidatePath(`/tasks/${taskId}`);
    return { ok: true };
  } catch (error) {
    return fail(error, "Couldn't record your arrival.");
  }
}

/**
 * The agent photographs the passport at the door.
 *
 * Separate from confirmation on purpose: capture is evidence, confirmation is
 * a judgement. Uploading a photo does NOT open the gate — a photo nobody
 * looked at is not a check — so the agent still presses confirm after seeing
 * the document and the person together.
 *
 * The upload runs as the signed-in agent over the anon key (this app holds no
 * service key); migration 0022's storage policies gate it to active staff.
 *
 * WHY `getVisitContext` IS READ TWICE. The object key must sit under
 * `passports/<bookingId>/`, and only the assignment-scoped visit read says
 * which booking this task belongs to — so the action reads it once to build
 * the upload path (and so an unassigned task 404s BEFORE any bytes are
 * written), then the handler reads it again to check the key against the
 * booking CORE says the task belongs to, never one the caller supplied. A
 * "trust my bookingId" fast-path on the handler would hand every caller a way
 * around that check; a second indexed read on a step that just uploaded a
 * multi-megabyte photo is the cheaper price.
 */
export async function capturePassportAction(
  _prev: VisitActionState,
  form: FormData,
): Promise<VisitActionState> {
  const taskId = text(form, "taskId");
  if (!taskId) return { error: "Reload the task and try again." };

  const accepted = acceptPhoto(
    form.get("passport"),
    "Take a photo of the passport page first.",
  );
  if (!accepted.ok) return { error: accepted.error };
  const { photo, mime } = accepted;

  try {
    const ctx = await resolveActionContext();
    const visit = await getVisitContext(ctx.core.db, ctx.session, taskId, ctx.now);

    const storagePath = await uploadPassportPhoto({
      bookingId: visit.booking.id,
      data: new Uint8Array(await photo.arrayBuffer()),
      contentType: mime,
      extension: EXTENSION_BY_MIME_TYPE[mime],
    });
    if (!storagePath) {
      return { error: "Photo upload failed. Check your connection and try again." };
    }

    await capturePassport(ctx, taskId, { storagePath });
    revalidatePath(`/tasks/${taskId}`);
    return { ok: true };
  } catch (error) {
    return fail(error, "Couldn't save the passport photo.");
  }
}

/**
 * Confirms the traveler's passport — the identity gate. Replaces the old
 * self-attested "ID matches the ticket" checkbox; core no longer exposes it.
 */
export async function confirmPassportAction(
  _prev: VisitActionState,
  form: FormData,
): Promise<VisitActionState> {
  const taskId = text(form, "taskId");
  const body = validate(
    confirmPassportRequestSchema,
    gps(form),
    "Couldn't read your position.",
  );
  if (!body.ok) return { error: body.error };

  try {
    await confirmPassport(await resolveActionContext(), taskId, body.data);
    revalidatePath(`/tasks/${taskId}`);
    return { ok: true };
  } catch (error) {
    return fail(error, "Couldn't confirm the passport.");
  }
}

/**
 * Seal id, weight and photo are all REQUIRED — they are the custody record for
 * the bag. An agent who cannot weigh or photograph flags an exception rather
 * than sealing (see `reportExceptionAction`); there is no partial seal. The
 * contract's `sealBagRequestSchema` carries the driver-facing copy for the
 * seal id and the weight; the photo is validated here because the form
 * carries bytes where the app would carry a key.
 */
const sealBagFieldsSchema = sealBagRequestSchema.omit({ photoPath: true });

export async function sealBagAction(
  _prev: VisitActionState,
  form: FormData,
): Promise<VisitActionState> {
  const taskId = text(form, "taskId");
  const weightRaw = text(form, "weightKg").trim();
  const fields = validate(
    sealBagFieldsSchema,
    {
      bagId: text(form, "bagId"),
      sealId: text(form, "sealId"),
      // Undefined rather than NaN when blank, so zod reports "enter the weight"
      // instead of a type error the agent can do nothing with.
      weightKg: weightRaw ? Number(weightRaw) : undefined,
      ...gps(form),
    },
    "Check the bag details.",
  );
  if (!fields.ok) return { error: fields.error };

  // Required photo — uploaded first so the custody event can carry it. A
  // failed upload aborts the seal: a bag must never be recorded as sealed
  // with its photo silently missing.
  const accepted = acceptPhoto(
    form.get("photo"),
    "Take a photo of the bag before sealing it.",
  );
  if (!accepted.ok) return { error: accepted.error };
  const { photo, mime } = accepted;

  try {
    const ctx = await resolveActionContext();

    // A fresh uuid per object and no upsert: a retake is a NEW object, so the
    // photo the custody trail already names is never destroyed. The key is
    // built with the contract's helper, i.e. exactly what the native app
    // would send — the handler then checks it the same way for both.
    const photoPath = bagPhotoPath(fields.data.bagId, crypto.randomUUID(), mime);
    const { error: uploadError } = await ctx.supabase.storage
      .from(UPLOAD_BUCKETS.bagPhotos.bucket)
      .upload(photoPath, new Uint8Array(await photo.arrayBuffer()), {
        contentType: mime,
        upsert: false,
      });
    if (uploadError) {
      console.error("[visit] photo upload failed", uploadError.message);
      return { error: "Photo upload failed. Check your connection and try again." };
    }

    await sealBag(ctx, taskId, { ...fields.data, photoPath });
    revalidatePath(`/tasks/${taskId}`);
    return { ok: true };
  } catch (error) {
    return fail(error, "Couldn't record the seal.");
  }
}

export async function completeVisitAction(
  _prev: VisitActionState,
  form: FormData,
): Promise<VisitActionState> {
  const taskId = text(form, "taskId");
  const body = validate(
    completeVisitRequestSchema,
    gps(form),
    "Couldn't read your position.",
  );
  if (!body.ok) return { error: body.error };

  try {
    // A core refusal arrives from the handler as `refused(...)` and `fail`
    // shows its sentence verbatim.
    await completeVisit(await resolveActionContext(), taskId, body.data);
    revalidatePath(`/tasks/${taskId}`);
    // No payment outcome to report: completing a visit records custody only.
    // Charging is swept from the web app, which owns the payment credentials.
    return { ok: true };
  } catch (error) {
    return fail(error, "Couldn't complete the visit.");
  }
}

export async function reportExceptionAction(
  _prev: VisitActionState,
  form: FormData,
): Promise<VisitActionState> {
  const taskId = text(form, "taskId");
  // Fixed copy: what fails here is the reason enum (or a note past its
  // ceiling), and zod's own sentence for either is not one a driver can use.
  const body = validate(
    visitExceptionRequestSchema,
    {
      reason: text(form, "reason"),
      note: text(form, "note").trim() || undefined,
      ...gps(form),
    },
    "Pick a reason.",
    { firstIssue: false, noteCopy: NOTE_TOO_LONG_COPY },
  );
  if (!body.ok) return { error: body.error };

  try {
    await reportVisitException(await resolveActionContext(), taskId, body.data);
    revalidatePath(`/tasks/${taskId}`);
    return { ok: true };
  } catch (error) {
    return fail(error, "Couldn't report the problem.");
  }
}

/* ------------------------------------------------------------------ */
/* The pickup run                                                      */
/* ------------------------------------------------------------------ */

/**
 * Every step below is IDEMPOTENT in core, which is what makes an optimistic
 * UI and a flaky van connection compatible: a driver who taps twice, or whose
 * first tap timed out after the write landed, gets `ok` both times rather than
 * an error that looks like the step failed.
 */

export async function startPickupTravelAction(
  _prev: VisitActionState,
  form: FormData,
): Promise<VisitActionState> {
  const taskId = text(form, "taskId");
  const body = validate(
    startPickupRequestSchema,
    gps(form),
    "Couldn't read your position.",
  );
  if (!body.ok) return { error: body.error };

  try {
    await startPickup(await resolveActionContext(), taskId, body.data);
    revalidatePath(`/tasks/${taskId}`);
    return { ok: true };
  } catch (error) {
    return fail(error, "Couldn't start the pickup.");
  }
}

export async function scanSealAction(
  _prev: VisitActionState,
  form: FormData,
): Promise<VisitActionState> {
  const taskId = text(form, "taskId");
  const body = validate(
    scanSealRequestSchema,
    { sealValue: text(form, "sealValue"), ...gps(form) },
    "Scan or type the seal id.",
  );
  if (!body.ok) return { error: body.error };

  try {
    await scanSeal(await resolveActionContext(), taskId, body.data);
    revalidatePath(`/tasks/${taskId}`);
    return { ok: true };
  } catch (error) {
    // A mismatch arrives as a ConflictError whose message already tells the
    // driver not to load the bag. `fail` shows it verbatim.
    return fail(error, "Couldn't check that seal.");
  }
}

export async function deliverToBagdropAction(
  _prev: VisitActionState,
  form: FormData,
): Promise<VisitActionState> {
  const taskId = text(form, "taskId");
  const body = validate(deliverRequestSchema, gps(form), "Couldn't read your position.");
  if (!body.ok) return { error: body.error };

  try {
    await deliver(await resolveActionContext(), taskId, body.data);
    revalidatePath(`/tasks/${taskId}`);
    return { ok: true };
  } catch (error) {
    return fail(error, "Couldn't record the drop-off.");
  }
}

export async function confirmHandoverAction(
  _prev: VisitActionState,
  form: FormData,
): Promise<VisitActionState> {
  const taskId = text(form, "taskId");
  const body = validate(handoverRequestSchema, gps(form), "Couldn't read your position.");
  if (!body.ok) return { error: body.error };

  try {
    await handover(await resolveActionContext(), taskId, body.data);
    revalidatePath(`/tasks/${taskId}`);
    return { ok: true };
  } catch (error) {
    return fail(error, "Couldn't close the job out.");
  }
}

export async function reportPickupExceptionAction(
  _prev: VisitActionState,
  form: FormData,
): Promise<VisitActionState> {
  const taskId = text(form, "taskId");
  const body = validate(
    pickupExceptionRequestSchema,
    {
      reason: text(form, "reason"),
      note: text(form, "note").trim() || undefined,
      ...gps(form),
    },
    "Pick a reason.",
    { firstIssue: false, noteCopy: NOTE_TOO_LONG_COPY },
  );
  if (!body.ok) return { error: body.error };

  try {
    await reportPickupException(await resolveActionContext(), taskId, body.data);
    revalidatePath(`/tasks/${taskId}`);
    return { ok: true };
  } catch (error) {
    return fail(error, "Couldn't file that.");
  }
}
