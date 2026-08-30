"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getActiveStaffRole } from "@koolee/core";

import { optionalEnv } from "@/env";
import { tryGetCore } from "@/lib/core";
import { getSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Staff auth actions for the agent app: email + password ONLY.
 *
 * No OTP, no magic links, no OAuth, and NO SIGNUP FORM — accounts exist only
 * through the admin app's invite flow. Do not "harden" this by disabling
 * signups on the Supabase project: the customer funnel requires anonymous
 * sign-ins, so account creation stays enabled project-wide and the security
 * boundary is the ROLE check (`requireStaffRole` in @koolee/core), not
 * account existence.
 */

export interface StaffAuthState {
  error?: string;
  ok?: boolean;
}

const credentialsSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

const NO_ACCESS_COPY =
  "That account doesn't have agent access. Ask an admin to invite you.";

const CAPTCHA_FAILED_COPY =
  "We couldn't confirm you're human. Refresh the page and try again.";

/**
 * Turnstile is verified by SUPABASE, not by us: the browser mints a single-use
 * token, we forward it as `options.captchaToken`, and GoTrue calls siteverify
 * with the secret that lives only in the Supabase dashboard. This app holds no
 * Turnstile secret — only the site key, and only to render the widget.
 *
 * Why this app needs it at all: CAPTCHA protection is a Supabase PROJECT
 * setting. Turning it on for the customer funnel also gated GoTrue's
 * `/token?grant_type=password` (sign-in) and `/recover` (password reset),
 * which is every auth call made here, and both began failing with
 * "captcha protection: request disallowed (no captcha_token found)".
 *
 * With no site key configured the widget renders nothing, so a missing token
 * is only an error when the widget was supposed to be there — that keeps a
 * fresh clone and a captcha-off project working unchanged.
 */
function readCaptchaToken(form: FormData): string | undefined {
  const token = String(form.get("turnstileToken") ?? "").trim();
  return token.length > 0 ? token : undefined;
}

function captchaMissing(token: string | undefined): boolean {
  return !token && Boolean(optionalEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY"));
}

function captchaOptions(token: string | undefined): { captchaToken?: string } {
  return token ? { captchaToken: token } : {};
}

export async function signInStaff(
  _prev: StaffAuthState,
  form: FormData,
): Promise<StaffAuthState> {
  const parsed = credentialsSchema.safeParse({
    email: String(form.get("email") ?? "").trim(),
    password: String(form.get("password") ?? ""),
  });
  if (!parsed.success) {
    return { error: "Enter your email and password." };
  }

  const captchaToken = readCaptchaToken(form);
  if (captchaMissing(captchaToken)) return { error: CAPTCHA_FAILED_COPY };

  const supabase = await getSupabaseServerClient();
  if (!supabase) return { error: "Sign-in isn't available in this environment yet." };

  const { data, error } = await supabase.auth.signInWithPassword({
    ...parsed.data,
    options: captchaOptions(captchaToken),
  });
  if (error || !data.user) {
    return { error: "Email or password didn't match." };
  }

  // The role gate. A valid password on a role-less account is still a no.
  const core = tryGetCore();
  const role = core ? await getActiveStaffRole(core.db, data.user.id) : null;
  if (role !== "agent") {
    await supabase.auth.signOut();
    return { error: NO_ACCESS_COPY };
  }

  redirect("/tasks");
}

export async function signOutStaff(): Promise<void> {
  const supabase = await getSupabaseServerClient();
  if (supabase) await supabase.auth.signOut();
  redirect("/login");
}

const resetSchema = z.object({ email: z.email() });

/**
 * Password reset via Supabase `resetPasswordForEmail` (lands in Mailpit
 * locally). Always reports success — whether an account exists is not a
 * fact this form should leak.
 */
export async function sendPasswordReset(
  _prev: StaffAuthState,
  form: FormData,
): Promise<StaffAuthState> {
  const parsed = resetSchema.safeParse({
    email: String(form.get("email") ?? "").trim(),
  });
  if (!parsed.success) return { error: "Enter a valid email address." };

  const captchaToken = readCaptchaToken(form);
  if (captchaMissing(captchaToken)) return { error: CAPTCHA_FAILED_COPY };

  const supabase = await getSupabaseServerClient();
  if (!supabase) return { error: "Not available in this environment yet." };

  const hdrs = await headers();
  const origin =
    hdrs.get("origin") ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001";

  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${origin}/auth/callback?next=%2Fset-password`,
    ...captchaOptions(captchaToken),
  });
  if (error) {
    console.error("[agent auth] resetPasswordForEmail failed", error.message);
    // The always-succeed response above protects ACCOUNT ENUMERATION — whether
    // an address has an account. A captcha rejection is not account-dependent,
    // and answering "check your inbox" for a mail that was never sent is
    // exactly how this failure stayed invisible until someone read the logs.
    if (/captcha/i.test(error.message)) return { error: CAPTCHA_FAILED_COPY };
  }
  return { ok: true };
}

const passwordSchema = z.object({ password: z.string().min(8).max(128) });

/**
 * Sets the password on the current session — the landing action for both
 * the invite flow and password recovery (the emailed link signs the user in
 * via /auth/callback first).
 */
export async function updatePassword(
  _prev: StaffAuthState,
  form: FormData,
): Promise<StaffAuthState> {
  const parsed = passwordSchema.safeParse({
    password: String(form.get("password") ?? ""),
  });
  if (!parsed.success) {
    return { error: "Password must be at least 8 characters." };
  }

  const supabase = await getSupabaseServerClient();
  if (!supabase) return { error: "Not available in this environment yet." };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Your link has expired — request a new one." };

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { error: error.message };

  const core = tryGetCore();
  const role = core ? await getActiveStaffRole(core.db, user.id) : null;
  if (role !== "agent") {
    await supabase.auth.signOut();
    return { error: NO_ACCESS_COPY };
  }
  redirect("/tasks");
}
