"use server";

import { z } from "zod";
import {
  attachEmail,
  checkCoverage,
  completeProfile,
  ConflictError,
  ensureAddress,
} from "@koolee/core";

import { getAuthUser } from "@/lib/auth";
import { tryGetCore } from "@/lib/core";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export interface ProfileActionState {
  error?: string;
  ok?: boolean;
}

const profileSchema = z.object({
  fullName: z.string().min(1).max(120),
  email: z.email().optional().or(z.literal("")),
  line1: z.string().max(200).optional().or(z.literal("")),
  line2: z.string().max(200).optional().or(z.literal("")),
  city: z.string().max(100).optional().or(z.literal("")),
  state: z.string().max(2).optional().or(z.literal("")),
  zip: z.string().max(10).optional().or(z.literal("")),
});

/**
 * Saves the optional profile: name, email (when not already set), and the
 * saved pickup address. Stamps `users.profile_completed_at`. Nothing in v1
 * hard-requires this.
 */
export async function saveProfile(
  _prev: ProfileActionState,
  form: FormData,
): Promise<ProfileActionState> {
  const authUser = await getAuthUser();
  if (!authUser || authUser.isAnonymous) {
    return { error: "Your session has expired. Sign in and try again." };
  }

  const raw = Object.fromEntries(
    ["fullName", "email", "line1", "line2", "city", "state", "zip"].map((key) => [
      key,
      String(form.get(key) ?? "").trim(),
    ]),
  );
  const parsed = profileSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: "Check the highlighted fields and try again." };
  }

  const core = tryGetCore();
  if (!core) return { error: "The database is not configured." };

  try {
    const email = parsed.data.email || undefined;

    await completeProfile(core.db, {
      authUserId: authUser.id,
      fullName: parsed.data.fullName,
    });

    // Email attach is fire-and-forget: Supabase sends the confirmation, the
    // row keeps the unverified address until the callback confirms it.
    if (email && email.toLowerCase() !== (authUser.email ?? "").toLowerCase()) {
      const supabase = await getSupabaseServerClient();
      if (supabase) {
        const { error } = await supabase.auth.updateUser({ email: email.toLowerCase() });
        if (error && /already been registered/i.test(error.message)) {
          return { error: "That email already belongs to another account." };
        }
      }
      await attachEmail(core.db, {
        authUserId: authUser.id,
        email: email.toLowerCase(),
        verified: false,
      });
    }

    const { line1, line2, city, state, zip } = parsed.data;
    if (line1 && city && state && zip) {
      const coverage = checkCoverage(zip);
      if (!coverage.covered) {
        return { error: "That ZIP is outside our current service area." };
      }
      await ensureAddress(core.db, authUser.id, {
        line1,
        ...(line2 ? { line2 } : {}),
        city,
        state,
        zip: coverage.zip ?? zip,
      });
    }

    return { ok: true };
  } catch (error) {
    if (error instanceof ConflictError) {
      return { error: "That email already belongs to another account." };
    }
    console.error("[profile] save failed", error);
    return { error: "Something went wrong saving your profile." };
  }
}
