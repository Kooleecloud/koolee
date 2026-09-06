"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { normalizeEmail } from "@koolee/ui/lib/credentials";
import {
  attachEmail,
  completeProfile,
  ConflictError,
  getCustomerById,
  guardUpgradeOtpSend,
  markEmailVerified,
} from "@koolee/core";

import { authSchemaAvailable } from "@/env";
import { getAuthUser } from "@/lib/auth";
import { tryGetCore } from "@/lib/core";
import { deleteAuthUser } from "@/lib/supabase/admin";
import { getSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Everything these actions mutate is rendered by `/dashboard/profile` —
 * saved addresses included, since `/dashboard/addresses` is now a redirect
 * onto it. Without this the action returns `ok`, the form says "saved", and
 * the page keeps showing the old value out of the client Router Cache: the
 * server component never re-ran. Matches what every admin action already does.
 */
const PROFILE_PATH = "/dashboard/profile";

export interface ProfileActionState {
  error?: string;
  ok?: boolean;
}

const RATE_LIMIT_COPY = "Too many attempts — try again in a minute.";
const EMAIL_TAKEN_COPY = "That email already belongs to another account.";

/** See `emailField` in actions/auth.ts — same rule, same reason. */
const emailField = z.preprocess(normalizeEmail, z.email());

const profileSchema = z.object({
  fullName: z.string().min(1).max(120),
  email: emailField.optional().or(z.literal("")),
});

/**
 * Saves the display name and, for accounts without one, attaches an email.
 *
 * Phone and any existing verified email are READ-ONLY here: changing them
 * means re-running verification, which is the funnel's guarded OTP path —
 * this page never builds a second verification mechanism.
 * TODO(account): a dedicated change-phone/change-email flow that routes into
 * the existing guarded upgrade path with a `returnTo` back to the profile.
 *
 * The email attach itself goes through `guardUpgradeOtpSend` (throttle +
 * claim reconciliation in ONE transaction) exactly like every other
 * `updateUser` send — there is only one guard, and no path around it.
 */
export async function saveProfile(
  _prev: ProfileActionState,
  form: FormData,
): Promise<ProfileActionState> {
  const authUser = await getAuthUser();
  if (!authUser || authUser.isAnonymous) {
    return { error: "Your session has expired. Sign in and try again." };
  }

  const parsed = profileSchema.safeParse({
    fullName: String(form.get("fullName") ?? "").trim(),
    email: normalizeEmail(form.get("email")),
  });
  if (!parsed.success) {
    return { error: "Check the highlighted fields and try again." };
  }

  const core = tryGetCore();
  if (!core) return { error: "The database is not configured." };

  try {
    await completeProfile(core.db, {
      authUserId: authUser.id,
      fullName: parsed.data.fullName,
    });

    const email = parsed.data.email?.toLowerCase() || undefined;
    const currentEmail = (authUser.email ?? "").toLowerCase();
    if (email && email !== currentEmail && !currentEmail) {
      // The ONE guarded path for every updateUser-triggered send: throttle +
      // reconciliation before Supabase sends the confirmation email.
      const guard = await guardUpgradeOtpSend(core.db, {
        userId: authUser.id,
        destination: email,
        kind: "email",
        reconcile: authSchemaAvailable,
        deleteAuthUser,
      });
      if (!guard.allowed) {
        return { error: RATE_LIMIT_COPY };
      }
      if (guard.conflict) {
        return { error: EMAIL_TAKEN_COPY };
      }

      const supabase = await getSupabaseServerClient();
      if (supabase) {
        const { error } = await supabase.auth.updateUser({ email });
        if (error && /already been registered/i.test(error.message)) {
          return { error: EMAIL_TAKEN_COPY };
        }
      }
      await attachEmail(core.db, { authUserId: authUser.id, email, verified: false });
    }

    revalidatePath(PROFILE_PATH);
    return { ok: true };
  } catch (error) {
    if (error instanceof ConflictError) {
      return { error: EMAIL_TAKEN_COPY };
    }
    console.error("[profile] save failed", error);
    return { error: "Something went wrong saving your profile." };
  }
}

/**
 * Re-sends the confirmation email for the address already pending on this
 * account — the "I never got the code" escape hatch next to the code field.
 *
 * Takes no arguments on purpose: the destination is read from the database,
 * never from the client. A posted email field would make this a second attach
 * path with no `!currentEmail` check in front of it — send any address, get
 * Supabase to mail it. The only thing the caller decides here is *when* a
 * resend is attempted; the caps decide whether one happens.
 *
 * Past that, this is the same shape as the attach in `saveProfile` — one
 * `guardUpgradeOtpSend` (throttle + claim reconciliation in one transaction)
 * before the one `updateUser` that triggers the send. Re-issuing the same
 * pending email re-sends the `email_change` confirmation, so the code the
 * user ends up typing is still verified by `confirmEmailCode` unchanged.
 */
export async function resendEmailCode(): Promise<ProfileActionState> {
  const authUser = await getAuthUser();
  if (!authUser || authUser.isAnonymous) {
    return { error: "Your session has expired. Sign in and try again." };
  }

  const core = tryGetCore();
  if (!core) return { error: "The database is not configured." };

  const userRow = await getCustomerById(core.db, authUser.id).catch(() => null);
  if (userRow?.emailVerifiedAt) {
    return { error: "That email is already verified — reload the page." };
  }

  const email = (userRow?.email ?? authUser.email ?? "").toLowerCase();
  if (!email) {
    return { error: "Add an email first, then we can send you a code." };
  }

  const supabase = await getSupabaseServerClient();
  if (!supabase) return { error: "Not available in this environment yet." };

  try {
    const guard = await guardUpgradeOtpSend(core.db, {
      userId: authUser.id,
      destination: email,
      kind: "email",
      reconcile: authSchemaAvailable,
      deleteAuthUser,
    });
    if (!guard.allowed) return { error: RATE_LIMIT_COPY };
    if (guard.conflict) return { error: EMAIL_TAKEN_COPY };
  } catch (error) {
    // Fail closed: sending past an unresolved claim is the wrong-user bug the
    // guard exists to stop.
    console.error("[profile] resend guard failed", error);
    return { error: "We couldn't send a code just now. Try again in a minute." };
  }

  const { error } = await supabase.auth.updateUser({ email });
  if (error) {
    if (/already been registered/i.test(error.message)) {
      return { error: EMAIL_TAKEN_COPY };
    }
    if (error.status === 429 || /rate limit|too many/i.test(error.message)) {
      return { error: RATE_LIMIT_COPY };
    }
    console.error("[profile] resend failed", error);
    return { error: "We couldn't send the code. Try again in a minute." };
  }

  // No revalidate: a resend changes nothing the page renders. The pending
  // email was already on screen before the button was pressed.
  return { ok: true };
}

const confirmCodeSchema = z.object({
  email: emailField,
  code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code."),
});

/**
 * Confirms a pending email with the 6-digit code from the confirmation
 * email — the same `verifyOtp(type: "email_change")` flow the funnel's
 * verification screen uses, surfaced here so an email added from the
 * profile (or post-booking) can actually finish verifying.
 */
export async function confirmEmailCode(
  _prev: ProfileActionState,
  form: FormData,
): Promise<ProfileActionState> {
  const authUser = await getAuthUser();
  if (!authUser || authUser.isAnonymous) {
    return { error: "Your session has expired. Sign in and try again." };
  }

  const parsed = confirmCodeSchema.safeParse({
    email: normalizeEmail(form.get("email")),
    code: String(form.get("code") ?? "").trim(),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Enter the 6-digit code." };
  }

  const supabase = await getSupabaseServerClient();
  if (!supabase) return { error: "Not available in this environment yet." };

  const { error } = await supabase.auth.verifyOtp({
    email: parsed.data.email,
    token: parsed.data.code,
    type: "email_change",
  });
  if (error) {
    return {
      error: /expired|invalid/i.test(error.message)
        ? "That code didn't match. Check the six digits and try again."
        : error.message,
    };
  }

  const core = tryGetCore();
  if (core) {
    try {
      await markEmailVerified(core.db, {
        authUserId: authUser.id,
        email: parsed.data.email,
      });
    } catch (dbError) {
      console.error("[profile] markEmailVerified failed", dbError);
    }
  }

  revalidatePath(PROFILE_PATH);
  return { ok: true };
}
