"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  ConflictError,
  createStaffMember,
  setStaffMemberActive,
  STAFF_ROLES,
} from "@koolee/core";

import { optionalEnv } from "@/env";
import { getCore } from "@/lib/core";
import { requireAdminSession } from "@/lib/session";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Staff management: list / invite / deactivate. Exactly these three.
 *
 * Invites are admin-only and fully server-side: the service-role key (which
 * only this app holds) creates the auth user via `inviteUserByEmail`, and
 * the role row is written in the same action — the role value is validated
 * here AND in `createStaffMember`, never trusted from the client beyond the
 * two allowed values. The invitee gets an email (Mailpit locally), clicks
 * through to /auth/callback in the app matching their role, and sets a
 * password.
 */

export interface StaffActionState {
  error?: string;
  ok?: string;
}

const inviteSchema = z.object({
  email: z.email(),
  role: z.enum(STAFF_ROLES),
});

export async function inviteStaff(
  _prev: StaffActionState,
  form: FormData,
): Promise<StaffActionState> {
  let session;
  try {
    session = await requireAdminSession();
  } catch {
    return { error: "Not signed in as an admin." };
  }

  const parsed = inviteSchema.safeParse({
    email: String(form.get("email") ?? "").trim().toLowerCase(),
    role: String(form.get("role") ?? ""),
  });
  if (!parsed.success) {
    return { error: "Enter a valid email and pick agent or admin." };
  }
  const { email, role } = parsed.data;

  const admin = getSupabaseAdminClient();
  if (!admin) {
    return {
      error:
        "SUPABASE_SERVICE_ROLE_KEY is not configured — invites need the service role.",
    };
  }

  let core;
  try {
    core = getCore();
  } catch {
    return { error: "Database not configured." };
  }

  // The invite link must land in the app the invitee will actually use.
  const agentOrigin = optionalEnv("NEXT_PUBLIC_AGENT_APP_URL") ?? "http://localhost:3001";
  const adminOrigin = optionalEnv("NEXT_PUBLIC_APP_URL") ?? "http://localhost:3002";
  const origin = role === "agent" ? agentOrigin : adminOrigin;

  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${origin}/auth/callback?next=%2Fset-password`,
  });
  if (error || !data.user) {
    if (error && (error.code === "email_exists" || /already.*registered/i.test(error.message))) {
      return {
        error:
          "That email already has an account. Staff roles can only be attached to invited accounts — use a different address.",
      };
    }
    return { error: error?.message ?? "Invite failed." };
  }

  try {
    await createStaffMember(core.db, {
      userId: data.user.id,
      email,
      role,
      invitedByUserId: session.userId,
    });
  } catch (dbError) {
    if (dbError instanceof ConflictError) {
      return { error: "That email already belongs to another account." };
    }
    console.error("[staff] role assignment failed after invite", dbError);
    return {
      error:
        "The invite email was sent but the role assignment failed — re-invite to retry.",
    };
  }

  revalidatePath("/staff");
  return { ok: `Invited ${email} as ${role}. They'll get an email to set a password.` };
}

export async function deactivateStaff(
  _prev: StaffActionState,
  form: FormData,
): Promise<StaffActionState> {
  let session;
  try {
    session = await requireAdminSession();
  } catch {
    return { error: "Not signed in as an admin." };
  }

  const userId = String(form.get("userId") ?? "");
  if (!z.uuid().safeParse(userId).success) return { error: "Missing staff member." };

  // Locking yourself out mid-session helps nobody; another admin can do it.
  if (userId === session.userId) {
    return { error: "You can't deactivate your own account." };
  }

  let core;
  try {
    core = getCore();
  } catch {
    return { error: "Database not configured." };
  }

  const row = await setStaffMemberActive(core.db, { userId, active: false });
  if (!row) return { error: "No staff row for that user." };

  revalidatePath("/staff");
  return { ok: "Deactivated. Their next request fails the role check." };
}
