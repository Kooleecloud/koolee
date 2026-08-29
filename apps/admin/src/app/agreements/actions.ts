"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  countBookingsNeedingReacceptance,
  InvalidInputError,
  publishAgreementVersion,
} from "@koolee/core";

import { getCore } from "@/lib/core";
import { requireAdminSession } from "@/lib/session";

/**
 * Publishing a new agreement version.
 *
 * Admin-only, enforced HERE: `publishAgreementVersion` takes a `publishedBy`
 * id and does not know what a session is, which is the standing split — core
 * owns the domain rule (version = max+1, no retroactive dates), the action
 * owns "who is allowed to ask".
 *
 * Publishing is consequential and not undoable: every in-flight booking is
 * un-gated the moment the new version takes effect, and each of those
 * customers is asked to accept again. The form therefore requires an explicit
 * acknowledgement of the count (see the page), and the count is recomputed
 * here rather than trusted from the client.
 */

export interface PublishAgreementState {
  error?: string;
  ok?: string;
}

const publishSchema = z.object({
  title: z.string().trim().min(1, "Give the agreement a title.").max(200),
  bodyMd: z.string().trim().min(1, "The agreement body is empty."),
  /** Blank → now. */
  effectiveFrom: z.string().optional(),
  acknowledged: z.literal("on", { error: "Confirm you understand the impact." }),
});

export async function publishAgreement(
  _prev: PublishAgreementState,
  form: FormData,
): Promise<PublishAgreementState> {
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
    acknowledged: String(form.get("acknowledged") ?? ""),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form." };
  }

  let effectiveFrom: Date | undefined;
  if (parsed.data.effectiveFrom) {
    // `datetime-local` has no zone. Interpreting it as the SERVER's zone would
    // mean the same keystrokes produce a different instant on a laptop and on
    // a UTC production box, so the field is labelled UTC in the form and
    // parsed as UTC here — one reading, everywhere.
    const parsedDate = new Date(`${parsed.data.effectiveFrom}:00Z`);
    if (Number.isNaN(parsedDate.getTime())) {
      return { error: "That effective date isn't valid." };
    }
    effectiveFrom = parsedDate;
  }

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
    const affected = await countBookingsNeedingReacceptance(core.db);
    revalidatePath("/agreements");
    return {
      ok:
        `Published version ${version.version}. ` +
        `${affected} in-flight booking${affected === 1 ? "" : "s"} will be asked to accept it.`,
    };
  } catch (error) {
    if (error instanceof InvalidInputError) return { error: error.message };
    console.error("[agreements] publish failed", error);
    return { error: "Couldn't publish that version." };
  }
}
