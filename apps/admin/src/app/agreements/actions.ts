"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  InvalidInputError,
  publishAgreementVersion,
  updateScheduledAgreementVersion,
} from "@koolee/core";

import { getCore } from "@/lib/core";
import { requireAdminSession } from "@/lib/session";

/**
 * Publishing and editing agreement versions.
 *
 * Admin-ness is enforced HERE, not in core: `publishAgreementVersion` takes a
 * `publishedBy` id and does not know what a session is. That is the standing
 * split — core owns the domain rules (version = max+1, no retroactive dates,
 * frozen once effective), the action owns "who is allowed to ask".
 */

export interface AgreementActionState {
  error?: string;
  ok?: string;
}

/**
 * `datetime-local` (and the `DateTimeField` that replaced it) posts a
 * WALL-CLOCK string with no zone. Interpreting it in the server's zone would
 * mean the same keystrokes produce a different instant on a laptop and on a
 * UTC production box, so the field is labelled UTC and parsed as UTC — one
 * reading, everywhere.
 */
function parseEffectiveFrom(raw: string | undefined): Date | undefined | null {
  if (!raw) return undefined;
  const parsed = new Date(`${raw}:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

const publishSchema = z.object({
  title: z.string().trim().min(1, "Give the agreement a title.").max(200),
  bodyMd: z.string().trim().min(1, "The agreement body is empty."),
  effectiveFrom: z.string().optional(),
});

export async function publishAgreement(
  _prev: AgreementActionState,
  form: FormData,
): Promise<AgreementActionState> {
  let session;
  try {
    session = await requireAdminSession();
  } catch {
    return { error: "Not signed in as an admin." };
  }

  const parsed = publishSchema.safeParse({
    title: String(form.get("title") ?? ""),
    bodyMd: String(form.get("bodyMd") ?? ""),
    effectiveFrom: String(form.get("effectiveFrom") ?? "").trim() || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  }

  const effectiveFrom = parseEffectiveFrom(parsed.data.effectiveFrom);
  if (effectiveFrom === null) return { error: "That effective date isn't valid." };

  let core;
  try {
    core = getCore();
  } catch {
    return { error: "Database not configured." };
  }

  try {
    const version = await publishAgreementVersion(core, {
      title: parsed.data.title,
      bodyMd: parsed.data.bodyMd,
      ...(effectiveFrom === undefined ? {} : { effectiveFrom }),
      publishedBy: session.userId,
    });
    revalidatePath("/agreements");
    // No affected-booking count any more, because there are none: under
    // version pinning a publish cannot disturb a booking that has already
    // accepted. It applies to bookings made from its effective date onward.
    return { ok: `Published version ${version.version}.` };
  } catch (error) {
    if (error instanceof InvalidInputError) return { error: error.message };
    console.error("[agreements] publish failed", error);
    return { error: "Couldn't publish that version." };
  }
}

const updateSchema = z.object({
  id: z.uuid(),
  title: z.string().trim().min(1, "Give the agreement a title.").max(200),
  bodyMd: z.string().trim().min(1, "The agreement body is empty."),
  effectiveFrom: z.string().optional(),
});

/**
 * Edits a version that has not taken effect yet. No acknowledgement checkbox:
 * a scheduled version has no acceptances by construction, so editing it asks
 * nothing of anybody — which is exactly why it is allowed at all.
 */
export async function updateScheduledAgreement(
  _prev: AgreementActionState,
  form: FormData,
): Promise<AgreementActionState> {
  try {
    await requireAdminSession();
  } catch {
    return { error: "Not signed in as an admin." };
  }

  const parsed = updateSchema.safeParse({
    id: String(form.get("id") ?? ""),
    title: String(form.get("title") ?? ""),
    bodyMd: String(form.get("bodyMd") ?? ""),
    effectiveFrom: String(form.get("effectiveFrom") ?? "").trim() || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  }

  const effectiveFrom = parseEffectiveFrom(parsed.data.effectiveFrom);
  if (effectiveFrom === null) return { error: "That effective date isn't valid." };

  let core;
  try {
    core = getCore();
  } catch {
    return { error: "Database not configured." };
  }

  try {
    const result = await updateScheduledAgreementVersion(core, {
      id: parsed.data.id,
      title: parsed.data.title,
      bodyMd: parsed.data.bodyMd,
      ...(effectiveFrom === undefined ? {} : { effectiveFrom }),
    });
    // "It went live while you were typing" is an expected outcome with a
    // specific remedy, not a failure to swallow — core returns it as a Result
    // and the operator's text is still in the editor.
    if (!result.ok) return { error: result.error };
    revalidatePath("/agreements");
    return { ok: `Saved version ${result.version.version}.` };
  } catch (error) {
    if (error instanceof InvalidInputError) return { error: error.message };
    console.error("[agreements] update failed", error);
    return { error: "Couldn't save that version." };
  }
}
